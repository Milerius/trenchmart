import { describe, expect, it } from 'vitest';
import {
  actionFor,
  ago,
  barShare,
  bucketOf,
  sparkPoints,
  statusNote,
  statusOf,
  type OverviewListing,
} from './dashboard';

const base: OverviewListing = {
  id: 'L1',
  slug: 'pack',
  title: 'Pack',
  category: 'userscript',
  price: '1000000000',
  updatePrice: '100000000',
  delisted: false,
  paused: false,
  coverUrl: null,
  live: null,
  latest: null,
  sales: 0,
  sales7d: 0,
  subscribers: 0,
  rating: null,
};
const NOW = Date.parse('2026-10-18T12:00:00Z');
const at = new Date(NOW - 3 * 86_400_000).toISOString();

describe('dashboard rows', () => {
  it('a live listing offers a new version', () => {
    const l = {
      ...base,
      live: { semver: '1.0.0', status: 'live' },
      latest: { id: 'V1', semver: '1.0.0', status: 'live', at },
    };
    expect(statusOf(l)).toBe('live');
    expect(bucketOf(l)).toBe('live');
    expect(actionFor(l)).toMatchObject({
      testid: 'upload-new-version',
      href: '/studio/listings/L1/versions/new',
    });
    expect(statusNote(l, NOW)).toBe('live · updated 3d ago');
  });

  it('a new version waiting on a note shows that, while the old one stays live', () => {
    const l = {
      ...base,
      live: { semver: '1.0.0', status: 'live' },
      latest: { id: 'V2', semver: '1.1.0', status: 'needs_creator', at },
    };
    expect(statusOf(l)).toBe('needs_creator');
    expect(bucketOf(l)).toBe('review');
    expect(actionFor(l)).toMatchObject({
      label: 'Add review note',
      href: '/studio/listings/L1/versions/V2',
    });
    expect(statusNote(l, NOW)).toBe('v1.0.0 stays live meanwhile');
  });

  it('first upload under review, unfinished upload, rejected and delisted', () => {
    const review = { ...base, latest: { id: 'V1', semver: '1.0.0', status: 'scanning', at } };
    expect(bucketOf(review)).toBe('review');
    expect(actionFor(review)?.testid).toBe('watch-review');
    const uploading = { ...base, latest: { id: 'V1', semver: '1.0.0', status: 'uploading', at } };
    expect(bucketOf(uploading)).toBe('draft');
    expect(actionFor(uploading)?.testid).toBe('finish-upload');
    const rejected = { ...base, latest: { id: 'V1', semver: '1.0.0', status: 'rejected', at } };
    expect(bucketOf(rejected)).toBe('off');
    expect(actionFor(rejected)).toBeNull();
    const delisted = { ...base, delisted: true, live: { semver: '1.0.0', status: 'delisted' } };
    expect(statusOf(delisted)).toBe('delisted');
    expect(actionFor(delisted)).toBeNull();
    expect(bucketOf({ ...base })).toBe('draft');
  });
});

describe('dashboard charts', () => {
  it('draws nothing for an all-zero series', () => {
    expect(sparkPoints([0, 0, 0])).toBeNull();
    expect(sparkPoints([])).toBeNull();
  });
  it('scales the series to the box', () => {
    expect(sparkPoints(['0', '5', '10'], 100, 22)).toBe('0,20 50,11 100,2');
  });
  it('bar shares and relative times', () => {
    expect(barShare(1, [1, 1, 2])).toBe(25);
    expect(barShare(0, [0, 0])).toBe(0);
    expect(ago(new Date(NOW - 30 * 60_000).toISOString(), NOW)).toBe('30m ago');
    expect(ago(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe('yesterday');
  });
});
