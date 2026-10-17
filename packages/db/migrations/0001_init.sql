-- Product deltas versus docs/03:
-- user_role has buyer, creator, admin. There is no human verifier role.
-- payout buckets use ai_verification instead of verifiers.
-- ai_reviews stores the automated agent's HMAC attestation.
-- reports, buybacks, rate_buckets, and sandbox_jobs support the rest of the API.
-- versions carry the verification-fee signature. listings.paused_at hides a creator
-- whose bond fell below the required amount. orders.disputed_from remembers
-- whether a dispute interrupted paid or released.

create extension if not exists pgcrypto;

create type user_role as enum ('buyer', 'creator', 'admin');
create type category as enum ('userscript', 'wallet_list', 'filter', 'setup', 'strategy', 'alerts');
create type license_kind as enum ('single', 'multi3', 'subscription');
create type version_status as enum ('uploading', 'scanning', 'needs_creator', 'in_review', 'live', 'rejected', 'superseded', 'delisted');
create type check_result as enum ('pass', 'warn', 'fail', 'na');
create type order_status as enum ('pending', 'paid', 'released', 'refunded', 'disputed', 'expired');
create type dispute_status as enum ('open', 'upheld', 'rejected');
create type payout_status as enum ('pending', 'proposed', 'sent', 'failed');
create type tier as enum ('none', 'scout', 'trencher', 'og');
create type bond_status as enum ('pending', 'active', 'unlocking', 'released', 'slashed');

create table users (
  id uuid primary key default gen_random_uuid(),
  wallet text not null unique,
  roles user_role[] not null default '{buyer}',
  handle text unique,
  x_user_id text unique,
  x_handle text,
  avatar_url text,
  banned_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_nonces (
  nonce text primary key,
  wallet text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table bonds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  amount bigint not null,
  tx_sig text not null unique,
  status bond_status not null default 'pending',
  unlock_at timestamptz,
  created_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references users(id),
  slug text not null unique,
  title text not null,
  summary text not null,
  description text not null,
  category category not null,
  terminals text[] not null default '{}',
  price bigint not null check (price >= 0),
  license license_kind not null default 'single',
  sub_period_days int,
  holder_only_hours int not null default 0,
  holder_only boolean not null default false,
  live_version_id uuid,
  is_featured boolean not null default false,
  delisted_at timestamptz,
  paused_at timestamptz,
  first_live_at timestamptz,
  sales_7d int not null default 0,
  rating_avg numeric(3,2),
  rating_count int not null default 0,
  search tsvector generated always as (
    to_tsvector('english', title || ' ' || summary || ' ' || description)
  ) stored,
  created_at timestamptz not null default now()
);
create index listings_search_idx on listings using gin (search);
create index listings_category_idx on listings (category);
create index listings_terminals_idx on listings using gin (terminals);

create table listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  r2_key text not null,
  sort int not null default 0
);

create table versions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id),
  semver text not null,
  changelog text not null default '',
  file_name text not null,
  file_size int not null,
  sha256 text not null,
  r2_key text not null,
  status version_status not null default 'uploading',
  declared jsonb not null default '{}',
  creator_note text,
  vfee_sig text,
  vfee_lamports bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (listing_id, semver)
);

alter table listings add constraint fk_live_version
  foreign key (live_version_id) references versions(id);

create table scans (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references versions(id),
  kind text not null check (kind in ('static', 'sandbox')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  engine_ver text not null,
  summary check_result,
  raw jsonb
);

create table scan_checks (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  rule_id text not null,
  result check_result not null,
  title text not null,
  detail text not null,
  locations jsonb not null default '[]'
);

create table ai_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references versions(id),
  agent_id text not null,
  decision text not null check (decision in ('approve', 'reject', 'request_changes')),
  notes text not null,
  attestation text not null,
  signature text not null,
  credit_lamports bigint not null default 0,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references users(id),
  listing_id uuid not null references listings(id),
  version_id uuid not null references versions(id),
  price bigint not null,
  fee_bps int not null,
  rebate_bps int not null,
  fee bigint not null,
  rebate bigint not null,
  total bigint not null,
  tier_at_purchase tier not null,
  memo text not null unique,
  status order_status not null default 'pending',
  tx_sig text unique,
  paid_at timestamptz,
  escrow_until timestamptz,
  released_at timestamptz,
  expires_at timestamptz not null,
  disputed_from order_status,
  created_at timestamptz not null default now()
);
create index orders_buyer_idx on orders (buyer_id);
create index orders_status_escrow_idx on orders (status, escrow_until);

