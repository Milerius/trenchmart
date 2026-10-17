'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type GalleryImage = {
  id: string;
  url: string;
  alt: string;
  width?: number;
  height?: number;
};

/** Hero image + thumbnail strip. Any image opens the lightbox. */
export function Gallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const current = images[Math.min(active, images.length - 1)]!;
  return (
    <section aria-label={`${title} images`} data-testid="gallery" className="mt-6">
      <button
        type="button"
        data-testid="gallery-hero"
        onClick={() => setOpen(active)}
        className="motion-press group relative block aspect-[16/9] w-full overflow-hidden rounded-panel border border-line bg-inset"
      >
        <img
          src={current.url}
          alt={current.alt || `${title} image ${active + 1}`}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.015]"
        />
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-tag border border-line bg-bg/80 px-2.5 py-1 font-mono text-[11px] text-ink-2 backdrop-blur">
          <span aria-hidden="true">⤢</span> {active + 1} / {images.length} · View gallery
        </span>
      </button>
      {images.length > 1 ? (
        <ul
          data-testid="gallery-thumbs"
          className="m-0 mt-3 flex gap-2 overflow-x-auto p-0 pb-1"
          aria-label="Choose an image"
        >
          {images.map((image, index) => (
            <li key={image.id} className="list-none">
              <button
                type="button"
                aria-label={`Show image ${index + 1}${image.alt ? `: ${image.alt}` : ''}`}
                aria-current={index === active || undefined}
                onClick={() => setActive(index)}
                onDoubleClick={() => setOpen(index)}
                className={`motion-press block h-[62px] w-[110px] overflow-hidden rounded-ctl border-2 bg-inset ${
                  index === active ? 'border-accent' : 'border-line opacity-70 hover:opacity-100'
                }`}
              >
                <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open !== null ? (
        <Lightbox
          images={images}
          start={open}
          title={title}
          onClose={(index) => {
            setActive(index);
            setOpen(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function Lightbox({
  images,
  start,
  title,
  onClose,
}: {
  images: GalleryImage[];
  start: number;
  title: string;
  onClose: (index: number) => void;
}) {
  const [index, setIndex] = useState(start);
  const closeRef = useRef<HTMLButtonElement>(null);
  const go = useCallback(
    (delta: number) => setIndex((value) => (value + delta + images.length) % images.length),
    [images.length],
  );
  // Keep the latest index and close handler in refs so the key listener is installed once
  // and focus moves to Close only when the dialog opens, not on every image change.
  const indexRef = useRef(index);
  indexRef.current = index;
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHandler.current(indexRef.current);
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [go]);
  const image = images[index]!;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} gallery`}
      data-testid="lightbox"
      className="picker-backdrop fixed inset-0 z-[90] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(index);
      }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <p className="m-0 min-w-0 truncate text-sm text-ink-2">
          <span className="font-mono text-[11px] text-muted">
            {index + 1} / {images.length}
          </span>
          <span className="ml-3 text-ink">{image.alt || title}</span>
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={() => onClose(index)}
          className="motion-press grid h-9 w-9 place-items-center rounded-ctl border border-line-control text-ink hover:bg-surface-2"
          aria-label="Close gallery"
        >
          ×
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-16"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose(index);
        }}
      >
        <img
          key={image.id}
          src={image.url}
          alt={image.alt || `${title} image ${index + 1}`}
          className="rise max-h-full max-w-full rounded-card border border-line object-contain"
        />
        {images.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => go(-1)}
              className="motion-press absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-line-control bg-surface/80 text-lg text-ink hover:bg-surface-2"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => go(1)}
              className="motion-press absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-line-control bg-surface/80 text-lg text-ink hover:bg-surface-2"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
      <ul className="m-0 flex justify-center gap-2 overflow-x-auto px-5 py-4">
        {images.map((thumb, thumbIndex) => (
          <li key={thumb.id} className="list-none">
            <button
              type="button"
              aria-label={`Image ${thumbIndex + 1}`}
              aria-current={thumbIndex === index || undefined}
              onClick={() => setIndex(thumbIndex)}
              className={`block h-12 w-20 overflow-hidden rounded-tag border-2 ${
                thumbIndex === index
                  ? 'border-accent'
                  : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              <img src={thumb.url} alt="" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
