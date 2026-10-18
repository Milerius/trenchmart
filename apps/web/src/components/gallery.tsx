'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

// The lightbox loads only when someone opens an image.
const Lightbox = dynamic(() => import('./lightbox').then((m) => m.Lightbox), { ssr: false });

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
          fetchPriority="high"
          decoding="async"
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
                <img
                  src={image.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
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