create table licenses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  wallet text not null,
  valid_until timestamptz,
  unique (order_id, wallet)
);

create table downloads (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  version_id uuid not null references versions(id),
  ip_hash text,
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  opened_by uuid not null references users(id),
  reason text not null check (reason in ('malicious', 'not_as_described', 'broken', 'other')),
  details text not null,
  status dispute_status not null default 'open',
  resolution text,
  resolved_by uuid references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  recipient text not null,
  bucket text not null check (bucket in ('creator', 'buyback', 'ai_verification', 'ops', 'safety', 'refund')),
  amount bigint not null,
  status payout_status not null default 'pending',
  batch_id text,
  tx_sig text,
  created_at timestamptz not null default now()
);

create table ledger (
  id bigserial primary key,
  ts timestamptz not null default now(),
  account text not null,
  delta bigint not null,
  ref_type text not null,
  ref_id uuid not null
);

create table listing_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  listing_id uuid not null references listings(id),
  rating int not null check (rating between 1 and 5),
  body text not null,
  created_at timestamptz not null default now()
);

create table token_balances (
  id bigserial primary key,
  wallet text not null,
  amount numeric(40,0) not null,
  ts timestamptz not null,
  source text not null check (source in ('webhook', 'snapshot', 'reconcile')),
  tx_sig text
);
create index token_balances_wallet_idx on token_balances (wallet, ts desc);

create table config (
  key text primary key,
  value jsonb not null
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null,
  data jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  actor_id uuid,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  data jsonb
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id),
  reporter_id uuid references users(id),
  details text not null,
  created_at timestamptz not null default now()
);

create table buybacks (
  id uuid primary key default gen_random_uuid(),
  tx_sig text not null unique,
  sol_lamports bigint not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table rate_buckets (
  key text not null,
  window_start timestamptz not null,
  hits int not null,
  primary key (key, window_start)
);

create table sandbox_jobs (
  version_id uuid primary key references versions(id),
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

insert into config (key, value) values
  ('fee_bps', '500'),
  ('tier_rebate_bps', '{"none":0,"scout":2500,"trencher":6000,"og":10000}'),
  ('tier_thresholds', '{"scout":"[X]","trencher":"[Y]","og":"[Z]"}'),
  ('tier_window_hours', '72'),
  ('fee_split_bps', '{"buyback":4000,"ai_verification":2500,"ops":2000,"safety":1500}'),
  ('escrow_hours', '48'),
  ('order_ttl_minutes', '20'),
  ('verification_fee_lamports', '250000000'),
  ('verification_fee_free_from_tier', '"trencher"'),
  ('bond_lamports_by_category', '{"userscript":5000000000,"alerts":5000000000,"setup":5000000000,"wallet_list":2000000000,"filter":1000000000,"strategy":1000000000}'),
  ('og_bond_discount_bps', '5000'),
  ('bond_unlock_days', '30'),
  ('terminals', '["Axiom","GMGN","Photon","BullX","Padre","Trojan","Any"]'),
  ('max_file_bytes', '{"default":5242880,"setup":26214400}'),
  ('blocklist_hosts', '[]'),
  ('require_allow_hosts', '["cdn.jsdelivr.net","cdnjs.cloudflare.com","unpkg.com"]'),
  ('sandbox_targets', '["https://axiom.trade/pulse","https://gmgn.ai/?chain=sol"]');
