-- Monitoring (docs/ops/monitoring.md): error events counted by the ops check, and alert state
-- so each alert is delivered once when it opens, re-sent every 6 h while open, and once resolved.
create table if not exists ops_events (
  id bigserial primary key,
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ops_events_kind_created on ops_events (kind, created_at desc);

create table if not exists ops_alerts (
  code text primary key,
  level text not null,
  message text not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  notified_at timestamptz,
  resolved_at timestamptz
);
