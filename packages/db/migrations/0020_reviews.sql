-- Verified-buyer reviews (social, 2026-10-18). One review per released order, signed by the
-- buying wallet, tagged with a version that wallet downloaded. Creators reply once (editable).
-- Helpful votes and reports are one per wallet per review and carry a weight in basis points
-- (buyer 1.0x, $TRENCH holder 0.5x, others 0) recomputed from wallet_intel.
alter table listing_reviews add column if not exists reviewer_id uuid references users(id);
alter table listing_reviews add column if not exists version_id uuid references versions(id);
alter table listing_reviews add column if not exists terminal text;
alter table listing_reviews add column if not exists signature text;
alter table listing_reviews add column if not exists edited_at timestamptz;
alter table listing_reviews add column if not exists hidden_at timestamptz;
alter table listing_reviews add column if not exists hidden_reason text;
alter table listing_reviews add column if not exists helpful_weight int not null default 0;
alter table listing_reviews add column if not exists helpful_count int not null default 0;
alter table listing_reviews add column if not exists unhelpful_count int not null default 0;
update listing_reviews r set reviewer_id = o.buyer_id, version_id = o.version_id from orders o where o.id = r.order_id and r.reviewer_id is null;
create index if not exists listing_reviews_listing_idx on listing_reviews (listing_id, created_at desc);
create index if not exists listing_reviews_reviewer_idx on listing_reviews (reviewer_id);

create table if not exists review_replies (
  review_id uuid primary key references listing_reviews(id) on delete cascade,
  creator_id uuid not null references users(id),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists review_votes (
  review_id uuid not null references listing_reviews(id) on delete cascade,
  user_id uuid not null references users(id),
  helpful boolean not null,
  weight_bps int not null default 0,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists review_reports (
  review_id uuid not null references listing_reviews(id) on delete cascade,
  user_id uuid not null references users(id),
  reason text not null check (reason in ('spam', 'off_topic', 'abuse', 'contact_info', 'other')),
  weight_bps int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (review_id, user_id)
);

-- What the chain says about a wallet, for anti-sybil weights: the oldest activity seen and
-- who sent it SOL recently (funders: [{wallet, at}]). Filled by the wallet-intel cron step.
create table if not exists wallet_intel (
  wallet text primary key,
  oldest_seen_at timestamptz,
  funders jsonb not null default '[]'::jsonb,
  holder_tier tier not null default 'none',
  tier_checked_at timestamptz,
  scanned_at timestamptz,
  requested_at timestamptz not null default now()
);

alter table review_replies enable row level security;
alter table review_votes enable row level security;
alter table review_reports enable row level security;
alter table wallet_intel enable row level security;
