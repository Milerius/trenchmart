-- New-listing wizard (studio redesign 2026-10-18): what the seller picked on step 1 and the
-- structured, kind-specific answers from step 2 (terminals stay in listings.terminals).
-- Validated by @trenchmart/shared listing-kinds; shown to buyers as the listing's specs.
alter table listings add column if not exists kind text;
alter table listings add column if not exists specs jsonb not null default '{}'::jsonb;
do $$ begin alter table listings add constraint listings_kind_known check (kind is null or kind in ('script', 'bot', 'wallet', 'filter', 'indicator', 'telegram', 'other')); exception when duplicate_object then null; end $$;
