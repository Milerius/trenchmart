import { describe, expect, it } from 'vitest';
import {
  bioHasLink,
  cleanBio,
  contactUrl,
  handleProblem,
  initialsOf,
  normalizeContact,
  normalizeProfile,
  normalizeSocial,
  profileBody,
  profileStrength,
  socialLabel,
  socialUrl,
  visibleContact,
} from './profile';

describe('handles', () => {
  it('accepts lowercase handles and refuses reserved or malformed ones', () => {
    expect(handleProblem('rugradar')).toBeNull();
    expect(handleProblem('ab')).toMatch(/3 to 20/);
    expect(handleProblem('Rug')).toMatch(/lowercase/);
    expect(handleProblem('admin')).toMatch(/reserved/);
    expect(handleProblem('trenchmart_ops')).toMatch(/reserved/);
  });
});

describe('socials', () => {
  it('strips pasted links down to the value', () => {
    expect(normalizeSocial('telegram', 'https://t.me/rugradar')).toEqual({ value: 'rugradar' });
    expect(normalizeSocial('telegram', '@rugradar')).toEqual({ value: 'rugradar' });
    expect(normalizeSocial('discord', 'discord.gg/abc-12')).toEqual({ value: 'abc-12' });
    expect(normalizeSocial('discord', 'https://discord.com/invite/xyz')).toEqual({ value: 'xyz' });
    expect(normalizeSocial('github', 'github.com/rug-radar/')).toEqual({ value: 'rug-radar' });
    expect(normalizeSocial('github', '')).toEqual({ value: null });
  });
  it('refuses bad values', () => {
    expect(normalizeSocial('telegram', 'ab')).toHaveProperty('error');
    expect(normalizeSocial('github', '-bad-')).toHaveProperty('error');
    expect(normalizeSocial('discord', 'a b')).toHaveProperty('error');
  });
  it('websites must be plain https hosts', () => {
    expect(normalizeSocial('website', 'rugradar.xyz/docs/')).toEqual({
      value: 'https://rugradar.xyz/docs',
    });
    expect(normalizeSocial('website', 'http://rugradar.xyz')).toHaveProperty('error');
    expect(normalizeSocial('website', 'https://user:pw@x.com')).toHaveProperty('error');
    expect(normalizeSocial('website', 'https://xn--80ak6aa92e.com')).toHaveProperty('error');
    expect(normalizeSocial('website', 'localhost')).toHaveProperty('error');
    expect(normalizeSocial('website', 'https://a b')).toHaveProperty('error');
    expect(normalizeSocial('website', `https://x.com/${'a'.repeat(200)}`)).toHaveProperty('error');
  });
  it('builds links and labels', () => {
    expect(socialUrl('telegram', 'x1234')).toBe('https://t.me/x1234');
    expect(socialUrl('discord', 'inv')).toBe('https://discord.gg/inv');
    expect(socialUrl('github', 'gh')).toBe('https://github.com/gh');
    expect(socialUrl('website', 'https://a.io')).toBe('https://a.io');
    expect(socialLabel('website', 'https://a.io/x')).toBe('a.io/x');
    expect(socialLabel('telegram', 'x1234')).toBe('t.me/x1234');
  });
});

