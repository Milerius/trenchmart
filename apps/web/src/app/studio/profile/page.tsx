'use client';

import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  profileStrength,
  type ContactAudience,
  type ContactChannel,
  type SocialKind,
  type Socials,
} from '@trenchmart/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, EyeIcon, UploadIcon, XIcon } from '@/components/icons';
import {
  Avatar,
  Banner,
  CONTACT_META,
  SOCIAL_KINDS,
  SOCIAL_META,
  type ProfileImage,
} from '@/components/profile';
import { Button, ButtonLink, ErrorState, Label, Skeleton, Square, Tag } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { xResultMessage, type XResult } from '@/lib/x-result';

type OwnProfile = {
  handle: string | null;
  wallet: string;
  displayName: string | null;
  bio: string | null;
  avatar: ProfileImage;
  banner: ProfileImage;
  socials: Socials;
  contact: { enabled: boolean; channels: ContactChannel[] };
  xHandle: string | null;
  xVerified: boolean;
  /** What this deployment can do. xOAuth: "Verify with X" works (X app configured). */
  capabilities?: { xOAuth?: boolean };
};

type ContactRow = {
  kind: ContactChannel['kind'];
  value: string;
  audience: ContactAudience;
  on: boolean;
};
type Form = {
  handle: string;
  displayName: string;
  bio: string;
  socials: Record<SocialKind, string>;
  contactEnabled: boolean;
  contact: ContactRow[];
};

const CONTACT_KINDS: ContactChannel['kind'][] = ['telegram', 'email', 'discord'];
const INPUT =
  'mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-accent-line focus:outline-none';

function formOf(p: OwnProfile): Form {
  const socials = Object.fromEntries(
    SOCIAL_KINDS.map((kind) => [kind, p.socials[kind] ?? '']),
  ) as Record<SocialKind, string>;
  return {
    handle: p.handle ?? '',
    displayName: p.displayName ?? '',
    bio: p.bio ?? '',
    socials,
    contactEnabled: p.contact.enabled,
    contact: CONTACT_KINDS.map((kind) => {
      const saved = p.contact.channels.find((c) => c.kind === kind);
      return {
        kind,
        value: saved?.value ?? '',
        audience: saved?.audience ?? (kind === 'email' ? 'buyers' : 'everyone'),
        on: Boolean(saved),
      };
    }),
  };
}

