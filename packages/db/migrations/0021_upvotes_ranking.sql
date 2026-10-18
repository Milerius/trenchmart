-- Listing upvotes and the ranking job (social, 2026-10-18). One upvote per wallet per listing,
-- weighted like helpful votes (buyer 1.0x, $TRENCH holder 0.5x, others 0). The ranking job
-- writes each listing's score parts and ranks, and a creator leaderboard snapshot.
create table if not exists listing_upvotes (
  listing_id uuid not null references listings(id) on delete cascade,
  user_id uuid not null references users(id),
  weight_bps int not null default 0,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index if not exists listing_upvotes_user_idx on listing_upvotes (user_id, created_at desc);

alter table listings add column if not exists upvote_count int not null default 0;
alter table listings add column if not exists upvote_weight int not null default 0;
alter table listings add column if not exists rank_score numeric(6, 4);
alter table listings add column if not exists rank_category int;
alter table listings add column if not exists rank_overall int;
alter table listings add column if not exists rank_parts jsonb;
alter table listings add column if not exists ranked_at timestamptz;
create index if not exists listings_rank_idx on listings (rank_overall) where rank_overall is not null;

-- One row per creator with any counted activity, refreshed by the ranking job.
create table if not exists creator_rank (
  creator_id uuid primary key references users(id) on delete cascade,
  rank int,
  prev_rank int,
  score numeric(6, 4) not null default 0,
  sales int not null default 0,
  volume bigint not null default 0,
  rating_count int not null default 0,
  rating_avg numeric(4, 2),
  bayes numeric(6, 4),
  upvotes numeric(10, 4) not null default 0,
  listings int not null default 0,
  parts jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

alter table listing_upvotes enable row level security;
alter table creator_rank enable row level security;
