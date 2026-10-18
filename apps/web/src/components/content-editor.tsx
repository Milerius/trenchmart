'use client';

import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { MARKDOWN_MAX_CHARS } from '@trenchmart/shared';
import { Markdown, MediaPreviewContext } from '@/components/markdown';
import { Button, Label, Tag } from '@/components/ui';
import type { ContentField } from '@/lib/listing-templates';

/** Shared by the New listing form and the listing page editor. */
export type GalleryItem = {
  id: string;
  url: string;
  alt: string;
  uploading?: boolean;
  /** Picked on the New listing form; uploaded when the listing is created. */
  file?: File;
};

export const MAX_IMAGES = 12;
export const MAX_IMAGE_MB = 3;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const CONTENT_FIELDS: [ContentField, string, string][] = [
  ['readme', 'README', 'Overview tab: what it does, why it is safe, what buyers get.'],
  ['howto', 'How to use', 'Install steps. Number them; buyers follow these exactly.'],
  ['requirements', 'Requirements', 'Browser, extension, terminal, plan. Shown next to the guide.'],
];
export const CONTENT_MAX_CHARS: Record<ContentField, number> = {
  readme: MARKDOWN_MAX_CHARS,
  howto: MARKDOWN_MAX_CHARS,
  requirements: 5_000,
};

