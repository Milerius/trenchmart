-- Public status page (/status, GET /api/v1/status; docs/ops/status-page.md).
-- status_probes: one row per component per 5-minute cron tick, kept 14 days (latency, state).
-- status_daily: per-day roll-up kept ~100 days, read by the 90-day uptime bars.
-- status_incidents: opened when a component stops being operational, resolved when it is again.
-- Rows hold component ids, states and numbers only: never alert messages, addresses or balances.
create table if not exists status_probes (
  id bigserial primary key,
  component text not null,
  state text not null check (state in ('operational', 'degraded', 'down')),
  latency_ms integer,
  checked_at timestamptz not null default now()
);
create index if not exists status_probes_component_checked on status_probes (component, checked_at desc);
create index if not exists status_probes_checked on status_probes (checked_at);

create table if not exists status_daily (
  day date not null,
  component text not null,
  samples integer not null,
  operational integer not null,
  degraded integer not null,
  down integer not null,
  p50_ms integer,
  p95_ms integer,
  primary key (day, component)
);

create table if not exists status_incidents (
  id bigserial primary key,
  component text not null,
  worst text not null check (worst in ('degraded', 'down')),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  resolved_at timestamptz
);
create index if not exists status_incidents_started on status_incidents (started_at desc);
create unique index if not exists status_incidents_one_open on status_incidents (component) where resolved_at is null;

alter table status_probes enable row level security;
alter table status_daily enable row level security;
alter table status_incidents enable row level security;
