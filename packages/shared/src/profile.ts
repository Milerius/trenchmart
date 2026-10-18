import { z } from 'zod';

/**
 * Creator profiles: display name, bio, handle, socials and opt-in contact channels.
 * Every field is normalised here so the API, the edit form and the public page agree on
 * what is accepted and how it is shown. Socials other than X are shown as typed (never
 * "verified"); X is verified only through X sign-in.
 */

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const BIO_MAX = 280;
export const DISPLAY_NAME_MAX = 40;

/** Handles that would read as staff or collide with app routes. */
export const RESERVED_HANDLES = new Set([
  'admin',
  'api',
  'help',
  'mod',
  'moderator',
  'official',
  'root',
  'security',
  'staff',
  'studio',
  'support',
  'system',
  'team',
  'trench',
  'trenchmart',
]);

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Trims, collapses spaces and drops control and bidi-override characters. */
export function cleanText(value: string): string {
  return value
    .replace(CONTROL, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Bio keeps single line breaks (max two in a row), nothing else invisible. */
export function cleanBio(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Links go in Socials, where they are checked: a bio with a URL is refused. */
export function bioHasLink(value: string): boolean {
  return /(https?:\/\/|www\.|\bt\.me\/|discord\.gg\/|\b[a-z0-9-]+\.(com|io|xyz|gg|app|fun|net|org|me|co)\b)/i.test(
    value,
  );
}

export function handleProblem(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return '3 to 20 characters: lowercase letters, digits or _';
  if (RESERVED_HANDLES.has(handle) || handle.includes('trenchmart'))
    return 'That handle is reserved';
  return null;
}

export function displayNameProblem(name: string): string | null {
  if (!name) return null;
  if (name.length > DISPLAY_NAME_MAX) return `Up to ${DISPLAY_NAME_MAX} characters`;
  if (/trench\s*mart|\badmin\b|\bofficial\b|\bsupport\b/i.test(name))
    return 'That name could be mistaken for TrenchMart staff';
  return null;
}

/** Strips a pasted URL or @ down to the bare value, e.g. "https://t.me/x" → "x". */
function bare(value: string, prefixes: RegExp): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(prefixes, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
}

export type SocialKind = 'telegram' | 'discord' | 'website' | 'github';
export type Socials = Partial<Record<SocialKind, string>>;

const TELEGRAM = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const DISCORD_INVITE = /^[A-Za-z0-9-]{2,32}$/;
const GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** Returns the stored value for a social, or an error message. Empty input clears it. */
export function normalizeSocial(
  kind: SocialKind,
  raw: string,
): { value: string | null } | { error: string } {
  const input = raw.trim();
  if (!input) return { value: null };
  if (kind === 'telegram') {
    const v = bare(input, /^(t\.me|telegram\.me)\//i);
    return TELEGRAM.test(v) ? { value: v } : { error: 'A Telegram username or t.me link' };
  }
  if (kind === 'discord') {
    const v = bare(input, /^(discord\.gg|discord\.com\/invite)\//i);
    return DISCORD_INVITE.test(v) ? { value: v } : { error: 'A discord.gg invite code' };
  }
  if (kind === 'github') {
    const v = bare(input, /^github\.com\//i);
    return GITHUB.test(v) ? { value: v } : { error: 'A GitHub username' };
  }
  return websiteValue(input);
}

function websiteValue(input: string): { value: string } | { error: string } {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'A website address like https://example.com' };
  }
  if (url.protocol !== 'https:') return { error: 'Use an https:// address' };
  if (url.username || url.password) return { error: 'No credentials in the address' };
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || url.hostname.startsWith('xn--'))
    return { error: 'A website address like https://example.com' };
  if (url.href.length > 200) return { error: 'Up to 200 characters' };
  url.hash = '';
  return { value: url.href.replace(/\/$/, '') };
}

/** Public link for a stored social value. */
export function socialUrl(kind: SocialKind, value: string): string {
  if (kind === 'telegram') return `https://t.me/${value}`;
  if (kind === 'discord') return `https://discord.gg/${value}`;
  if (kind === 'github') return `https://github.com/${value}`;
  return value;
}

/** Short text shown on a chip: "t.me/name", "rugradar.xyz". */
export function socialLabel(kind: SocialKind, value: string): string {
  if (kind === 'website') return value.replace(/^https:\/\//, '');
  return socialUrl(kind, value).replace(/^https:\/\//, '');
}

export type ContactKind = 'telegram' | 'discord' | 'email';
export type ContactAudience = 'everyone' | 'buyers';
export type ContactChannel = { kind: ContactKind; value: string; audience: ContactAudience };
export type Contact = { enabled: boolean; channels: ContactChannel[] };

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const DISCORD_USER = /^[a-z0-9_.]{2,32}$/;

export function normalizeContact(
  kind: ContactKind,
  raw: string,
): { value: string } | { error: string } {
  const input = raw.trim();
  if (kind === 'email')
    return EMAIL.test(input) ? { value: input.toLowerCase() } : { error: 'An email address' };
  if (kind === 'discord') {
    const v = input.replace(/^@/, '').toLowerCase();
    return DISCORD_USER.test(v) ? { value: v } : { error: 'A Discord username' };
  }
  const v = bare(input, /^(t\.me|telegram\.me)\//i);
  return TELEGRAM.test(v) ? { value: v } : { error: 'A Telegram username' };
}

export function contactUrl(channel: Pick<ContactChannel, 'kind' | 'value'>): string | null {
  if (channel.kind === 'telegram') return `https://t.me/${channel.value}`;
  if (channel.kind === 'email') return `mailto:${channel.value}`;
  return null;
}

/** Channels a viewer may see: none when contact is off, buyers-only ones for buyers. */
export function visibleContact(contact: Contact | null | undefined, isBuyer: boolean) {
  if (!contact?.enabled) return [];
  return contact.channels.filter((c) => c.audience === 'everyone' || isBuyer);
}

export const profileBody = z
  .object({
    handle: z.string().max(40).optional(),
    displayName: z.string().max(200).optional(),
    bio: z.string().max(2000).optional(),
    socials: z
      .object({
        telegram: z.string().max(200).optional(),
        discord: z.string().max(200).optional(),
        website: z.string().max(400).optional(),
        github: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    contact: z
      .object({
        enabled: z.boolean(),
        channels: z
          .array(
            z
              .object({
                kind: z.enum(['telegram', 'discord', 'email']),
                value: z.string().max(200),
                audience: z.enum(['everyone', 'buyers']),
              })
              .strict(),
          )
          .max(3),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ProfileInput = z.infer<typeof profileBody>;

export type ProfileFields = {
  handle?: string;
  displayName?: string | null;
  bio?: string | null;
  socials?: Socials;
  contact?: Contact;
};

/** Validates and normalises an edit. Returns the clean fields or per-field errors. */
export function normalizeProfile(
  input: ProfileInput,
): { ok: true; fields: ProfileFields } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const fields: ProfileFields = {};
  if (input.handle !== undefined) {
    const handle = input.handle.trim().replace(/^@/, '').toLowerCase();
    const problem = handleProblem(handle);
    if (problem) errors.handle = problem;
    else fields.handle = handle;
  }
  if (input.displayName !== undefined) {
    const name = cleanText(input.displayName);
    const problem = displayNameProblem(name);
    if (problem) errors.displayName = problem;
    else fields.displayName = name || null;
  }
  if (input.bio !== undefined) {
    const bio = cleanBio(input.bio);
    if (bio.length > BIO_MAX) errors.bio = `Up to ${BIO_MAX} characters`;
    else if (bioHasLink(bio)) errors.bio = 'Links go in Socials, not the bio';
    else fields.bio = bio || null;
  }
  if (input.socials) {
    const socials: Socials = {};
    for (const kind of ['telegram', 'discord', 'website', 'github'] as const) {
      const raw = input.socials[kind];
      if (raw === undefined) continue;
      const result = normalizeSocial(kind, raw);
      if ('error' in result) errors[`socials.${kind}`] = result.error;
      else if (result.value) socials[kind] = result.value;
    }
    fields.socials = socials;
  }
  if (input.contact) {
    const seen = new Set<string>();
    const channels: ContactChannel[] = [];
    input.contact.channels.forEach((channel, index) => {
      if (seen.has(channel.kind)) {
        errors[`contact.${index}`] = 'One channel of each kind';
        return;
      }
      seen.add(channel.kind);
      const result = normalizeContact(channel.kind, channel.value);
      if ('error' in result) errors[`contact.${channel.kind}`] = result.error;
      else channels.push({ kind: channel.kind, value: result.value, audience: channel.audience });
    });
    fields.contact = { enabled: input.contact.enabled, channels };
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, fields };
}

export type ProfileStrengthItem = { key: string; label: string; done: boolean };

/** What makes a profile complete. Nothing here blocks selling except where noted. */
export function profileStrength(p: {
  displayName?: string | null;
  avatar?: unknown;
  bio?: string | null;
  xHandle?: string | null;
  xVerified?: boolean;
  socials?: Socials | null;
  handle?: string | null;
}): ProfileStrengthItem[] {
  const s = p.socials ?? {};
  return [
    { key: 'handle', label: 'Handle', done: Boolean(p.handle) },
    { key: 'name', label: 'Avatar and display name', done: Boolean(p.displayName && p.avatar) },
    { key: 'bio', label: 'Bio', done: Boolean(p.bio) },
    { key: 'x', label: p.xVerified ? 'X verified' : 'X linked', done: Boolean(p.xHandle) },
    {
      key: 'socials',
      label: 'Telegram, Discord or website',
      done: Boolean(s.telegram || s.discord || s.website),
    },
  ];
}

/** Two-letter fallback avatar text from a display name, handle or wallet. */
export function initialsOf(name: string | null | undefined, fallback: string): string {
  const source = cleanText(name ?? '') || fallback;
  const words = source.split(/[\s_-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