function bodyOf(form: Form, saved: OwnProfile) {
  return {
    ...(form.handle.trim() && form.handle.trim() !== (saved.handle ?? '')
      ? { handle: form.handle }
      : {}),
    displayName: form.displayName,
    bio: form.bio,
    socials: form.socials,
    contact: {
      enabled: form.contactEnabled,
      channels: form.contact
        .filter((row) => row.on && row.value.trim())
        .map(({ kind, value, audience }) => ({ kind, value, audience })),
    },
  };
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ${on ? 'bg-accent' : 'border border-line-control bg-surface-2'}`}
    >
      <span
        className={`absolute h-[18px] w-[18px] rounded-full ${on ? 'right-[3px] bg-onaccent' : 'left-[3px] bg-muted'}`}
      />
    </button>
  );
}

function Section({
  id,
  title,
  sub,
  right,
  children,
}: {
  id: string;
  title: string;
  sub: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-panel border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-soft px-5 py-4 sm:px-6">
        <div>
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p>
        </div>
        {right}
      </div>
      <div className="space-y-5 p-5 sm:p-6">{children}</div>
    </section>
  );
}

function FieldError({ text, id }: { text?: string; id: string }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="m-0 mt-1 text-xs text-danger">
      {text}
    </p>
  );
}

export default function EditProfilePage() {
  const wallet = useWallet();
  const [saved, setSaved] = useState<OwnProfile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [devHandle, setDevHandle] = useState('');
  const [devLink, setDevLink] = useState(false);
  // Read once from GET /studio/profile; PUT responses do not carry it.
  const [xOAuth, setXOAuth] = useState<boolean | null>(null);
  const [xError, setXError] = useState('');
  // Outcome of the X sign-in redirect (?x=<result>&reason=<why>), shown on the X card.
  const [xResult, setXResult] = useState<XResult | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  async function load() {
    const profile = await api<OwnProfile>('/studio/profile');
    setXOAuth(profile.capabilities?.xOAuth === true);
    setSaved(profile);
    setForm(formOf(profile));
  }

  useEffect(() => {
    if (!wallet.session) return;
    setLoadError('');
    void load().catch((err: Error) => setLoadError(err.message));
  }, [wallet.session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = xResultMessage(params.get('x'), params.get('reason'));
    if (!result) return;
    setXResult(result);
    // Drop the query so a reload does not replay an old result.
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  // The X card sits below the fold: bring the result into view once the profile has loaded.
  const loaded = saved !== null;
  useEffect(() => {
    if (xResult && loaded)
      document.querySelector('[data-testid="x-card"]')?.scrollIntoView({ block: 'center' });
  }, [xResult, loaded]);

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Edit profile</h1>
        <p className="mt-3 text-ink-2">Connect a wallet to edit your creator profile.</p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }
  if (loadError) {
    return <ErrorState title="Could not load your profile." body={loadError} />;
  }
  if (!saved || !form) {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="sr-only">Loading profile…</p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setRow = (kind: ContactChannel['kind'], patch: Partial<ContactRow>) =>
    set({ contact: form.contact.map((row) => (row.kind === kind ? { ...row, ...patch } : row)) });
  const dirtyFields = (() => {
    const base = formOf(saved);
    const out: string[] = [];
    if (form.handle.trim() !== base.handle) out.push('handle');
    if (form.displayName !== base.displayName) out.push('name');
    if (form.bio !== base.bio) out.push('bio');
    if (SOCIAL_KINDS.some((k) => form.socials[k] !== base.socials[k])) out.push('socials');
    if (
      form.contactEnabled !== base.contactEnabled ||
      JSON.stringify(form.contact) !== JSON.stringify(base.contact)
    )
      out.push('contact');
    return out;
  })();
  const publicPath = `/u/${saved.handle ?? saved.wallet}`;
  const strength = profileStrength({ ...saved, socials: saved.socials });
  const done = strength.filter((s) => s.done).length;

  async function save() {
    setBusy('save');
    setMessage('');
    setErrors({});
    try {
      const next = await api<OwnProfile>('/studio/profile', {
        method: 'PUT',
        body: JSON.stringify(bodyOf(form!, saved!)),
      });
      setSaved(next);
      setForm(formOf(next));
      setMessage('Profile saved.');
      await wallet.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.data.fields) {
        setErrors(err.data.fields as Record<string, string>);
        setMessage('Some fields need fixing.');
      } else setMessage((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function upload(kind: 'avatar' | 'banner', file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    setMessage('');
    try {
      const image = await api<{ id: string; url: string }>(`/studio/profile/${kind}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      setSaved({ ...saved!, [kind]: image });
      setMessage(kind === 'avatar' ? 'Avatar updated.' : 'Banner updated.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function removeImage(kind: 'avatar' | 'banner') {
    setBusy(kind);
    try {
      await api(`/studio/profile/${kind}`, { method: 'DELETE' });
      setSaved({ ...saved!, [kind]: null });
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function connectX() {
    setXError('');
    setXResult(null);
    setBusy('x-start');
    try {
      const started = await api<{ url: string }>('/auth/x/start');
      if (!/^https:\/\/(x|twitter)\.com\//.test(started.url))
        throw new Error('X sign-in could not start. Try again.');
      // Full-page redirect to X's authorize page (OAuth 2.0 + PKCE). Busy stays set.
      window.location.assign(started.url);
    } catch (err) {
      setBusy('');
      if (err instanceof ApiError && err.code === 'X_UNCONFIGURED') {
        // The deployment lost its X app since the page loaded: switch to the unavailable state.
        setXOAuth(false);
        setXError('X verification is not available on this deployment yet.');
      } else setXError((err as Error).message || 'X sign-in could not start. Try again.');
    }
  }

  async function linkDevHandle() {
    setXError('');
    setBusy('x');
    try {
      await api('/studio/x', { method: 'POST', body: JSON.stringify({ handle: devHandle }) });
      setDevLink(false);
      setMessage('X handle linked for devnet (unverified: X verification is coming soon).');
      await load();
    } catch (err) {
      setXError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  const previewName = form.displayName.trim() || (form.handle ? `@${form.handle}` : 'Your name');

  return (
    <section data-testid="profile-edit" className="pb-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            Edit profile
          </h1>
          <p className="m-0 mt-1 text-ink-2">
            Your public page at{' '}
            <span className="font-mono text-ink">trenchmart.fun{publicPath}</span>. Buyers check it
            before they pay.
          </p>
        </div>
        <ButtonLink href={publicPath} variant="secondary">
          <EyeIcon /> View public profile
        </ButtonLink>
      </div>
      {message ? (
        <p
          role="status"
          className="m-0 mb-4 rounded-ctl border border-line bg-surface-2 px-4 py-3 text-sm"
        >
          {message}
        </p>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-[170px_1fr_320px]">
        <nav
          aria-label="Profile sections"
          className="hidden space-y-1 text-sm lg:sticky lg:top-6 lg:block"
        >
          {[
            ['profile', 'Profile'],
            ['socials', 'Socials & verification'],
            ['contact', 'Contact'],
          ].map(([id, name]) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded-lg px-3 py-2.5 text-muted hover:bg-surface-2 hover:text-ink"
            >
              {name}
            </a>
          ))}
        </nav>
        <div className="min-w-0 space-y-6">
          <Section
            id="profile"
            title="Profile"
            sub="How you appear on listings, reviews and your page."
          >
            <div className="flex flex-wrap items-center gap-5">
              <Avatar
                image={saved.avatar}
                name={form.displayName}
                fallback={form.handle || saved.wallet}
                className="h-20 w-20 text-2xl"
                ring="ring-1 ring-line"
              />
              <div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === 'avatar'}
                    onClick={() => avatarInput.current?.click()}
                  >
                    <UploadIcon className="h-3.5 w-3.5" />
                    {busy === 'avatar' ? 'Uploading…' : 'Upload avatar'}
                  </Button>
                  {saved.avatar ? (
                    <Button size="sm" variant="ghost" onClick={() => void removeImage('avatar')}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  data-testid="avatar-input"
                  onChange={(e) => void upload('avatar', e.target.files?.[0])}
                />
                <p className="m-0 mt-1.5 text-xs text-muted">
                  PNG, JPEG or WebP · square, at least 64×64 · up to 3 MB · metadata stripped
                </p>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-card border border-dashed border-line-control">
              <Banner image={saved.banner} className="h-[92px]" />
              <div className="absolute inset-0 flex items-center justify-between gap-3 px-5">
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    Banner
                    {saved.banner ? null : (
                      <span className="font-mono text-[10px] text-warn">● USING DEFAULT</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted">1500×400 recommended</span>
                </span>
                <span className="flex gap-2">
                  {saved.banner ? (
                    <Button size="sm" variant="ghost" onClick={() => void removeImage('banner')}>
                      Remove
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === 'banner'}
                    onClick={() => bannerInput.current?.click()}
                  >
                    {busy === 'banner'
                      ? 'Uploading…'
                      : saved.banner
                        ? 'Replace banner'
                        : 'Upload banner'}
                  </Button>
                </span>
              </div>
              <input
                ref={bannerInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                data-testid="banner-input"
                onChange={(e) => void upload('banner', e.target.files?.[0])}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Display name</span>
                <input
                  className={INPUT}
                  value={form.displayName}
                  maxLength={DISPLAY_NAME_MAX}
                  aria-describedby="err-name"
                  onChange={(e) => set({ displayName: e.target.value })}
                />
                <FieldError id="err-name" text={errors.displayName} />
                <span className="mt-1 block text-xs text-muted">
                  Shown everywhere. Up to {DISPLAY_NAME_MAX} characters.
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Handle</span>
                <span className="mt-1.5 flex items-stretch overflow-hidden rounded-ctl border border-line-control bg-inset focus-within:border-accent-line">
                  <span className="flex items-center border-r border-line px-3 font-mono text-[13px] text-muted">
                    /u/
                  </span>
                  <input
                    className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm focus:outline-none"
                    value={form.handle}
                    placeholder="yourname"
                    aria-describedby="err-handle"
                    onChange={(e) => set({ handle: e.target.value.toLowerCase() })}
                  />
                </span>
                <FieldError id="err-handle" text={errors.handle} />
                <span className="mt-1 block text-xs text-muted">
                  3 to 20 characters: a–z, 0–9 and _.
                </span>
              </label>
            </div>
            <label className="block">
              <span className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Bio</span>
                <span
                  className={`font-mono text-xs ${form.bio.length > BIO_MAX ? 'text-danger' : 'text-muted'}`}
                >
                  {form.bio.length} / {BIO_MAX}
                </span>
              </span>
              <textarea
                className={`${INPUT} min-h-[96px] leading-relaxed`}
                value={form.bio}
                aria-describedby="err-bio"
                onChange={(e) => set({ bio: e.target.value })}
              />
              <FieldError id="err-bio" text={errors.bio} />
              <span className="mt-1 block text-xs text-muted">
                Plain text. Say what you build and how you ship updates. Links go in Socials.
              </span>
            </label>
          </Section>

          <Section
            id="socials"
            title="Socials & verification"
            sub={
              xOAuth === false
                ? 'X verification is coming soon. Other links are shown as you typed them.'
                : 'X is verified by signing in with X. Other links are shown as you typed them.'
            }
          >
            <div
              data-testid="x-card"
              className={`flex flex-wrap items-center gap-4 rounded-card border p-4 ${saved.xVerified ? 'border-accent-line bg-accent-bg' : 'border-line bg-inset'}`}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ctl bg-ink text-bg">
                <XIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {saved.xHandle ? `@${saved.xHandle}` : 'X not linked'}
                  </span>
                  {saved.xHandle ? (
                    saved.xVerified ? (
                      <Tag tone="ok">
                        <CheckIcon className="h-3 w-3" /> VERIFIED VIA X
                      </Tag>
                    ) : (
                      <Tag tone="warn">NOT VERIFIED</Tag>
                    )
                  ) : null}
                  {xOAuth === false ? (
                    <Tag data-testid="x-soon">VERIFICATION COMING SOON</Tag>
                  ) : null}
                </div>
                <p className="m-0 mt-0.5 text-[13px] text-ink-2">
                  {xOAuth === false
                    ? saved.xHandle
                      ? 'Sign-in with X is not available yet, so buyers see this handle as unverified.'
                      : 'Sign-in with X is not available yet. On devnet you can link a handle now; buyers see it as unverified.'
                    : saved.xVerified
                      ? 'Read-only sign-in. We never post for you.'
                      : saved.xHandle
                        ? 'Linked without X sign-in, so buyers see it as unverified.'
                        : 'Required to publish listings. Read-only sign-in, we never post for you.'}
                </p>
              </div>
              {xOAuth === false ? (
                <div className="flex flex-wrap gap-2">
                  {!devLink ? (
                    <Button size="sm" variant="secondary" onClick={() => setDevLink(true)}>
                      {saved.xHandle ? 'Change handle' : 'Link handle (unverified)'}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled
                    aria-disabled="true"
                    title="X verification is coming soon"
                  >
                    X verification coming soon
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant={saved.xVerified ? 'ghost' : 'primary'}
                  disabled={xOAuth === null || busy === 'x-start'}
                  onClick={() => void connectX()}
                >
                  {busy === 'x-start'
                    ? 'Opening X…'
                    : saved.xVerified
                      ? 'Reconnect'
                      : saved.xHandle
                        ? 'Verify with X'
                        : 'Connect X'}
                </Button>
              )}
              {xResult ? (
                <div
                  role="status"
                  data-testid="x-result"
                  data-ok={xResult.ok ? 'true' : 'false'}
                  className={`m-0 w-full rounded-ctl border px-3 py-2 text-[13px] ${xResult.ok ? 'border-accent-line bg-surface-2 text-ink' : 'border-danger-line bg-danger-bg text-danger'}`}
                >
                  <p className="m-0 font-semibold">{xResult.title}</p>
                  {xResult.detail ? <p className="m-0 mt-0.5">{xResult.detail}</p> : null}
                </div>
              ) : null}
              {xError ? (
                <p
                  role="alert"
                  data-testid="x-error"
                  className="m-0 w-full text-[13px] text-danger"
                >
                  {xError}
                </p>
              ) : null}
            </div>
            {devLink && xOAuth === false ? (
              <div className="flex flex-wrap items-end gap-3 rounded-card border border-warn-line bg-warn-bg p-4">
                <label className="block min-w-[200px] flex-1">
                  <span className="text-sm font-medium">X handle (unverified, devnet)</span>
                  <input
                    className={INPUT}
                    value={devHandle}
                    placeholder="yourhandle"
                    onChange={(e) => setDevHandle(e.target.value)}
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={!devHandle || busy === 'x'}
                  onClick={() => void linkDevHandle()}
                >
                  Link X
                </Button>
              </div>
            ) : null}
            <div className="space-y-4">
              {SOCIAL_KINDS.map((kind) => (
                <label key={kind} className="flex items-start gap-3">
                  <span className="mt-6 grid h-11 w-11 shrink-0 place-items-center rounded-ctl border border-line bg-surface-2 text-ink-2">
                    {SOCIAL_META[kind].icon()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                      {SOCIAL_META[kind].name}
                      <span className="font-normal text-muted">{SOCIAL_META[kind].note}</span>
                    </span>
                    <input
                      className={INPUT}
                      value={form.socials[kind]}
                      placeholder={SOCIAL_META[kind].placeholder}
                      aria-describedby={`err-${kind}`}
                      onChange={(e) =>
                        set({ socials: { ...form.socials, [kind]: e.target.value } })
                      }
                    />
                    <FieldError id={`err-${kind}`} text={errors[`socials.${kind}`]} />
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section
            id="contact"
            title="Contact"
            sub="Optional. Off by default. Buyers only see the channels you switch on."
            right={
              <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] text-ink-2">
                Let buyers contact me
                <Toggle
                  on={form.contactEnabled}
                  label="Let buyers contact me"
                  onChange={(on) => set({ contactEnabled: on })}
                />
              </span>
            }
          >
            <div className={`space-y-3 ${form.contactEnabled ? '' : 'opacity-60'}`}>
              {form.contact.map((row) => (
                <div
                  key={row.kind}
                  className={`flex flex-wrap items-center gap-3 rounded-card border bg-inset px-4 py-3 ${row.on ? 'border-line' : 'border-line-soft'}`}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-surface-2 text-ink-2">
                    {CONTACT_META[row.kind].icon()}
                  </span>
                  <label className="min-w-[160px] flex-1">
                    <span className="block text-[13px] text-muted">
                      {CONTACT_META[row.kind].name}
                    </span>
                    <input
                      className="w-full bg-transparent font-mono text-sm text-ink placeholder:text-faint focus:outline-none"
                      value={row.value}
                      placeholder={CONTACT_META[row.kind].placeholder}
                      aria-label={`${CONTACT_META[row.kind].name} value`}
                      onChange={(e) =>
                        setRow(row.kind, {
                          value: e.target.value,
                          on: row.on || Boolean(e.target.value),
                        })
                      }
                    />
                    <FieldError
                      id={`err-contact-${row.kind}`}
                      text={errors[`contact.${row.kind}`]}
                    />
                  </label>
                  <select
                    aria-label={`${CONTACT_META[row.kind].name} audience`}
                    className="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-2"
                    value={row.audience}
                    onChange={(e) =>
                      setRow(row.kind, { audience: e.target.value as ContactAudience })
                    }
                  >
                    <option value="everyone">Everyone</option>
                    <option value="buyers">Buyers only</option>
                  </select>
                  <span
                    className={`flex items-center gap-2 text-[12px] ${row.on ? 'text-accent' : 'text-muted'}`}
                  >
                    {row.on ? 'Shown' : 'Hidden'}
                    <Toggle
                      on={row.on}
                      label={`Show ${CONTACT_META[row.kind].name}`}
                      onChange={(on) => setRow(row.kind, { on })}
                    />
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 rounded-card border border-info-line bg-info-bg p-4 text-[13px] text-ink-2">
              <Square tone="info">i</Square>
              <span>
                <span className="font-medium text-ink">Buyers only</span> means it shows after
                someone buys one of your listings. Disputes always go through escrow, never DMs, and
                your profile shows a scam warning next to contact details.
              </span>
            </div>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Label>Live preview</Label>
          <div
            className="overflow-hidden rounded-panel border border-line bg-surface"
            data-testid="profile-preview"
          >
            <Banner image={saved.banner} className="h-[72px]" />
            <div className="px-5 pb-5">
              <div className="-mt-9">
                <Avatar
                  image={saved.avatar}
                  name={form.displayName}
                  fallback={form.handle || saved.wallet}
                  className="h-[68px] w-[68px] text-xl"
                  ring="ring-4 ring-surface"
                />
              </div>
              <div className="mt-2 text-lg font-semibold">{previewName}</div>
              {form.handle ? (
                <div className="font-mono text-[12px] text-muted">@{form.handle}</div>
              ) : null}
              {form.bio ? (
                <p className="m-0 mt-2 line-clamp-3 text-[13px] text-ink-2">{form.bio}</p>
              ) : null}
            </div>
          </div>
          <div
            className="rounded-panel border border-line bg-surface p-5"
            data-testid="profile-strength"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Profile strength</span>
              <span className="font-mono text-[13px] text-accent">
                {done} / {strength.length}
              </span>
            </div>
            <div className="mt-2 flex gap-1">
              {strength.map((item) => (
                <span
                  key={item.key}
                  className={`h-1.5 flex-1 rounded-full ${item.done ? 'bg-accent' : 'bg-line-strong'}`}
                />
              ))}
            </div>
            <ul className="m-0 mt-4 space-y-2 p-0 text-[13px]">
              {strength.map((item) => (
                <li
                  key={item.key}
                  className={`flex list-none items-center gap-2.5 ${item.done ? 'text-ink-2' : 'text-ink'}`}
                >
                  <Square tone={item.done ? 'ok' : 'neutral'}>{item.done ? '✓' : ''}</Square>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-3 text-[12px] text-muted">
              Complete profiles convert better. Only a linked X account is required to publish.
            </p>
          </div>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-surface-2/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-ink-2" data-testid="dirty">
            <span
              className={`h-2 w-2 rounded-full ${dirtyFields.length ? 'bg-warn' : 'bg-accent'}`}
            />
            {dirtyFields.length
              ? `${dirtyFields.length} unsaved change${dirtyFields.length === 1 ? '' : 's'} · ${dirtyFields.join(', ')}`
              : 'All changes saved'}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!dirtyFields.length}
              onClick={() => setForm(formOf(saved))}
            >
              Discard
            </Button>
            <Button disabled={!dirtyFields.length || busy === 'save'} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
