import {
  normalizeProfile,
  profileBody,
  visibleContact,
  type Contact,
  type Socials,
} from '@trenchmart/shared';
import {
  cleanImage,
  extensionOf,
  ImageError,
  IMAGE_MAX_BYTES,
  lookalikeOf,
} from '@trenchmart/scanner';
import { optimized } from './content';
import { activeBond, audit, HttpError, loadConfig, sha256Hex, type Deps } from './logic';
import { HttpDataError } from './versioning';

type Row = Record<string, any>;

/** Uploaded profile images per user, including replaced ones. */
export const PROFILE_MEDIA_MAX = 30;
export const profileMediaUrl = (id: string) => `/api/v1/profile-media/${id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** X is verified only when the account came from X sign-in, not a dev-linked handle. */
export function isXVerified(row: Row): boolean {
  const id = row.x_user_id as string | null | undefined;
  return Boolean(row.x_handle && id && !id.startsWith('dev:'));
}

function socialsOf(row: Row): Socials {
  return (row.socials as Socials | null) ?? {};
}

function contactOf(row: Row): Contact {
  const contact = row.contact as Contact | null;
  return contact && Array.isArray(contact.channels) ? contact : { enabled: false, channels: [] };
}

function image(id: string | null | undefined) {
  return id ? { id, url: profileMediaUrl(id) } : null;
}

/** The signed-in creator's own profile, everything editable. */
export function ownProfile(user: Row) {
  return {
    handle: user.handle ?? null,
    wallet: user.wallet,
    displayName: user.display_name ?? null,
    bio: user.bio ?? null,
    avatar: image(user.avatar_media_id),
    banner: image(user.banner_media_id),
    socials: socialsOf(user),
    contact: contactOf(user),
    xHandle: user.x_handle ?? null,
    xVerified: isXVerified(user),
    memberSince: user.created_at,
  };
}

export async function loadOwnProfile(deps: Deps, userId: string) {
  const rows = await deps.sql<Row[]>`select * from users where id = ${userId}`;
  const user = rows[0];
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'user not found');
  return ownProfile(user);
}

export async function saveProfile(deps: Deps, userId: string, raw: unknown) {
  const parsed = profileBody.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid body');
  }
  const result = normalizeProfile(parsed.data);
  const errors: Record<string, string> = result.ok ? {} : { ...result.errors };
  const website = result.ok ? result.fields.socials?.website : undefined;
  if (website) {
    const brand = lookalikeOf(new URL(website).hostname);
    if (brand) errors['socials.website'] = `That address imitates ${brand}`;
  }
  if (!result.ok || Object.keys(errors).length) {
    throw new HttpDataError(400, 'PROFILE_INVALID', 'Some fields need fixing', { fields: errors });
  }
  const f = result.fields;
  if (f.handle) {
    const taken = await deps.sql`
      select 1 from users where lower(handle) = ${f.handle} and id <> ${userId}
    `;
    if (taken.length) {
      throw new HttpDataError(400, 'PROFILE_INVALID', 'Some fields need fixing', {
        fields: { handle: 'That handle is taken' },
      });
    }
  }
  const has = (key: keyof typeof f) => f[key] !== undefined;
  await deps.sql`
    update users set
      handle = case when ${has('handle')} then ${f.handle ?? null} else handle end,
      display_name = case when ${has('displayName')} then ${f.displayName ?? null} else display_name end,
      bio = case when ${has('bio')} then ${f.bio ?? null} else bio end,
      socials = case when ${has('socials')} then ${deps.sql.json(f.socials ?? {})}::jsonb else socials end,
      contact = case when ${has('contact')} then ${deps.sql.json(f.contact ?? { enabled: false, channels: [] })}::jsonb else contact end,
      profile_updated_at = ${deps.now()}
    where id = ${userId}
  `;
  await audit(deps.sql, userId, 'user', userId, 'profile.update', {
    fields: Object.keys(f),
  });
  return loadOwnProfile(deps, userId);
}

export async function uploadProfileImage(
  deps: Deps,
  userId: string,
  kind: 'avatar' | 'banner',
  body: Uint8Array,
) {
  if (body.length > IMAGE_MAX_BYTES)
    throw new HttpError(413, 'IMAGE_TOO_LARGE', 'images are limited to 3 MB');
  let clean;
  try {
    clean = cleanImage(body);
  } catch (err) {
    if (err instanceof ImageError) throw new HttpError(400, err.code, err.message);
    throw err;
  }
  if (kind === 'avatar' && (clean.width < 64 || clean.height < 64)) {
    throw new HttpError(400, 'IMAGE_TOO_SMALL', 'avatars need at least 64×64 pixels');
  }
  const count = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from profile_media where user_id = ${userId}
  `;
  if ((count[0]?.n ?? 0) >= PROFILE_MEDIA_MAX) {
    throw new HttpError(400, 'MEDIA_LIMIT', 'too many profile images uploaded');
  }
  clean = await optimized(deps, clean);
  const sha = await sha256Hex(clean.bytes);
  const key = `profile/${sha}.${extensionOf(clean.mime)}`;
  await deps.blob.put(key, clean.bytes);
  const inserted = await deps.sql<Row[]>`
    insert into profile_media (user_id, kind, r2_key, sha256, mime, width, height, bytes)
    values (${userId}, ${kind}, ${key}, ${sha}, ${clean.mime}, ${clean.width}, ${clean.height}, ${clean.bytes.length})
    returning id
  `;
  const id = inserted[0]!.id as string;
  if (kind === 'avatar')
    await deps.sql`update users set avatar_media_id = ${id} where id = ${userId}`;
  else await deps.sql`update users set banner_media_id = ${id} where id = ${userId}`;
  await audit(deps.sql, userId, 'user', userId, `profile.${kind}`, { imageId: id, sha256: sha });
  return { id, url: profileMediaUrl(id), width: clean.width, height: clean.height };
}

