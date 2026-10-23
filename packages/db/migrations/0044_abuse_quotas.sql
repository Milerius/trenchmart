-- API abuse limits (docs/04-api.md "Abuse limits"): the per-user daily scan cap counts
-- audit_log rows, and the cron prunes expired sign-in nonces by expiry.
create index if not exists audit_log_actor_action_ts_idx on audit_log (actor_id, action, ts);
create index if not exists auth_nonces_wallet_open_idx on auth_nonces (wallet, expires_at) where used_at is null;
create index if not exists auth_nonces_expires_idx on auth_nonces (expires_at);
