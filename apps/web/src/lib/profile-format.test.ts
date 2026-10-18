import { describe, expect, it } from 'vitest';
import { ago, monthYear, shortWallet } from './profile-format';

describe('profile formatting', () => {
  it('shortens wallets', () => {
    expect(shortWallet('H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ')).toBe('H4kH…cdbZ');
  });
  it('formats member-since in UTC and rejects bad dates', () => {
    expect(monthYear('2026-03-01T00:30:00.000Z')).toBe('Mar 2026');
    expect(monthYear(null)).toBeNull();
    expect(monthYear('nope')).toBeNull();
  });
  it('gives compact relative ages', () => {
    const now = Date.parse('2026-10-18T00:00:00Z');
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(ago(at(30_000), now)).toBe('1m');
    expect(ago(at(3 * 3_600_000), now)).toBe('3h');
    expect(ago(at(2 * 86_400_000), now)).toBe('2d');
    expect(ago(at(14 * 86_400_000), now)).toBe('2w');
    expect(ago(at(90 * 86_400_000), now)).toBe('3mo');
  });
});
