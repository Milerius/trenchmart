-- Paid featuring: "Featured · Sponsored" slots booked by day and paid in SOL to the vault.
-- Featuring never changes a rank. Prices, discounts and rules live in config (admin-editable).

create table feature_bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id),
  creator_id uuid not null references users(id),
  kind text not null check (kind in ('home', 'category', 'band')),
  category text not null,
  start_day date not null,
  days int not null check (days between 1 and 31),
  per_day bigint not null,
  subtotal bigint not null,
  tier text not null default 'none',
  discount_bps int not null default 0,
  total bigint not null,
  -- pending (held while paying) -> paid -> completed | cancelled | pulled; pending -> expired
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'cancelled', 'pulled', 'completed')),
  hold_until timestamptz not null,
  tx_sig text unique,
  paid_at timestamptz,
  refund_lamports bigint not null default 0,
  refund_reason text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index feature_bookings_creator on feature_bookings (creator_id, created_at desc);
create index feature_bookings_listing on feature_bookings (listing_id);
create index feature_bookings_status on feature_bookings (status, start_day);

-- One row per booked day: capacity checks and the public calendar read this.
create table feature_days (
  booking_id uuid not null references feature_bookings(id) on delete cascade,
  kind text not null,
  category text not null,
  day date not null,
  primary key (booking_id, day)
);
create index feature_days_slot on feature_days (kind, day, category);

alter table payouts add column if not exists feature_booking_id uuid references feature_bookings(id);

insert into config (key, value) values
  ('feature_slots', '{"home": {"perDay": 3, "lamportsPerDay": "1500000000"}, "category": {"perDay": 2, "lamportsPerDay": "600000000"}, "band": {"perDay": 6, "lamportsPerDay": "200000000"}}'::jsonb),
  ('feature_discount_bps', '{"none": 0, "scout": 1000, "trencher": 2000, "og": 3000}'::jsonb),
  ('feature_rules', '{"maxConsecutiveDays": 7, "maxDaysAhead": 28, "minRatingX10": 40, "holdMinutes": 15, "cancelHours": 24, "homePerCreatorPerDay": 1}'::jsonb)
on conflict (key) do nothing;

alter table feature_bookings enable row level security;
alter table feature_days enable row level security;
