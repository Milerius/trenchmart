import { z } from 'zod';
import { MARKDOWN_MAX_CHARS } from '@trenchmart/shared';
import { attestationMessage, runAiVerifier, signAttestation } from '@trenchmart/ai-verifier';
import {
  cleanImage,
  type CleanImage,
  contentMediaIds,
  extensionOf,
  ImageError,
  IMAGE_MAX_BYTES,
  scanContent,
  CONTENT_ENGINE_VER,
} from '@trenchmart/scanner';
import { audit, HttpError, loadConfig, sha256Hex, type Deps } from './logic';

export const GALLERY_MAX = 12;
/** Uploaded images per listing, including ones no longer in the draft. */
export const MEDIA_MAX = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export const contentBody = z
  .object({
    readme: z.string().max(MARKDOWN_MAX_CHARS).default(''),
    howto: z.string().max(MARKDOWN_MAX_CHARS).default(''),
    requirements: z.string().max(5_000).default(''),
    gallery: z
      .array(z.object({ imageId: z.string().regex(UUID), alt: z.string().max(200).default('') }))
      .max(GALLERY_MAX)
      .default([]),
    coverImageId: z.string().regex(UUID).nullable().default(null),
  })
  .strict();

export const reviewContentBody = z
  .object({ note: z.string().max(5_000).optional() })
  .strict()
  .default({});

export type ContentDraft = z.infer<typeof contentBody>;
type Row = Record<string, any>;

export const EMPTY_DRAFT: ContentDraft = {
  readme: '',
  howto: '',
  requirements: '',
  gallery: [],
  coverImageId: null,
};

export const mediaUrl = (id: string) => `/api/v1/media/${id}`;

function imageView(row: Row) {
  return {
    id: row.id as string,
    url: mediaUrl(row.id as string),
    mime: row.mime as string,
    width: row.width as number,
    height: row.height as number,
    bytes: row.bytes as number,
  };
}

async function contentRow(deps: Deps, listingId: string): Promise<Row | null> {
  const rows = await deps.sql<Row[]>`select * from listing_content where listing_id = ${listingId}`;
  return rows[0] ?? null;
}

async function imagesOf(deps: Deps, listingId: string): Promise<Row[]> {
  return deps.sql<Row[]>`
    select * from listing_media where listing_id = ${listingId} order by created_at, id
  `;
}

