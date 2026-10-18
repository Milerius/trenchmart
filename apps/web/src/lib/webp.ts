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
