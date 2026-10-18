'use client';

import {
  contactUrl,
  initialsOf,
  socialLabel,
  socialUrl,
  type ContactChannel,
  type SocialKind,
  type Socials,
} from '@trenchmart/shared';
import type { ReactNode } from 'react';
import {
  CheckIcon,
  DiscordIcon,
  GitHubIcon,
  MailIcon,
  TelegramIcon,
  VerifiedIcon,
  WebIcon,
  XIcon,
} from './icons';

export type ProfileImage = { id: string; url: string } | null;

export const SOCIAL_KINDS: SocialKind[] = ['telegram', 'discord', 'website', 'github'];

export const SOCIAL_META: Record<
  SocialKind,
  { name: string; icon: (className?: string) => ReactNode; placeholder: string; note: string }
> = {
  telegram: {
    name: 'Telegram',
    icon: (c) => <TelegramIcon className={c} />,
    placeholder: 't.me/yourchannel',
    note: 'Channel or group',
  },
  discord: {
    name: 'Discord',
    icon: (c) => <DiscordIcon className={c} />,
    placeholder: 'discord.gg/invite',
    note: 'Server invite',
  },
  website: {
    name: 'Website',
    icon: (c) => <WebIcon className={c} />,
    placeholder: 'https://example.com',
    note: 'Docs or landing page',
  },
  github: {
    name: 'GitHub',
    icon: (c) => <GitHubIcon className={c} />,
    placeholder: 'github.com/you',
    note: 'Buyers like reading source',
  },
};

export const CONTACT_META: Record<
  ContactChannel['kind'],
  { name: string; icon: (className?: string) => ReactNode; placeholder: string }
> = {
  telegram: {
    name: 'Telegram DM',
    icon: (c) => <TelegramIcon className={c} />,
    placeholder: '@username',
  },
  email: { name: 'Email', icon: (c) => <MailIcon className={c} />, placeholder: 'you@example.com' },
  discord: {
    name: 'Discord DM',
    icon: (c) => <DiscordIcon className={c} />,
    placeholder: 'username',
  },
};

const AVATAR_BG =
  'radial-gradient(circle at 30% 25%,#ddff7a 0%,#c6f432 22%,#2e3a12 62%,#0e100e 100%)';

/** Uploaded avatar, or initials on the accent gradient. Never a stock picture. */
export function Avatar({
  image,
  name,
  fallback,
  className = 'h-24 w-24 text-3xl',
  ring = 'ring-4 ring-bg',
}: {
  image: ProfileImage | string | null | undefined;
  name: string | null | undefined;
  fallback: string;
  className?: string;
  ring?: string;
}) {
  const url = typeof image === 'string' ? image : image?.url;
  return (
    <span
      data-testid="avatar"
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-onaccent ${ring} ${className}`}
      style={url ? undefined : { background: AVATAR_BG }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{initialsOf(name, fallback)}</span>
      )}
    </span>
  );
}

/** Uploaded banner, or the site's hero grid. */
export function Banner({
  image,
  className = 'h-[168px]',
}: {
  image: ProfileImage;
  className?: string;
}) {
  return (
    <div
      data-testid="banner"
      className={`relative overflow-hidden border-b border-line-soft bg-inset ${className}`}
    >
      {image ? (
        <img src={image.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <>
          <div className="hero-grid" style={{ maskImage: 'none', opacity: 0.9 }} />
          <div className="hero-glow" style={{ top: -160, left: '4%' }} />
        </>
      )}
    </div>
  );
}

export function VerifiedBadge({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span title="X account verified through X sign-in" className="inline-flex">
      <VerifiedIcon className={className} />
      <span className="sr-only">X verified</span>
    </span>
  );
}

const CHIP = 'inline-flex h-9 items-center gap-2 rounded-ctl border px-3 text-[13px]';

/** X first (verified or labelled), then the self-declared links, opened with noopener. */
export function SocialChips({
  xHandle,
  xVerified,
  socials,
}: {
  xHandle: string | null;
  xVerified: boolean;
  socials: Socials;
}) {
  const links = SOCIAL_KINDS.filter((kind) => socials[kind]);
  if (!xHandle && !links.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="socials">
      {xHandle ? (
        <li>
          <a
            href={`https://x.com/${xHandle}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={`${CHIP} ${xVerified ? 'border-accent-line bg-accent-bg text-ink' : 'border-line bg-surface text-ink-2'}`}
          >
            <XIcon />
            <span>X @{xHandle}</span>
            {xVerified ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-tag bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold text-onaccent">
                <CheckIcon className="h-3 w-3" /> VERIFIED
              </span>
            ) : (
              <span data-testid="x-unverified" className="ml-1 text-warn">
                (unverified)
              </span>
            )}
          </a>
        </li>
      ) : null}
      {links.map((kind) => (
        <li key={kind}>
          <a
            href={socialUrl(kind, socials[kind]!)}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className={`${CHIP} border-line bg-surface text-ink-2 hover:text-ink`}
          >
            {SOCIAL_META[kind].icon()}
            <span>{socialLabel(kind, socials[kind]!)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ContactList({ channels }: { channels: ContactChannel[] }) {
  return (
    <ul className="m-0 space-y-2 p-0">
      {channels.map((channel) => {
        const url = contactUrl(channel);
        const meta = CONTACT_META[channel.kind];
        const value = channel.kind === 'telegram' ? `@${channel.value}` : channel.value;
        return (
          <li
            key={channel.kind}
            className="flex list-none items-center gap-3 rounded-ctl border border-line bg-inset px-3 py-2.5"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-surface-2 text-ink-2">
              {meta.icon()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-muted">
                {meta.name}
                {channel.audience === 'buyers' ? ' · buyers only' : ''}
              </span>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="block truncate font-mono text-[13px] text-ink hover:text-accent"
                >
                  {value}
                </a>
              ) : (
                <span className="block truncate font-mono text-[13px] text-ink">{value}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export { ago, monthYear, shortWallet } from '@/lib/profile-format';