export async function uploadImage(
  deps: Deps,
  listingId: string,
  actorId: string,
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
  const count = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from listing_media where listing_id = ${listingId}
  `;
  if ((count[0]?.n ?? 0) >= MEDIA_MAX) {
    throw new HttpError(
      400,
      'MEDIA_LIMIT',
      `a listing can hold ${MEDIA_MAX} uploaded images; remove some first`,
    );
  }
  clean = await optimized(deps, clean);
  const sha = await sha256Hex(clean.bytes);
  const key = `media/${sha}.${extensionOf(clean.mime)}`;
  await deps.blob.put(key, clean.bytes);
  const inserted = await deps.sql<Row[]>`
    insert into listing_media (listing_id, r2_key, sort, sha256, mime, width, height, bytes)
    values (${listingId}, ${key}, 0, ${sha}, ${clean.mime}, ${clean.width}, ${clean.height}, ${clean.bytes.length})
    returning *
  `;
  const row = inserted[0]!;
  await audit(deps.sql, actorId, 'listing', listingId, 'image.upload', {
    imageId: row.id,
    sha256: sha,
    mime: clean.mime,
    stripped: clean.stripped,
  });
  return { ...imageView(row), alt: '', stripped: clean.stripped };
}

/** WebP re-encode when it is smaller; the result goes through the same image checks. */
export async function optimized(deps: Deps, clean: CleanImage): Promise<CleanImage> {
  if (!deps.optimizeImage) return clean;
  try {
    const out = await deps.optimizeImage(clean.bytes, clean.mime);
    if (!out) return clean;
    return { ...cleanImage(out.bytes), stripped: clean.stripped };
  } catch (err) {
    console.error('image optimize failed', (err as Error).message);
    return clean;
  }
}

/**
 * One-off backfill: re-encode stored PNG/JPEG listing images. Keeps each row's id (so the
 * approved/live page still points at it) and swaps its bytes, key, size and hash.
 */
export async function optimizeStoredImages(deps: Deps, limit = 5) {
  const rows = await deps.sql<Row[]>`
    select id, r2_key, mime, bytes from listing_media
    where mime in ('image/png', 'image/jpeg') and bytes > 60000
    order by bytes desc
    limit ${limit}
  `;
  const done: { id: string; before: number; after: number }[] = [];
  for (const row of rows) {
    const bytes = await deps.blob.get(row.r2_key as string);
    if (!bytes) continue;
    const next = await optimized(deps, { ...cleanImage(bytes), stripped: [] });
    // Not smaller as WebP: keep the original.
    if (next.mime !== 'image/webp') continue;
    const sha = await sha256Hex(next.bytes);
    const key = `media/${sha}.webp`;
    await deps.blob.put(key, next.bytes);
    await deps.sql`
      update listing_media set r2_key = ${key}, mime = ${next.mime}, sha256 = ${sha},
        width = ${next.width}, height = ${next.height}, bytes = ${next.bytes.length}
      where id = ${row.id}
    `;
    const shared = await deps.sql`select 1 from listing_media where r2_key = ${row.r2_key} limit 1`;
    if (shared.length === 0) await deps.blob.delete(row.r2_key as string);
    done.push({ id: row.id as string, before: bytes.length, after: next.bytes.length });
  }
  return done;
}

/** A narrower copy is a small WebP; the 1200 px one stays well under this. */
export const VARIANT_MAX_BYTES = 512 * 1024;

/**
 * Stores the seller's browser-made narrower copy of an uploaded image (`?w=` in
 * mediaResponse). The Worker cannot afford to re-encode (CPU limit), so the browser that
 * already converts the upload to WebP also sends the 480/960/1200 px copies.
 * Checked like any upload (sniffed WebP, metadata stripped), and it must have exactly the
 * requested width and the original's aspect ratio. Only while the image is not yet on the
 * approved public page, and never replaced: what reviewers approved is what visitors get.
 */
export async function uploadImageVariant(
  deps: Deps,
  listingId: string,
  imageId: string,
  width: number,
  body: Uint8Array,
) {
  if (!(MEDIA_WIDTHS as readonly number[]).includes(width))
    throw new HttpError(400, 'BAD_WIDTH', `width must be one of ${MEDIA_WIDTHS.join(', ')}`);
  if (body.length > VARIANT_MAX_BYTES)
    throw new HttpError(413, 'IMAGE_TOO_LARGE', 'an image copy is limited to 512 KB');
  let clean;
  try {
    clean = cleanImage(body);
  } catch (err) {
    if (err instanceof ImageError) throw new HttpError(400, err.code, err.message);
    throw err;
  }
  if (clean.mime !== 'image/webp')
    throw new HttpError(400, 'IMAGE_TYPE', 'image copies must be WebP');
  const rows = await deps.sql<Row[]>`
    select m.*, c.live from listing_media m
    left join listing_content c on c.listing_id = m.listing_id
    where m.id = ${imageId} and m.listing_id = ${listingId}
  `;
  const row = rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'image not found');
  if (((row.live?.mediaIds as string[] | undefined) ?? []).includes(imageId))
    throw new HttpError(409, 'IMAGE_LIVE', 'this image is already on the approved page');
  const original = { width: row.width as number, height: row.height as number };
  if (width >= original.width)
    throw new HttpError(400, 'BAD_WIDTH', 'a copy must be narrower than the original');
  const expectedHeight = Math.max(1, Math.round((original.height * width) / original.width));
  if (clean.width !== width || Math.abs(clean.height - expectedHeight) > 1)
    throw new HttpError(
      400,
      'IMAGE_DIMENSIONS',
      `expected ${width}x${expectedHeight}, got ${clean.width}x${clean.height}`,
    );
  const key = mediaVariantKey(imageId, width);
  if (await deps.blob.get(key)) return { width, stored: false };
  await deps.blob.put(key, clean.bytes);
  return { width, stored: true };
}

export async function deleteImage(deps: Deps, listingId: string, imageId: string) {
  const content = await contentRow(deps, listingId);
  const live = (content?.live ?? null) as Row | null;
  if (live && ((live.mediaIds as string[]) ?? []).includes(imageId)) {
    throw new HttpError(
      409,
      'IMAGE_LIVE',
      'this image is on the live page; remove it from the draft and get it reviewed first',
    );
  }
  const rows = await deps.sql<Row[]>`
    delete from listing_media where id = ${imageId} and listing_id = ${listingId} returning r2_key
  `;
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'image not found');
  const shared =
    await deps.sql`select 1 from listing_media where r2_key = ${rows[0].r2_key} limit 1`;
  if (shared.length === 0) await deps.blob.delete(rows[0].r2_key as string);
  for (const width of MEDIA_WIDTHS) await deps.blob.delete(mediaVariantKey(imageId, width));
  if (content) {
    const draft = { ...EMPTY_DRAFT, ...(content.draft as Partial<ContentDraft>) };
    const next = {
      ...draft,
      gallery: draft.gallery.filter((item) => item.imageId !== imageId),
      coverImageId: draft.coverImageId === imageId ? null : draft.coverImageId,
    };
    await deps.sql`update listing_content set draft = ${deps.sql.json(next)}, updated_at = now() where listing_id = ${listingId}`;
  }
}

function validateGallery(draft: ContentDraft, owned: Set<string>) {
  const ids = draft.gallery.map((item) => item.imageId);
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, 'GALLERY_DUPLICATE', 'an image is in the gallery twice');
  for (const id of ids) {
    if (!owned.has(id))
      throw new HttpError(
        400,
        'IMAGE_NOT_FOUND',
        'the gallery names an image this listing does not have',
      );
  }
  if (draft.coverImageId && !ids.includes(draft.coverImageId)) {
    throw new HttpError(400, 'COVER_NOT_IN_GALLERY', 'the cover must be one of the gallery images');
  }
}

export async function saveDraft(deps: Deps, listingId: string, draft: ContentDraft) {
  const owned = new Set((await imagesOf(deps, listingId)).map((row) => row.id as string));
  validateGallery(draft, owned);
  const normalised = {
    ...draft,
    coverImageId: draft.coverImageId ?? draft.gallery[0]?.imageId ?? null,
  };
  await deps.sql`
    insert into listing_content (listing_id, draft, status, updated_at)
    values (${listingId}, ${deps.sql.json(normalised)}, 'draft', now())
    on conflict (listing_id) do update set draft = excluded.draft, status = 'draft', checks = '[]'::jsonb,
      review = null, updated_at = now()
  `;
  return normalised;
}

function canonical(draft: ContentDraft): string {
  return JSON.stringify({
    readme: draft.readme,
    howto: draft.howto,
    requirements: draft.requirements,
    gallery: draft.gallery.map((item) => [item.imageId, item.alt]),
    coverImageId: draft.coverImageId,
  });
}

export async function reviewContent(deps: Deps, listingId: string, actorId: string, note?: string) {
  const row = await contentRow(deps, listingId);
  if (!row) throw new HttpError(400, 'NO_DRAFT', 'save a draft first');
  const draft = { ...EMPTY_DRAFT, ...(row.draft as Partial<ContentDraft>) };
  const images = await imagesOf(deps, listingId);
  const owned = new Set(images.map((image) => image.id as string));
  validateGallery(draft, owned);
  const config = await loadConfig(deps);
  await deps.sql`update listing_content set status = 'in_review' where listing_id = ${listingId}`;
  const checks = scanContent({
    readme: draft.readme,
    howto: draft.howto,
    requirements: draft.requirements,
    alts: draft.gallery.map((item) => item.alt),
    ownMediaIds: owned,
    blocklistHosts: config.blocklist_hosts,
  }).map(({ ruleId, result, title, detail }) => ({ ruleId, result, title, detail }));
  const galleryImages = images.filter((image) =>
    draft.gallery.some((item) => item.imageId === image.id),
  );
  checks.push({
    ruleId: 'content-image-files',
    result: 'pass',
    title: 'Image files',
    detail: galleryImages.length
      ? `${galleryImages.length} image${galleryImages.length === 1 ? '' : 's'}: type checked from the bytes (${[...new Set(galleryImages.map((i) => i.mime as string))].join(', ')}), metadata stripped, served as images only.`
      : 'No images.',
  });
  const verdict = runAiVerifier({ checks, creatorNote: note ?? null, sandboxVerdict: null });
  const decision = { ...verdict, notes: verdict.notes.replace('this version', 'this page') };
  const sha = await sha256Hex(new TextEncoder().encode(canonical(draft)));
  const issuedAt = deps.now().toISOString();
  const attestation = attestationMessage({
    versionId: `content-${listingId}`,
    sha256: sha,
    decision: decision.decision,
    issuedAt,
  });
  const signature = await signAttestation(attestation, deps.env.aiAttestSecret);
  const review = {
    agentId: decision.agentId,
    decision: decision.decision,
    notes: decision.notes,
    engine: CONTENT_ENGINE_VER,
    attestation,
    signature,
    note: note ?? null,
  };
  const status =
    decision.decision === 'approve'
      ? 'live'
      : decision.decision === 'reject'
        ? 'rejected'
        : 'needs_changes';
  if (status === 'live') {
    const mediaIds = [
      ...new Set([
        ...draft.gallery.map((item) => item.imageId),
        ...contentMediaIds([draft.readme, draft.howto, draft.requirements]),
      ]),
    ];
    await deps.sql`
      update listing_content set status = 'live', live = ${deps.sql.json({ ...draft, mediaIds })},
        live_sha256 = ${sha}, checks = ${deps.sql.json(checks)}, review = ${deps.sql.json(review)},
        reviewed_at = ${deps.now()}
      where listing_id = ${listingId}
    `;
  } else {
    await deps.sql`
      update listing_content set status = ${status}, checks = ${deps.sql.json(checks)},
        review = ${deps.sql.json(review)}, reviewed_at = ${deps.now()}
      where listing_id = ${listingId}
    `;
  }
  await audit(deps.sql, actorId, 'listing', listingId, 'content.review', {
    decision: decision.decision,
    sha256: sha,
    failing: checks.filter((c) => c.result !== 'pass').map((c) => c.ruleId),
  });
  return {
    status,
    checks,
    review: { decision: review.decision, notes: review.notes, agentId: review.agentId },
  };
}

export async function studioContent(deps: Deps, listing: Row) {
  const row = await contentRow(deps, listing.id as string);
  const images = await imagesOf(deps, listing.id as string);
  const draft = { ...EMPTY_DRAFT, ...((row?.draft ?? {}) as Partial<ContentDraft>) };
  return {
    status: (row?.status as string | undefined) ?? 'draft',
    hasLive: Boolean(row?.live),
    draft,
    images: images.map(imageView),
    checks: (row?.checks as unknown[]) ?? [],
    review: row?.review
      ? { decision: row.review.decision, notes: row.review.notes, agentId: row.review.agentId }
      : null,
  };
}

/** The approved page as buyers see it, or null if nothing passed review yet. */
export async function publicContent(deps: Deps, listingId: string) {
  const row = await contentRow(deps, listingId);
  const live = row?.live as (ContentDraft & { mediaIds: string[] }) | null | undefined;
  if (!live) return null;
  const images = new Map(
    (await imagesOf(deps, listingId)).map((image) => [image.id as string, image]),
  );
  const gallery = live.gallery
    .map((item) => {
      const image = images.get(item.imageId);
      return image ? { ...imageView(image), alt: item.alt } : null;
    })
    .filter((item) => item !== null);
  const cover = gallery.find((item) => item.id === live.coverImageId) ?? gallery[0] ?? null;
  // Cover first: the hero is the image the seller chose for the card.
  const ordered = cover ? [cover, ...gallery.filter((item) => item.id !== cover.id)] : gallery;
  return {
    readme: live.readme,
    howto: live.howto,
    requirements: live.requirements,
    gallery: ordered,
    reviewedAt: row?.reviewed_at ?? null,
  };
}

/** Serve an image: public once it is on a live page, otherwise only to the listing owner. */
/** Narrower copies of each listing image for phones and cards (`?w=`), stored next to it. */
export const MEDIA_WIDTHS = [480, 960, 1200] as const;
// Keyed by the image row, not its R2 key: identical uploads share one R2 object, and a copy
// sent for one seller's image must never show up under another seller's image.
export const mediaVariantKey = (imageId: string, width: number) =>
  `media/copies/${imageId}/w${width}.webp`;

export async function mediaResponse(
  deps: Deps,
  id: string,
  viewerId: string | null,
  width: number | null = null,
): Promise<Response> {
  const notFound = () =>
    Response.json({ error: { code: 'NOT_FOUND', message: 'image not found' } }, { status: 404 });
  if (!isUuid(id)) return notFound();
  const rows = await deps.sql<Row[]>`
    select m.*, l.creator_id, c.live from listing_media m
    join listings l on l.id = m.listing_id
    left join listing_content c on c.listing_id = m.listing_id
    where m.id = ${id}
  `;
  const row = rows[0];
  if (!row) return notFound();
  const isPublic = ((row.live?.mediaIds as string[] | undefined) ?? []).includes(id);
  const isOwner = viewerId !== null && viewerId === row.creator_id;
  if (!isPublic && !isOwner) return notFound();
  // A narrower copy when one was made for this width. Without one, redirect to the original
  // rather than answering it under the ?w= URL: that answer would be cached as immutable and
  // hide a copy made later. (Relative Location: works behind the web's /api/v1 proxy too.)
  const wanted = width !== null && (MEDIA_WIDTHS as readonly number[]).includes(width);
  const variant = wanted ? await deps.blob.get(mediaVariantKey(id, width!)) : null;
  if (wanted && !variant)
    return new Response(null, {
      status: 302,
      headers: {
        location: id,
        'cache-control': isPublic ? 'public, max-age=300' : 'private, no-store',
      },
    });
  const bytes = variant ?? (await deps.blob.get(row.r2_key as string));
  if (!bytes) return notFound();
  return new Response(bytes, {
    headers: {
      // The type comes from sniffing at upload, never from the client (variants are WebP).
      'content-type': variant ? 'image/webp' : (row.mime as string),
      'content-length': String(bytes.length),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': `inline; filename="${id}.${extensionOf(row.mime)}"`,
      'cross-origin-resource-policy': 'same-site',
      'referrer-policy': 'no-referrer',
      etag: variant ? `"${row.sha256}-w${width}"` : `"${row.sha256}"`,
      'cache-control': isPublic ? 'public, max-age=86400' : 'private, no-store',
    },
  });
}
