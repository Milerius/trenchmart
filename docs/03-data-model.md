# 03 · Data model (Postgres)

Implement with Drizzle in `packages/db`. SQL below is the source of truth for shape. Money = lamports (`bigint`). Token amounts = raw base units (`numeric(40,0)`).

```sql
-- ── enums ─────────────────────────────────────────────
create type role as enum ('buyer','creator','verifier','admin');
create type category as enum ('userscript','wallet_list','filter','setup','strategy','alerts');
create type license_kind as enum ('single','multi3','subscription');
create type version_status as enum ('uploading','scanning','needs_creator','in_review','live','rejected','superseded','delisted');
create type check_result as enum ('pass','warn','fail','na');
create type order_status as enum ('pending','paid','released','refunded','disputed','expired');
create type dispute_status as enum ('open','upheld','rejected');
create type payout_status as enum ('pending','proposed','sent','failed');
create type tier as enum ('none','scout','trencher','og');
create type bond_status as enum ('pending','active','unlocking','released','slashed');

-- ── users ─────────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  wallet        text not null unique,                 -- base58 pubkey
  roles         role[] not null default '{buyer}',
  handle        text unique,                          -- display @name
  x_user_id     text unique,
  x_handle      text,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

create table auth_nonces (
  nonce       text primary key,
  wallet      text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

-- ── creators & bonds ──────────────────────────────────
create table bonds (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  amount        bigint not null,                      -- lamports
  tx_sig        text not null unique,                 -- deposit tx to vault
  status        bond_status not null default 'pending',
  unlock_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- ── listings & versions ───────────────────────────────
create table listings (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references users(id),
  slug          text not null unique,
  title         text not null,
  summary       text not null,                        -- 1–2 sentences
  description   text not null,                        -- markdown
  category      category not null,
  terminals     text[] not null default '{}',         -- compat tags
  price         bigint not null check (price >= 0),   -- lamports
  license       license_kind not null default 'single',
  sub_period_days int,                                -- subscription only
  holder_only_hours int not null default 0,           -- early access window
  holder_only   boolean not null default false,       -- only tier>=scout can buy
  live_version_id uuid,                               -- fk added below
  is_featured   boolean not null default false,
  delisted_at   timestamptz,
  first_live_at timestamptz,
  sales_7d      int not null default 0,
  rating_avg    numeric(3,2),
  rating_count  int not null default 0,
  search        tsvector generated always as
                (to_tsvector('english', title || ' ' || summary || ' ' || description)) stored,
  created_at    timestamptz not null default now()
);
create index on listings using gin(search);
create index on listings(category);
create index on listings using gin(terminals);

create table listing_media (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  r2_key      text not null,
  sort        int not null default 0
);

create table versions (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listings(id),
  semver        text not null,                        -- "2.1.3"
  changelog     text not null default '',
  file_name     text not null,
  file_size     int not null,
  sha256        text not null,                        -- hex, of original upload
  r2_key        text not null,                        -- blobs/<sha256>
  status        version_status not null default 'uploading',
  declared      jsonb not null default '{}',          -- parsed @match/@grant/@connect/@require
  creator_note  text,                                 -- explanation of warnings
  wallet_count  int,                                  -- wallet lists: unique Solana addresses counted from the file by the scan
  wallet_facts  jsonb,                                -- wallet lists: {format, rows, duplicates, invalid, named?, alertTypes?}; counts only
  created_at    timestamptz not null default now(),
  unique (listing_id, semver)
);
alter table listings add constraint fk_live_version
  foreign key (live_version_id) references versions(id);

-- ── security pipeline ─────────────────────────────────
create table scans (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references versions(id),
  kind        text not null check (kind in ('static','sandbox')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  engine_ver  text not null,                          -- scanner rules version
  summary     check_result,                           -- worst of checks
  raw         jsonb                                   -- full engine output (network log etc.)
);

create table scan_checks (
  id          uuid primary key default gen_random_uuid(),
  scan_id     uuid not null references scans(id) on delete cascade,
  rule_id     text not null,                          -- e.g. "no-sign-transaction"
  result      check_result not null,
  title       text not null,                          -- user-facing
  detail      text not null,
  locations   jsonb not null default '[]'             -- [{line, col, snippet}]
);

create table reviews_verifier (                       -- human review decisions
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references versions(id),
  verifier_id   uuid not null references users(id),
  decision      text not null check (decision in ('approve','reject','request_changes')),
  notes         text not null,
  attestation   text not null,                        -- message that was signed
  signature     text not null,                        -- verifier wallet signature (base58)
  created_at    timestamptz not null default now()
);

-- ── orders, escrow, payouts ───────────────────────────
create table orders (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references users(id),
  listing_id      uuid not null references listings(id),
  version_id      uuid not null references versions(id),  -- live version at purchase
  price           bigint not null,                    -- list price snapshot
  fee_bps         int not null,                       -- 500
  rebate_bps      int not null,                       -- 0/2500/6000/10000 of fee
  fee             bigint not null,                    -- price*fee_bps/10000
  rebate          bigint not null,                    -- fee*rebate_bps/10000
  total           bigint not null,                    -- price + fee - rebate
  tier_at_purchase tier not null,
  memo            text not null unique,               -- "tm:<order id short>"
  status          order_status not null default 'pending',
  tx_sig          text unique,
  paid_at         timestamptz,
  escrow_until    timestamptz,
  released_at     timestamptz,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);
create index on orders(buyer_id);
create index on orders(status, escrow_until);

create table licenses (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id),
  wallet      text not null,
  valid_until timestamptz,                            -- subscriptions
  unique (order_id, wallet)
);

create table downloads (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id),
  version_id  uuid not null references versions(id),
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create table disputes (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references orders(id),
  opened_by   uuid not null references users(id),
  reason      text not null check (reason in ('malicious','not_as_described','broken','other')),
  details     text not null,
  status      dispute_status not null default 'open',
  resolution  text,
  resolved_by uuid references users(id),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create table payouts (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references orders(id),
  recipient   text not null,                          -- wallet or bucket name
  bucket      text not null check (bucket in ('creator','buyback','verifiers','ops','safety','refund')),
  amount      bigint not null,
  status      payout_status not null default 'pending',
  batch_id    text,
  tx_sig      text,
  created_at  timestamptz not null default now()
);

create table ledger (                                 -- double-entry-ish audit of vault funds
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  account     text not null,                          -- 'vault','creator:<id>','bucket:buyback',...
  delta       bigint not null,                        -- +/- lamports
  ref_type    text not null,                          -- 'order','payout','bond','slash'
  ref_id      uuid not null
);

-- ── buyer reviews ─────────────────────────────────────
create table listing_reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references orders(id),
  listing_id  uuid not null references listings(id),
  rating      int not null check (rating between 1 and 5),
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ── token tiers ───────────────────────────────────────
create table token_balances (                         -- history, one row per change
  id          bigserial primary key,
  wallet      text not null,
  amount      numeric(40,0) not null,                 -- balance AFTER this event
  ts          timestamptz not null,
  source      text not null check (source in ('webhook','snapshot','reconcile')),
  tx_sig      text
);
create index on token_balances(wallet, ts desc);

-- ── misc ──────────────────────────────────────────────
create table config (
  key    text primary key,
  value  jsonb not null
);

create table notifications (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id),
  kind      text not null,
  data      jsonb not null,
  read_at   timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id        bigserial primary key,
  ts        timestamptz not null default now(),
  actor_id  uuid,
  entity    text not null,
  entity_id uuid not null,
  action    text not null,
  data      jsonb
);
```

