'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MARKDOWN_MAX_CHARS } from '@trenchmart/shared';
import { ListingCard, type Listing } from '@/components/listings';
import { Markdown } from '@/components/markdown';
import { Button, Label, Panel, Square, StatusTag, Tag } from '@/components/ui';
import { api } from '@/lib/api';
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
  listing: Listing & { id: string };
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
type Field = 'readme' | 'howto' | 'requirements';
const FIELDS: [Field, string, string][] = [
  ['readme', 'README', 'Overview tab: what it does, why it is safe, what buyers get.'],
  ['howto', 'How to use', 'Install steps. Number them; buyers follow these exactly.'],
  ['requirements', 'Requirements', 'Browser, extension, terminal, plan. Shown next to the guide.'],
];
const MAX_IMAGES = 12;
const MAX_IMAGE_MB = 3;
const MAX_CHARS: Record<Field, number> = {
  readme: MARKDOWN_MAX_CHARS,
  howto: MARKDOWN_MAX_CHARS,
  requirements: 5_000,
};

export default function ContentEditorPage() {
  const params = useParams<{ id: string }>();
  const centsPerSol = useSolUsd();
  const [content, setContent] = useState<Content | null>(null);
  const [images, setImages] = useState<(StudioImage & { uploading?: boolean })[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [text, setText] = useState<Record<Field, string>>({
    readme: '',
    howto: '',
    requirements: '',
  });
  const [field, setField] = useState<Field>('readme');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<Content>(`/studio/listings/${params.id}/content`).then((loaded) => {
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
    });
  }, [params.id]);

  async function upload(files: FileList | File[]) {
    setMessage('');
    for (const file of [...files].slice(0, MAX_IMAGES - images.length)) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        setMessage(`${file.name}: PNG, JPEG or WebP only.`);
        continue;
      }
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        setMessage(`${file.name}: larger than ${MAX_IMAGE_MB} MB.`);
        continue;
      }
      const temp = `uploading-${crypto.randomUUID()}`;
      setImages((list) => [
        ...list,
        {
          id: temp,
          url: URL.createObjectURL(file),
          alt: '',
          width: 0,
          height: 0,
          bytes: file.size,
          uploading: true,
        },
      ]);
      try {
        const saved = await api<StudioImage>(`/studio/listings/${params.id}/images`, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file,
        });
        setImages((list) => list.map((image) => (image.id === temp ? saved : image)));
        setCover((value) => value ?? saved.id);
      } catch (err) {
        setImages((list) => list.filter((image) => image.id !== temp));
        setMessage(err instanceof Error ? err.message : 'upload failed');
      }
    }
  }

  function move(id: string, to: number) {
    setImages((list) => {
      const from = list.findIndex((image) => image.id === id);
      if (from < 0 || to < 0 || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length) void upload(event.dataTransfer.files);
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
  const current = FIELDS.find(([key]) => key === field)!;

  return (
    <div data-testid="studio" className="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[32px] font-semibold tracking-[-0.03em]">Listing page</h1>
          <p className="m-0 mt-1 text-ink-2">
            {content ? <span className="text-ink">{content.listing.title}</span> : 'Loading…'} ·
            images, README and install guide. Buyers see it once AI review approves it.
          </p>
        </div>

        <section
          className="space-y-4 rounded-panel border border-line bg-surface p-5"
          aria-labelledby="images-title"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="images-title" className="m-0 text-base font-semibold">
              Images
            </h2>
            <span className="font-mono text-xs text-muted">
              {images.length} / {MAX_IMAGES} · first image leads the gallery, ★ is the card cover
            </span>
          </div>
          <label
            htmlFor="images"
            data-testid="image-drop"
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed px-6 py-8 text-center ${
              over
                ? 'border-accent bg-accent-bg'
                : 'border-line-control bg-inset hover:border-accent-line'
            }`}
          >
            <span className="text-base font-semibold">Drop screenshots here, or browse</span>
            <span className="text-[13px] text-muted">
              PNG, JPEG or WebP · up to {MAX_IMAGE_MB} MB each · 16:9 looks best · EXIF and location
              data are stripped
            </span>
            <input
              ref={fileRef}
              id="images"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => event.target.files && void upload(event.target.files)}
            />
          </label>
          {images.length ? (
            <ol
              data-testid="image-grid"
              className="m-0 grid gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
            >
              {images.map((image, index) => (
                <li
                  key={image.id}
                  draggable={!image.uploading}
                  onDragStart={() => setDragging(image.id)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (dragging && dragging !== image.id) move(dragging, index);
                  }}
                  className={`motion-card list-none overflow-hidden rounded-card border bg-inset ${
                    image.id === coverImage?.id ? 'border-accent-line' : 'border-line'
                  } ${dragging === image.id ? 'opacity-50' : ''}`}
                >
                  <div className="relative aspect-[16/10] bg-surface">
                    <img src={image.url} alt={image.alt} className="h-full w-full object-cover" />
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-tag border border-line bg-bg/80 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 backdrop-blur">
                      <span aria-hidden="true" className="cursor-grab text-muted">
                        ⋮⋮
                      </span>
                      {index + 1}
                    </span>
                    {image.id === coverImage?.id ? (
                      <Tag tone="ok" className="absolute right-2 top-2">
                        ★ COVER
                      </Tag>
                    ) : null}
                    {image.uploading ? (
                      <span className="absolute inset-0 grid place-items-center bg-bg/70 font-mono text-xs text-ink-2">
                        ◑ Checking type · stripping EXIF…
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2 p-2.5">
                    <input
                      aria-label={`Alt text for image ${index + 1}`}
                      value={image.alt}
                      maxLength={200}
                      placeholder="Describe the screenshot"
                      onChange={(event) =>
                        setImages((list) =>
                          list.map((item) =>
                            item.id === image.id ? { ...item, alt: event.target.value } : item,
                          ),
                        )
                      }
                      className="w-full rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[13px] placeholder:text-faint"
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={image.id === coverImage?.id ? 'secondary' : 'ghost'}
                        disabled={image.uploading || image.id === coverImage?.id}
                        onClick={() => setCover(image.id)}
                        className="!h-8 flex-1 !px-2"
                      >
                        {image.id === coverImage?.id ? 'Cover' : 'Set as cover'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="!h-8 !px-2"
                        aria-label="Move left"
                        disabled={index === 0}
                        onClick={() => move(image.id, index - 1)}
                      >
                        ←
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="!h-8 !px-2"
                        aria-label="Move right"
                        disabled={index === images.length - 1}
                        onClick={() => move(image.id, index + 1)}
                      >
                        →
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="!h-8 !px-2 text-danger"
                        aria-label={`Remove image ${index + 1}`}
                        onClick={() =>
                          setImages((list) => list.filter((item) => item.id !== image.id))
                        }
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section
          className="overflow-hidden rounded-panel border border-line bg-surface"
          aria-labelledby="text-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 pt-4">
            <h2 id="text-title" className="sr-only">
              Text
            </h2>
            <div role="tablist" aria-label="Section" className="flex gap-1">
              {FIELDS.map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={field === key}
                  onClick={() => setField(key)}
                  className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
                    field === key
                      ? 'border-accent text-ink'
                      : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="pb-2 font-mono text-[11px] text-muted">
              {text[field].length.toLocaleString('en-US')} /{' '}
              {MARKDOWN_MAX_CHARS.toLocaleString('en-US')}
            </span>
          </div>
          <p className="m-0 px-5 pt-3 text-xs text-muted">
            {current[2]} Markdown: headings, lists, code, tables, links. Raw HTML shows as text;
            images only from your uploads.
          </p>
          <div className="grid gap-0 p-5 pt-3 xl:grid-cols-2 xl:gap-4">
            <div>
              <Label>Markdown</Label>
              <textarea
                data-testid="md-editor"
                aria-label={`${current[1]} Markdown`}
                value={text[field]}
                maxLength={MAX_CHARS[field]}
                onChange={(event) =>
                  setText((value) => ({ ...value, [field]: event.target.value }))
                }
                rows={22}
                className="mt-1.5 w-full resize-y rounded-ctl border border-line-control bg-inset px-3 py-2.5 font-mono text-[13px] leading-relaxed placeholder:text-faint"
              />
            </div>
            <div className="min-w-0">
              <Label>Live preview</Label>
              <div
                data-testid="md-preview"
                className="mt-1.5 max-h-[520px] min-h-[200px] overflow-auto rounded-ctl border border-line bg-bg p-4"
              >
                {text[field].trim() ? (
                  <Markdown source={text[field]} className="text-[14px]" />
                ) : (
                  <p className="m-0 text-sm text-faint">Nothing to preview yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>
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
              ['AI verdict', 'signed decision; warnings need your explanation'],
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
        <Panel tone="info" className="p-4 text-[13px] text-ink-2">
          Only approved content is public. Your live page stays up while a new draft is in review.
        </Panel>
      </aside>
    </div>
  );
}
