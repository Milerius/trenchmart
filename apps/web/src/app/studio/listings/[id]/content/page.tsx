'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ContentTabs,
  GalleryEditor,
  imageProblem,
  MAX_IMAGES,
  type GalleryItem,
} from '@/components/content-editor';
import { ListingCard, type Listing } from '@/components/listings';
import { Button, ButtonLink, Label, Money, Panel, Square, StatusTag, Tag } from '@/components/ui';
import { solToLamports } from '@trenchmart/shared';
import { solExact } from '@/lib/money';
import type { ContentField } from '@/lib/listing-templates';
import { toWebp } from '@/lib/webp';
import { api, ApiError } from '@/lib/api';
import { useSolUsd } from '@/lib/config';

type StudioImage = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
};
type Check = { ruleId: string; result: string; title: string; detail: string };
type Content = {
  listing: Listing & {
    id: string;
    liveVersionId?: string | null;
    updatePrice?: string | null;
    delistedAt?: string | null;
  };
  status: 'draft' | 'in_review' | 'live' | 'needs_changes' | 'rejected';
  draft: {
    readme: string;
    howto: string;
    requirements: string;
    gallery: { imageId: string; alt: string }[];
    coverImageId: string | null;
  };
  images: StudioImage[];
  checks: Check[];
  review: { decision: string; notes: string } | null;
};
export default function ContentEditorPage() {
  const params = useParams<{ id: string }>();
  const centsPerSol = useSolUsd();
  const [content, setContent] = useState<Content | null>(null);
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [text, setText] = useState<Record<ContentField, string>>({
    readme: '',
    howto: '',
    requirements: '',
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void api<Content>(`/studio/listings/${params.id}/content`)
      .then((loaded) => {
        setContent(loaded);
        const byId = new Map(loaded.images.map((image) => [image.id, image]));
        setImages(
          loaded.draft.gallery
            .map((entry) => {
              const image = byId.get(entry.imageId);
              return image ? { ...image, alt: entry.alt } : null;
            })
            .filter((image): image is StudioImage => image !== null),
        );
        setCover(loaded.draft.coverImageId);
        setText({
          readme: loaded.draft.readme,
          howto: loaded.draft.howto,
          requirements: loaded.draft.requirements,
        });
      })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof ApiError && err.status === 404
            ? 'Listing not found, or it is not yours.'
            : err instanceof ApiError && err.status === 401
              ? 'Sign in to edit this page.'
              : err instanceof Error
                ? err.message
                : 'Could not load this page.',
        );
      });
  }, [params.id]);

  async function upload(files: File[]) {
    setMessage('');
    for (const file of files.slice(0, MAX_IMAGES - images.length)) {
      const problem = imageProblem(file);
      if (problem) {
        setMessage(problem);
        continue;
      }
      const temp = `uploading-${crypto.randomUUID()}`;
      setImages((list) => [
        ...list,
        {
          id: temp,
          url: URL.createObjectURL(file),
          alt: '',
          uploading: true,
        },
      ]);
      try {
        const upload = await toWebp(file);
        const saved = await api<StudioImage>(`/studio/listings/${params.id}/images`, {
          method: 'POST',
          headers: { 'content-type': upload.type },
          body: upload,
        });
        setImages((list) => list.map((image) => (image.id === temp ? saved : image)));
        setCover((value) => value ?? saved.id);
      } catch (err) {
        setImages((list) => list.filter((image) => image.id !== temp));
        setMessage(err instanceof Error ? err.message : 'upload failed');
      }
    }
  }

  async function remove(id: string) {
    setImages((list) => list.filter((item) => item.id !== id));
    setMessage('');
    try {
      // Frees the upload slot. An image on the live page stays until a new page is approved.
      await api(`/studio/listings/${params.id}/images/${id}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'IMAGE_LIVE')) {
        setMessage(err instanceof Error ? err.message : 'remove failed');
      }
    }
  }

  async function save(review: boolean) {
    setMessage('');
    setBusy(review ? 'Submitting for review…' : 'Saving…');
    try {
      const gallery = images.filter((image) => !image.uploading);
      const coverId = gallery.some((image) => image.id === cover)
        ? cover
        : (gallery[0]?.id ?? null);
      await api(`/studio/listings/${params.id}/content`, {
        method: 'PUT',
        body: JSON.stringify({
          ...text,
          coverImageId: coverId,
          gallery: gallery.map((image) => ({ imageId: image.id, alt: image.alt })),
        }),
      });
      if (review) {
        const result = await api<Pick<Content, 'status' | 'checks' | 'review'>>(
          `/studio/listings/${params.id}/content/review`,
          { method: 'POST', body: JSON.stringify(note.trim() ? { note: note.trim() } : {}) },
        );
        setContent((value) => (value ? { ...value, ...result } : value));
      } else {
        setContent((value) => (value ? { ...value, status: 'draft' } : value));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy('');
    }
  }

  const coverImage = images.find((image) => image.id === cover) ?? images[0];
  const preview: Listing | null = content
    ? {
        ...content.listing,
        cover: coverImage ? { url: coverImage.url, alt: coverImage.alt } : null,
        imageCount: images.length,
      }
    : null;

  return (
    <div data-testid="studio" className="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[32px] font-semibold tracking-[-0.03em]">Listing page</h1>
          <p className="m-0 mt-1 text-ink-2">
            {content ? (
              <span className="text-ink">{content.listing.title}</span>
            ) : loadError ? (
              <span role="alert" className="text-danger">
                {loadError}
              </span>
            ) : (
              'Loading…'
            )}{' '}
            · images, README and install guide. Buyers see it once the automated review approves it.
          </p>
        </div>

        <GalleryEditor
          images={images}
          setImages={setImages}
          cover={cover}
          setCover={setCover}
          onFiles={(files) => void upload(files)}
          onRemove={(id) => void remove(id)}
        />
        <ContentTabs text={text} setText={setText} gallery={images} />
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="rounded-panel border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <Label>Page review</Label>
            {content ? (
              <StatusTag
                status={
                  content.status === 'in_review'
                    ? 'in_review'
                    : content.status === 'needs_changes'
                      ? 'needs_creator'
                      : content.status
                }
              />
            ) : null}
          </div>
          <ol className="m-0 mt-4 space-y-3 p-0 text-sm">
            {[
              ['Links and phishing', 'schemes, lookalike domains, shorteners, seed-phrase asks'],
              ['Images', 'real PNG/JPEG/WebP, size, EXIF stripped, yours only'],
              ['Verdict', 'signed decision; warnings need your explanation'],
            ].map(([title, detail], index) => {
              const done = content?.status === 'live';
              return (
                <li key={title} className="flex list-none gap-3">
                  <Square tone={done ? 'ok' : 'neutral'}>{done ? '✓' : index + 1}</Square>
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-[13px] text-muted">{detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {content?.review ? (
            <p className="m-0 mt-4 rounded-ctl border border-line-soft bg-inset p-3 text-[13px] text-ink-2">
              {content.review.notes}
            </p>
          ) : null}
          {content &&
          content.status !== 'live' &&
          content.checks.some((check) => check.result !== 'pass') ? (
            <ul data-testid="content-findings" className="m-0 mt-3 space-y-2 p-0">
              {content.checks
                .filter((check) => check.result !== 'pass')
                .map((check) => (
                  <li key={check.ruleId} className="flex list-none gap-2 text-[13px]">
                    <Tag tone={check.result === 'fail' ? 'danger' : 'warn'}>{check.result}</Tag>
                    <span>
                      <span className="block font-medium">{check.title}</span>
                      <span className="block text-muted">{check.detail}</span>
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
          {content?.status === 'needs_changes' ? (
            <label className="mt-4 block text-sm">
              <span className="font-medium">Explain the warnings</span>
              <textarea
                data-testid="content-note"
                value={note}
                maxLength={5000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Why each flagged link or file is safe (20+ characters)"
                className="mt-1.5 w-full resize-y rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-[13px] leading-relaxed placeholder:text-faint"
              />
            </label>
          ) : null}
          <div className="mt-5 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={!!busy}
              onClick={() => void save(false)}
            >
              Save draft
            </Button>
            <Button
              className="flex-1"
              disabled={!!busy}
              aria-busy={!!busy || undefined}
              onClick={() => void save(true)}
            >
              {busy || 'Submit for review'}
            </Button>
          </div>
          {message ? (
            <p role="alert" className="m-0 mt-3 text-sm text-danger">
              {message}
            </p>
          ) : null}
        </div>
        {preview ? (
          <div className="space-y-2">
            <Label>Your card in the market</Label>
            <div className="pointer-events-none">
              <ListingCard listing={preview} pricing={{ centsPerSol }} />
            </div>
          </div>
        ) : null}
        {content ? <VersionsPanel listing={content.listing} centsPerSol={centsPerSol} /> : null}
        <Panel tone="info" className="p-4 text-[13px] text-ink-2">
          Only approved content is public. Your live page stays up while a new draft is in review.
        </Panel>
      </aside>
    </div>
  );
}

/** Upload a new version of a live listing, and set the monthly price buyers pay for updates. */
function VersionsPanel({
  listing,
  centsPerSol,
}: {
  listing: Content['listing'];
  centsPerSol: string | null;
}) {
  const [price, setPrice] = useState(() => solExact(listing.updatePrice ?? '0'));
  const [saved, setSaved] = useState(listing.updatePrice ?? '0');
  const [note, setNote] = useState('');
  const live = Boolean(listing.liveVersionId) && !listing.delistedAt;

  async function save() {
    setNote('');
    let lamports: string;
    try {
      lamports = solToLamports(price.trim() || '0').toString();
    } catch {
      setNote('Enter an amount in SOL, for example 0.1');
      return;
    }
    await api(`/studio/listings/${listing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ updatePriceLamports: lamports }),
    });
    setSaved(lamports);
    setNote('Saved.');
  }

  return (
    <div data-testid="versions-panel" className="rounded-panel border border-line bg-surface p-5">
      <Label>Versions and updates</Label>
      {live ? (
        <ButtonLink
          href={`/studio/listings/${listing.id}/versions/new`}
          data-testid="upload-new-version"
          variant="secondary"
          className="mt-3 w-full"
        >
          Upload new version
        </ButtonLink>
      ) : (
        <p className="m-0 mt-2 text-[13px] text-muted">
          New versions can be uploaded once the listing is live.
        </p>
      )}
      <label className="mt-4 block text-sm">
        <span className="font-medium">Monthly update price (SOL)</span>
        <input
          data-testid="update-price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          className="mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2 font-mono text-sm"
        />
      </label>
      <p className="m-0 mt-1 text-xs text-muted">
        Buyers get updates free for 30 days, then pay this per month (plus the platform fee). 0
        means free updates forever. Now:{' '}
        {BigInt(saved) === 0n ? (
          'free forever'
        ) : (
          <Money lamports={saved} centsPerSol={centsPerSol} />
        )}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void save().catch((err: Error) => setNote(err.message))}
        >
          Save price
        </Button>
        {note ? (
          <span role="status" className="text-[13px] text-ink-2">
            {note}
          </span>
        ) : null}
      </div>
    </div>
  );
}
