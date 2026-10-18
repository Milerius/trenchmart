import { describe, expect, it } from 'vitest';
import { mediaSrcSet, mediaThumb } from './media';

const URL = '/api/v1/media/a3f1c2d4-1111-4222-8333-444455556666';

describe('responsive listing images', () => {
  it('offers phone, tablet and full widths for listing media', () => {
    expect(mediaSrcSet(URL)).toBe(`${URL}?w=480 480w, ${URL}?w=960 960w, ${URL} 1600w`);
    expect(mediaThumb(URL)).toBe(`${URL}?w=480`);
  });
  it('leaves other images alone', () => {
    expect(mediaSrcSet('https://example.com/a.png')).toBeUndefined();
    expect(mediaThumb('/logo.svg')).toBe('/logo.svg');
  });
});