describe('contact', () => {
  it('normalises each channel', () => {
    expect(normalizeContact('email', 'Me@Example.com')).toEqual({ value: 'me@example.com' });
    expect(normalizeContact('email', 'nope')).toHaveProperty('error');
    expect(normalizeContact('discord', '@Rug.Radar')).toEqual({ value: 'rug.radar' });
    expect(normalizeContact('discord', 'x')).toHaveProperty('error');
    expect(normalizeContact('telegram', 't.me/rugradar_support')).toEqual({
      value: 'rugradar_support',
    });
    expect(contactUrl({ kind: 'telegram', value: 'abcde' })).toBe('https://t.me/abcde');
    expect(contactUrl({ kind: 'email', value: 'a@b.co' })).toBe('mailto:a@b.co');
    expect(contactUrl({ kind: 'discord', value: 'abc' })).toBeNull();
  });
  it('shows buyers-only channels to buyers only, and nothing when contact is off', () => {
    const contact = {
      enabled: true,
      channels: [
        { kind: 'telegram' as const, value: 'abcde', audience: 'everyone' as const },
        { kind: 'email' as const, value: 'a@b.co', audience: 'buyers' as const },
      ],
    };
    expect(visibleContact(contact, false)).toHaveLength(1);
    expect(visibleContact(contact, true)).toHaveLength(2);
    expect(visibleContact({ ...contact, enabled: false }, true)).toEqual([]);
    expect(visibleContact(null, true)).toEqual([]);
  });
});

describe('bio and names', () => {
  it('cleans invisible characters and refuses links', () => {
    expect(cleanBio(' a\u202e b \r\n\n\n\nc ')).toBe('a b\n\nc');
    expect(bioHasLink('see https://x.com')).toBe(true);
    expect(bioHasLink('join t.me/abc')).toBe(true);
    expect(bioHasLink('rugradar.xyz is mine')).toBe(true);
    expect(bioHasLink('Bundle detection since 2024. No keys.')).toBe(false);
  });
  it('initials', () => {
    expect(initialsOf('Rug Radar', 'x')).toBe('RR');
    expect(initialsOf(null, 'rugradar')).toBe('RU');
    expect(initialsOf('', '')).toBe('?');
  });
});

describe('normalizeProfile', () => {
  it('returns clean fields', () => {
    const input = profileBody.parse({
      handle: '@RugRadar',
      displayName: '  Rug   Radar ',
      bio: 'Safety tools.',
      socials: { telegram: 't.me/rugradar', website: '' },
      contact: {
        enabled: true,
        channels: [{ kind: 'email', value: 'A@b.co', audience: 'buyers' }],
      },
    });
    expect(normalizeProfile(input)).toEqual({
      ok: true,
      fields: {
        handle: 'rugradar',
        displayName: 'Rug Radar',
        bio: 'Safety tools.',
        socials: { telegram: 'rugradar' },
        contact: {
          enabled: true,
          channels: [{ kind: 'email', value: 'a@b.co', audience: 'buyers' }],
        },
      },
    });
    expect(normalizeProfile({ displayName: '', bio: '' })).toEqual({
      ok: true,
      fields: { displayName: null, bio: null },
    });
  });
  it('collects errors per field', () => {
    const result = normalizeProfile({
      handle: 'a',
      displayName: 'TrenchMart Support',
      bio: 'x'.repeat(300),
      socials: { github: '--' },
      contact: {
        enabled: true,
        channels: [
          { kind: 'email', value: 'bad', audience: 'everyone' },
          { kind: 'email', value: 'a@b.co', audience: 'everyone' },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual([
        'bio',
        'contact.1',
        'contact.email',
        'displayName',
        'handle',
        'socials.github',
      ]);
    const linky = normalizeProfile({ bio: 'buy at https://x.com' });
    expect(linky.ok).toBe(false);
    expect(normalizeProfile({ displayName: 'x'.repeat(41) }).ok).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(profileBody.safeParse({ avatar: 'x' }).success).toBe(false);
  });
});

describe('profileStrength', () => {
  it('counts what is filled in', () => {
    const items = profileStrength({
      handle: 'a',
      displayName: 'A',
      avatar: { url: '/x' },
      bio: null,
      xHandle: 'a',
      xVerified: true,
      socials: { website: 'https://a.io' },
    });
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual([
      'handle',
      'name',
      'x',
      'socials',
    ]);
    expect(items.find((i) => i.key === 'x')!.label).toBe('X verified');
    expect(profileStrength({}).every((i) => !i.done)).toBe(true);
  });
});
