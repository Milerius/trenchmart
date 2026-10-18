-- Creator profiles (studio redesign 2026-10-18): display name, bio, avatar and banner,
-- socials (shown as typed; only X is verified, through X sign-in) and opt-in contact
-- channels, each visible to everyone or to buyers only. Off by default.
alter table users add column if not exists display_name text;
alter table users add column if not exists bio text;
alter table users add column if not exists avatar_media_id uuid;
alter table users add column if not exists banner_media_id uuid;
alter table users add column if not exists socials jsonb not null default '{}'::jsonb;
alter table users add column if not exists contact jsonb not null default '{"enabled": false, "channels": []}'::jsonb;
alter table users add column if not exists profile_updated_at timestamptz;
do $$ begin alter table users add constraint users_bio_len check (bio is null or char_length(bio) <= 280); exception when duplicate_object then null; end $$;
do $$ begin alter table users add constraint users_display_name_len check (display_name is null or char_length(display_name) <= 40); exception when duplicate_object then null; end $$;

-- Profile images, validated and EXIF-stripped like listing images. Public only while a
-- user's current avatar or banner points at them.
create table if not exists profile_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('avatar', 'banner')),
  r2_key text not null,
  sha256 text not null,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  width int not null,
  height int not null,
  bytes int not null,
  created_at timestamptz not null default now()
);
create index if not exists profile_media_user_idx on profile_media (user_id, created_at);
