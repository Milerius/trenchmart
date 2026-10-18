-- Seller updates and buyer update entitlement (owner decision 2026-10-18).
-- Buyers get new versions free for 30 days after purchase; after that a monthly renewal,
-- priced per listing by the seller (0 = free updates forever), extends updates by 30 days.
-- versions.live_at / superseded_at record when each version was the live one, so a buyer is
-- entitled to every version that was live while their updates were active.
alter table versions add column if not exists live_at timestamptz;
alter table versions add column if not exists superseded_at timestamptz;
alter table versions add column if not exists is_update boolean not null default false;
alter table versions add column if not exists supplement_id uuid;
update versions set live_at = created_at where live_at is null and status in ('live', 'superseded');
update versions v set superseded_at = coalesce(
    (select min(n.created_at) from versions n where n.listing_id = v.listing_id and n.created_at > v.created_at and n.status in ('live', 'superseded')),
    v.created_at)
  where v.status = 'superseded' and v.superseded_at is null;
create index if not exists versions_listing_created_idx on versions (listing_id, created_at);

-- Monthly update price in lamports. Existing listings start at the suggested 10% of price.
alter table listings add column if not exists update_price bigint not null default 0;
do $$ begin alter table listings add constraint listings_update_price_check check (update_price >= 0); exception when duplicate_object then null; end $$;
update listings set update_price = price / 10 where update_price = 0 and price > 0;

-- Current end of a buyer's update entitlement, and free-forever for listings priced at 0.
alter table orders add column if not exists updates_until timestamptz;
alter table orders add column if not exists updates_forever boolean not null default false;

-- Every window in which an order's updates were active: the free month and each renewal.
create table if not exists update_periods (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null check (source in ('purchase', 'renewal')),
  renewal_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists update_periods_order_idx on update_periods (order_id);
insert into update_periods (order_id, starts_at, ends_at, source)
  select o.id, o.paid_at, o.paid_at + interval '30 days', 'purchase' from orders o
  where o.paid_at is not null and o.status in ('paid', 'released', 'disputed')
    and not exists (select 1 from update_periods p where p.order_id = o.id);
update orders set updates_until = paid_at + interval '30 days'
  where updates_until is null and paid_at is not null and status in ('paid', 'released', 'disputed');

-- Monthly update renewals, paid to the vault like other platform payments.
create table if not exists update_renewals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer_id uuid not null references users(id),
  price bigint not null,
  fee_bps int not null,
  rebate_bps int not null,
  fee bigint not null,
  rebate bigint not null,
  total bigint not null,
  tier tier not null,
  memo text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  tx_sig text unique,
  starts_at timestamptz,
  ends_at timestamptz,
  paid_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists update_renewals_order_idx on update_renewals (order_id);

-- SOL supplements beyond the daily free limits: creator uploads and file verifications.
create table if not exists supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('upload', 'verify')),
  lamports bigint not null check (lamports >= 0),
  memo text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'used')),
  tx_sig text unique,
  reasons jsonb not null default '[]'::jsonb,
  ref_id uuid,
  paid_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists supplements_user_idx on supplements (user_id, created_at);

-- One row per standalone file verification, for the daily free quota. The file is not stored.
create table if not exists verifications (
  id bigserial primary key,
  user_id uuid references users(id),
  ip_hash text not null,
  free boolean not null,
  supplement_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists verifications_user_idx on verifications (user_id, created_at);
create index if not exists verifications_ip_idx on verifications (ip_hash, created_at);

insert into config (key, value) values
  ('update_free_days', '30'),
  ('update_period_days', '30'),
  ('update_price_default_bps', '1000'),
  ('update_limit_per_listing_day', '1'),
  ('upload_limit_per_creator_day', '5'),
  ('upload_supplement_lamports', '50000000'),
  ('verify_free_per_day', '1'),
  ('verify_supplement_lamports', '10000000')
  on conflict (key) do nothing;

-- Same as every other table: no access through the Supabase Data API; the API connects as owner.
alter table update_periods enable row level security;
alter table update_renewals enable row level security;
alter table supplements enable row level security;
alter table verifications enable row level security;
