/**
 * Listing images are converted to WebP (max 1600 px wide, q 0.8) in the browser before
 * upload: a 354 KB PNG cover made LCP 7.1 s, and re-encoding in the API Worker exceeds its
 * CPU limit. Falls back to the original file when the browser cannot encode WebP or the
 * result is not smaller. GIFs are left alone (animation).
 */
export const WEBP_MAX_WIDTH = 1600;

export async function toWebp(file: File): Promise<File> {
  if (!/^image\/(png|jpeg)$/.test(file.type) || typeof createImageBitmap !== 'function')
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, WEBP_MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.8),
    );
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.webp', {
      type: 'image/webp',
    });
  } catch {
    return file;
  }
}

/** Narrower copies the API serves for `?w=` (apps/api content.ts MEDIA_WIDTHS). */
export const COPY_WIDTHS = [480, 960, 1200] as const;

/**
 * WebP copies of an uploaded image at each COPY_WIDTHS narrower than it. Heights follow the
 * API's rule (rounded, same aspect ratio). Empty when the browser cannot encode WebP.
 */
export async function webpCopies(file: Blob): Promise<{ width: number; blob: Blob }[]> {
  if (typeof createImageBitmap !== 'function') return [];
  const out: { width: number; blob: Blob }[] = [];
  try {
    const bitmap = await createImageBitmap(file);
    for (const width of COPY_WIDTHS) {
      if (width >= bitmap.width) continue;
      const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.8),
      );
      if (!blob || blob.type !== 'image/webp') break;
      // A copy that is not smaller than the upload saves nothing (the API redirects instead).
      if (blob.size < file.size) out.push({ width, blob });
    }
    bitmap.close();
  } catch {
    // Copies are an optimisation: without them the API redirects to the original.
  }
  return out;
}

/** Uploads the copies after the image itself; failures are ignored (the original still works). */
export async function uploadCopies(
  send: (path: string, init: RequestInit) => Promise<unknown>,
  listingId: string,
  imageId: string,
  file: Blob,
): Promise<number> {
  let sent = 0;
  for (const copy of await webpCopies(file)) {
    try {
      await send(`/studio/listings/${listingId}/images/${imageId}/w/${copy.width}`, {
        method: 'PUT',
        headers: { 'content-type': 'image/webp' },
        body: copy.blob,
      });
      sent += 1;
    } catch {
      // Keep going: each width is independent.
    }
  }
  return sent;
}
