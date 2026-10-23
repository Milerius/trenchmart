-- Abuse fix 2 (docs/ops/rate-limits.md): daily request quota per API key, counted in the same
-- statement that authenticates the key (no extra round trip), and an index so the cron can
-- prune old rate_buckets windows cheaply.
alter table api_keys add column if not exists daily_day date;
alter table api_keys add column if not exists daily_count integer not null default 0;
alter table api_keys add column if not exists daily_quota integer not null default 10000;
alter table api_keys drop constraint if exists api_keys_daily_quota_valid;
alter table api_keys add constraint api_keys_daily_quota_valid
  check (daily_quota between 1 and 1000000);
create index if not exists rate_buckets_window_idx on rate_buckets (window_start);