export async function removeProfileImage(deps: Deps, userId: string, kind: 'avatar' | 'banner') {
  if (kind === 'avatar')
    await deps.sql`update users set avatar_media_id = null where id = ${userId}`;
  else await deps.sql`update users set banner_media_id = null where id = ${userId}`;
}

/** Public while it is someone's current avatar or banner; otherwise 404. */
export async function profileMediaResponse(deps: Deps, id: string): Promise<Response> {
  const notFound = () =>
    Response.json({ error: { code: 'NOT_FOUND', message: 'image not found' } }, { status: 404 });
  if (!UUID.test(id)) return notFound();
  const rows = await deps.sql<Row[]>`
    select m.* from profile_media m join users u on u.id = m.user_id
    where m.id = ${id} and (u.avatar_media_id = m.id or u.banner_media_id = m.id)
  `;
  const row = rows[0];
  if (!row) return notFound();
  const bytes = await deps.blob.get(row.r2_key as string);
  if (!bytes) return notFound();
  return new Response(bytes, {
    headers: {
      'content-type': row.mime as string,
      'content-length': String(bytes.length),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-site',
      'referrer-policy': 'no-referrer',
      etag: `"${row.sha256}"`,
      'cache-control': 'public, max-age=3600',
    },
  });
}

/** Resolves /u/:key: a handle, a verified X handle, or a wallet address. */
export async function findCreator(deps: Deps, key: string): Promise<Row | null> {
  const value = key.replace(/^@/, '');
  const rows = await deps.sql<Row[]>`
    select * from users
    where lower(handle) = ${value.toLowerCase()}
       or (lower(x_handle) = ${value.toLowerCase()} and x_user_id is not null and x_user_id not like 'dev:%')
       or (${WALLET.test(value)} and wallet = ${value})
    order by (lower(handle) = ${value.toLowerCase()}) desc nulls last
    limit 1
  `;
  return rows[0] ?? null;
}