/** Checks type and size before anything is uploaded. Returns an error message or null. */
export function imageProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name}: PNG, JPEG or WebP only.`;
  if (file.size > MAX_IMAGE_MB * 1024 * 1024)
    return `${file.name}: larger than ${MAX_IMAGE_MB} MB.`;
  return null;
}

export function mediaPath(id: string): string {
  return `/api/v1/media/${id}`;
}

export function GalleryEditor({
  images,
  setImages,
  cover,
  setCover,
  onFiles,
  onRemove,
  note,
}: {
  images: GalleryItem[];
  setImages: (update: (list: GalleryItem[]) => GalleryItem[]) => void;
  cover: string | null;
  setCover: (id: string) => void;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  note?: ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const coverId = images.some((image) => image.id === cover) ? cover : (images[0]?.id ?? null);

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
    if (event.dataTransfer.files.length) onFiles([...event.dataTransfer.files]);
  }

  return (
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
      {note}
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
          id="images"
          type="file"
          multiple
          accept={IMAGE_TYPES.join(',')}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) onFiles([...event.target.files]);
            event.target.value = '';
          }}
        />
      </label>
      {images.length ? (
        <ol data-testid="image-grid" className="m-0 grid gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
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
                image.id === coverId ? 'border-accent-line' : 'border-line'
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
                {image.id === coverId ? (
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
                    variant={image.id === coverId ? 'secondary' : 'ghost'}
                    disabled={image.uploading || image.id === coverId}
                    onClick={() => setCover(image.id)}
                    className="!h-8 flex-1 !px-2"
                  >
                    {image.id === coverId ? 'Cover' : 'Set as cover'}
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
                    onClick={() => onRemove(image.id)}
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
  );
}

type Edit = { before: string; after: string; placeholder: string; block?: boolean; line?: string };
const TOOLS: { key: string; label: string; title: string; shortcut?: string; edit: Edit }[] = [
  {
    key: 'h2',
    label: 'H2',
    title: 'Heading',
    edit: { before: '', after: '', placeholder: 'Heading', line: '## ' },
  },
  {
    key: 'h3',
    label: 'H3',
    title: 'Subheading',
    edit: { before: '', after: '', placeholder: 'Subheading', line: '### ' },
  },
  {
    key: 'b',
    label: 'B',
    title: 'Bold',
    shortcut: 'b',
    edit: { before: '**', after: '**', placeholder: 'bold text' },
  },
  {
    key: 'i',
    label: 'I',
    title: 'Italic',
    shortcut: 'i',
    edit: { before: '_', after: '_', placeholder: 'italic text' },
  },
  {
    key: 'ul',
    label: '•',
    title: 'Bulleted list',
    edit: { before: '', after: '', placeholder: 'Item', line: '- ' },
  },
  {
    key: 'ol',
    label: '1.',
    title: 'Numbered list',
    edit: { before: '', after: '', placeholder: 'Step', line: '1. ' },
  },
  {
    key: 'code',
    label: '</>',
    title: 'Code',
    shortcut: 'e',
    edit: { before: '`', after: '`', placeholder: 'code' },
  },
  {
    key: 'link',
    label: 'Link',
    title: 'Link',
    shortcut: 'k',
    edit: { before: '[', after: '](https://)', placeholder: 'link text' },
  },
];

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Markdown textarea with a formatting toolbar, shortcuts (⌘/Ctrl + B, I, E, K), image insert
 * from the gallery and a live preview: side by side on wide screens, Write/Preview tabs on
 * narrow ones.
 */
export function MarkdownEditor({
  value,
  onChange,
  maxChars,
  label,
  gallery,
  previews,
  actions,
}: {
  value: string;
  onChange: (value: string) => void;
  maxChars: number;
  label: string;
  gallery: GalleryItem[];
  /** media id → local object URL, for images not uploaded yet. */
  previews?: Record<string, string>;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [picking, setPicking] = useState(false);
  const mod = isMac() ? '⌘' : 'Ctrl+';

  function apply(edit: Edit) {
    const area = ref.current;
    if (!area) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = value.slice(start, end) || edit.placeholder;
    let insert: string;
    if (edit.line) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const prefix = start === lineStart ? '' : '\n';
      insert = `${prefix}${selected
        .split('\n')
        .map((row, index) => (edit.line === '1. ' ? `${index + 1}. ` : edit.line) + row)
        .join('\n')}`;
    } else {
      insert = `${edit.before}${selected}${edit.after}`;
    }
    const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
    if (next.length > maxChars) return;
    onChange(next);
    requestAnimationFrame(() => {
      area.focus();
      const caret = start + insert.length - edit.after.length;
      area.setSelectionRange(caret - selected.length, caret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const tool = TOOLS.find((item) => item.shortcut === event.key.toLowerCase());
    if (tool) {
      event.preventDefault();
      apply(tool.edit);
    }
  }

  function insertImage(image: GalleryItem) {
    setPicking(false);
    apply({
      before: `![${image.alt || 'Screenshot'}](`,
      after: ')',
      placeholder: mediaPath(image.id),
    });
  }

  const ready = gallery.filter((image) => !image.uploading);
  const preview = (
    <div
      data-testid="md-preview"
      className="mt-1.5 max-h-[560px] min-h-[320px] overflow-auto rounded-ctl border border-line bg-bg p-4"
    >
      {value.trim() ? (
        <MediaPreviewContext.Provider value={previews ?? {}}>
          <Markdown source={value} className="text-[14px]" />
        </MediaPreviewContext.Provider>
      ) : (
        <p className="m-0 text-sm text-faint">Nothing to preview yet.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="toolbar"
          aria-label={`${label} formatting`}
          className="flex flex-wrap items-center gap-1 rounded-ctl border border-line-control bg-inset p-1"
        >
          {TOOLS.map((tool) => (
            <button
              key={tool.key}
              type="button"
              title={
                tool.shortcut ? `${tool.title} (${mod}${tool.shortcut.toUpperCase()})` : tool.title
              }
              aria-label={tool.title}
              onClick={() => apply(tool.edit)}
              className={`motion-press grid h-8 min-w-8 place-items-center rounded-tag px-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink ${
                tool.key === 'b' ? 'font-bold' : tool.key === 'i' ? 'italic' : 'font-mono'
              }`}
            >
              {tool.label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={picking}
              disabled={!ready.length}
              title={ready.length ? 'Insert an image from your gallery' : 'Add images above first'}
              onClick={() => setPicking((open) => !open)}
              className="motion-press inline-flex h-8 items-center gap-1 rounded-tag px-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:text-faint"
            >
              🖼 Image
            </button>
            {picking ? (
              <ul
                role="menu"
                className="absolute left-0 top-9 z-20 m-0 grid w-64 grid-cols-3 gap-1.5 rounded-card border border-line bg-surface p-2 shadow-lg"
              >
                {ready.map((image, index) => (
                  <li key={image.id} role="none" className="list-none">
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={`Insert image ${index + 1}`}
                      onClick={() => insertImage(image)}
                      className="block aspect-[16/10] w-full overflow-hidden rounded-tag border border-line hover:border-accent-line"
                    >
                      <img src={image.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <div
            role="tablist"
            aria-label="View"
            className="flex rounded-ctl border border-line-control p-0.5 lg:hidden"
          >
            {(['write', 'preview'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={`rounded-tag px-3 py-1 text-[13px] ${mode === key ? 'bg-surface-2 text-ink' : 'text-muted'}`}
              >
                {key === 'write' ? 'Write' : 'Preview'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={mode === 'preview' ? 'hidden lg:block' : ''}>
          <Label>Markdown</Label>
          <textarea
            ref={ref}
            data-testid="md-editor"
            aria-label={`${label} Markdown`}
            value={value}
            maxLength={maxChars}
            onKeyDown={onKeyDown}
            onChange={(event) => onChange(event.target.value)}
            rows={20}
            className="mt-1.5 min-h-[320px] w-full resize-y rounded-ctl border border-line-control bg-inset px-3 py-2.5 font-mono text-[13px] leading-relaxed placeholder:text-faint"
          />
          <p className="m-0 mt-1 text-xs text-muted">
            {mod}B bold · {mod}I italic · {mod}E code · {mod}K link
          </p>
        </div>
        <div className={`min-w-0 ${mode === 'write' ? 'hidden lg:block' : ''}`}>
          <Label>Live preview</Label>
          {preview}
        </div>
      </div>
    </div>
  );
}

/** README / How to use / Requirements tabs with per-tab counters around a MarkdownEditor. */
export function ContentTabs({
  text,
  setText,
  gallery,
  previews,
  actions,
  intro,
}: {
  text: Record<ContentField, string>;
  setText: (update: (value: Record<ContentField, string>) => Record<ContentField, string>) => void;
  gallery: GalleryItem[];
  previews?: Record<string, string>;
  actions?: (field: ContentField) => ReactNode;
  intro?: ReactNode;
}) {
  const [field, setField] = useState<ContentField>('readme');
  const current = CONTENT_FIELDS.find(([key]) => key === field)!;
  return (
    <section
      className="overflow-hidden rounded-panel border border-line bg-surface"
      aria-labelledby="text-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 pt-4">
        <h2 id="text-title" className="sr-only">
          Listing page text
        </h2>
        <div role="tablist" aria-label="Section" className="flex gap-1">
          {CONTENT_FIELDS.map(([key, label]) => (
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
              <span className="ml-1.5 font-mono text-[11px] text-muted">
                {text[key].trim() ? '●' : '○'}
              </span>
            </button>
          ))}
        </div>
        <span data-testid="md-counter" className="pb-2 font-mono text-[11px] text-muted">
          {text[field].length.toLocaleString('en-US')} /{' '}
          {CONTENT_MAX_CHARS[field].toLocaleString('en-US')}
        </span>
      </div>
      {intro}
      <p className="m-0 px-5 pt-3 text-xs text-muted">
        {current[2]} Markdown: headings, lists, code, tables, links. Raw HTML shows as text; images
        only from your uploads.
      </p>
      <div className="p-5 pt-3">
        <MarkdownEditor
          key={field}
          label={current[1]}
          value={text[field]}
          maxChars={CONTENT_MAX_CHARS[field]}
          onChange={(value) => setText((all) => ({ ...all, [field]: value }))}
          gallery={gallery}
          previews={previews}
          actions={actions?.(field)}
        />
      </div>
    </section>
  );
}
