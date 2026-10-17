-- Rich listing pages: seller images (validated, EXIF-stripped, stored in R2) and Markdown
-- content (README, How to use, requirements). Sellers edit a draft; only a draft that passed
-- the content review is copied to `live`, which is all the public listing ever shows.
alter table listing_media add column if not exists sha256 text not null default '';
alter table listing_media add column if not exists mime text not null default 'image/png';
alter table listing_media add column if not exists width int not null default 0;
alter table listing_media add column if not exists height int not null default 0;
alter table listing_media add column if not exists bytes int not null default 0;
alter table listing_media add column if not exists created_at timestamptz not null default now();
do $$ begin alter table listing_media add constraint listing_media_mime_check check (mime in ('image/png', 'image/jpeg', 'image/webp')); exception when duplicate_object then null; end $$;
create index if not exists listing_media_listing_idx on listing_media (listing_id);

create table if not exists listing_content (
  listing_id uuid primary key references listings(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'live', 'needs_changes', 'rejected')),
  live jsonb,
  live_sha256 text,
  checks jsonb not null default '[]'::jsonb,
  review jsonb,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