## Seed `config` rows

```json
{
  "fee_bps": 500,
  "tier_rebate_bps": { "none": 0, "scout": 2500, "trencher": 6000, "og": 10000 },
  "tier_thresholds": { "scout": "100000", "trencher": "1000000", "og": "10000000" },
  "trench_decimals": 6,
  "tier_window_hours": 72,
  "fee_split_bps": { "buyback": 4000, "verifiers": 2500, "ops": 2000, "safety": 1500 },
  "escrow_hours": 1,
  "order_ttl_minutes": 20,
  "verification_fee_lamports": 250000000,
  "verification_fee_free_from_tier": "trencher",
  "bond_lamports_by_category": {
    "userscript": 5000000000,
    "alerts": 5000000000,
    "setup": 5000000000,
    "wallet_list": 2000000000,
    "filter": 1000000000,
    "strategy": 1000000000
  },
  "og_bond_discount_bps": 5000,
  "bond_unlock_days": 30,
  "terminals": ["Axiom", "GMGN", "Photon", "Terminal", "Trojan", "Any"],
  "max_file_bytes": { "default": 5242880, "setup": 26214400 }
}
```

Tier thresholds are whole $MART (Scout 100k, Trencher 1M, OG 10M of a 1B supply). Tier logic treats any non-integer string as "tier disabled".

## State machines

**Version**

```
uploading ─▶ scanning ─┬─▶ in_review ─┬─▶ live ─▶ superseded (newer version live)
                       │              │        └▶ delisted (admin / dispute upheld)
                       │              ├─▶ rejected
                       │              └─▶ needs_creator (request_changes)
                       ├─▶ needs_creator (any WARN) ─▶ in_review (creator note submitted)
                       └─▶ rejected (any FAIL)
```

**Order**

```
pending ─┬─▶ paid ─┬─▶ released            (escrow passed, no dispute)
         │         └─▶ disputed ─┬─▶ refunded   (upheld)
         │                       └─▶ released   (rejected)
         └─▶ expired                         (no payment within TTL)
```

**Bond**: `pending → active → unlocking → released`, or `active → slashed` (partial slash allowed; remaining stays active if ≥ required, else listings paused).
