-- Agent API (2026-10-18): scoped API keys for AI agents, the wallet-signed challenges that
-- mint them, and the unsigned transactions the API issued (so the broadcast endpoint relays
-- only byte-identical copies of what it built). Keys are stored as a SHA-256 hash only; the
-- plaintext is shown once at creation.
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null,
  rate_limit_per_min int not null default 60,
  created_via text not null default 'studio',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_scopes_valid check (
    scopes <@ array['read', 'trade', 'sell', 'profile', 'review']::text[] and cardinality(scopes) > 0
  ),
  constraint api_keys_rate_valid check (rate_limit_per_min between 1 and 600)
);
create index if not exists api_keys_user_idx on api_keys (user_id, created_at desc);

-- A challenge binds the wallet, key name, scopes and limit into the exact text the wallet
-- signs, so a captured signature cannot mint a key with different terms.
create table if not exists agent_challenges (
  nonce text primary key,
  wallet text not null,
  message text not null,
  name text not null,
  scopes text[] not null,
  rate_limit_per_min int not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists agent_challenges_wallet_idx on agent_challenges (wallet, expires_at desc);

-- SHA-256 of each unsigned transaction message the API built for a wallet to sign.
create table if not exists issued_txs (
  message_hash text primary key,
  wallet text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  broadcast_sig text
);
create index if not exists issued_txs_expires_idx on issued_txs (expires_at);

alter table api_keys enable row level security;
alter table agent_challenges enable row level security;
alter table issued_txs enable row level security;