/** Real numbers only: callers hide what is zero or missing where that reads as a claim. */
export async function creatorStats(deps: Deps, creatorId: string) {
  const [sales] = await deps.sql<Row[]>`
    select count(*)::int as total,
      count(*) filter (where o.paid_at > ${deps.now()}::timestamptz - interval '30 days')::int as last30
    from orders o join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId} and o.status in ('paid', 'released')
  `;
  const [rating] = await deps.sql<Row[]>`
    select count(*)::int as count, avg(r.rating)::float as avg
    from listing_reviews r join listings l on l.id = r.listing_id
    where l.creator_id = ${creatorId}
  `;
  const [listings] = await deps.sql<Row[]>`
    select count(*) filter (where live_version_id is not null and delisted_at is null and paused_at is null)::int as live
    from listings where creator_id = ${creatorId}
  `;
  const [versions] = await deps.sql<Row[]>`
    select count(*)::int as shipped from versions v join listings l on l.id = v.listing_id
    where l.creator_id = ${creatorId} and v.status in ('live', 'superseded')
  `;
  const [disputes] = await deps.sql<Row[]>`
    select count(*) filter (where d.status = 'upheld')::int as upheld,
      count(*) filter (where d.status <> 'open')::int as resolved
    from disputes d join orders o on o.id = d.order_id join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId}
  `;
  return {
    sales: sales?.total ?? 0,
    sales30d: sales?.last30 ?? 0,
    ratingCount: rating?.count ?? 0,
    ratingAvg: rating?.count ? Math.round((rating.avg as number) * 10) / 10 : null,
    liveListings: listings?.live ?? 0,
    versionsShipped: versions?.shipped ?? 0,
    disputesUpheld: disputes?.upheld ?? 0,
    disputesResolved: disputes?.resolved ?? 0,
  };
}

export async function creatorReviews(deps: Deps, creatorId: string, limit = 5) {
  const rows = await deps.sql<Row[]>`
    select r.rating, r.body, r.created_at, l.title, l.slug, u.wallet as buyer_wallet
    from listing_reviews r
    join listings l on l.id = r.listing_id
    join orders o on o.id = r.order_id
    join users u on u.id = o.buyer_id
    where l.creator_id = ${creatorId}
    order by r.created_at desc limit ${limit}
  `;
  return rows.map((row) => ({
    rating: row.rating as number,
    body: row.body as string,
    createdAt: row.created_at,
    listing: { title: row.title as string, slug: row.slug as string },
    buyer: `${(row.buyer_wallet as string).slice(0, 4)}…${(row.buyer_wallet as string).slice(-4)}`,
  }));
}

async function boughtFrom(deps: Deps, viewerId: string | null, creatorId: string) {
  if (!viewerId) return false;
  if (viewerId === creatorId) return true;
  const rows = await deps.sql`
    select 1 from orders o join listings l on l.id = o.listing_id
    where o.buyer_id = ${viewerId} and l.creator_id = ${creatorId}
      and o.status in ('paid', 'released', 'disputed')
    limit 1
  `;
  return rows.length > 0;
}

/** Everything the public profile page shows, minus the listings (added by the route). */
export async function publicProfile(deps: Deps, creator: Row, viewerId: string | null) {
  const creatorId = creator.id as string;
  const [stats, reviews, bond, isBuyer, config] = await Promise.all([
    creatorStats(deps, creatorId),
    creatorReviews(deps, creatorId),
    activeBond(deps.sql, creatorId),
    boughtFrom(deps, viewerId, creatorId),
    loadConfig(deps),
  ]);
  const contact = contactOf(creator);
  return {
    handle: creator.handle ?? null,
    wallet: creator.wallet as string,
    displayName: creator.display_name ?? null,
    bio: creator.bio ?? null,
    avatar: image(creator.avatar_media_id),
    banner: image(creator.banner_media_id),
    xHandle: creator.x_handle ?? null,
    xVerified: isXVerified(creator),
    socials: socialsOf(creator),
    contact: visibleContact(contact, isBuyer),
    contactHiddenForBuyers:
      contact.enabled && !isBuyer && contact.channels.some((c) => c.audience === 'buyers'),
    memberSince: creator.created_at,
    bond,
    escrowHours: config.escrow_hours,
    stats,
    reviews,
    isOwner: viewerId === creatorId,
  };
}
