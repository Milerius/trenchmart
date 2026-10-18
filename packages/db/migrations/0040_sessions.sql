-- Server-side wallet sessions (docs/security: session revocation).
-- The tm_session JWT carries `sid`; every cookie-authenticated request loads the user only
-- when its session row exists, is not revoked and has not expired (one indexed join, no
-- extra round trip). Logout revokes the row; "log out everywhere" revokes every row of the
-- user; signing in with another wallet revokes the session it replaces. Tokens without a
-- `sid` (issued before this migration) are rejected, so every older session ends here.
-- Agent API keys (agent_api_keys) are separate and keep their own revoke.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in ('logout', 'logout_all', 'switch', 'admin'))
);
create index if not exists sessions_user_live on sessions (user_id) where revoked_at is null;
create index if not exists sessions_expires on sessions (expires_at);
