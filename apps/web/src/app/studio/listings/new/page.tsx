'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, solToLamports } from '@trenchmart/shared';
import { Button, Label, Money, Panel, Square } from '@/components/ui';
import { api } from '@/lib/api';
import { useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

const INPUT =
  'mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm placeholder:text-faint';

function lamportsOf(value: string): bigint | null {
  try {
    return value.trim() ? solToLamports(value.trim()) : null;
  } catch {
    return null;
  }
}

export default function NewListingPage() {
  const wallet = useWallet();
  const router = useRouter();
  const centsPerSol = useSolUsd();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [price, setPrice] = useState('');
  const [fileName, setFileName] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const data = new FormData(event.currentTarget);
    const lamports = solToLamports(String(data.get('price') ?? '0')).toString();
    setBusy('Creating listing…');
    const created = await api<{ id: string }>('/studio/listings', {
      method: 'POST',
      body: JSON.stringify({
        title: String(data.get('title') ?? ''),
        summary: String(data.get('summary') ?? ''),
        description: String(data.get('description') ?? ''),
        category: String(data.get('category') ?? 'userscript'),
        priceLamports: lamports,
        terminals: String(data.get('terminals') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      router.push('/studio');
      return;
    }
    setBusy('Uploading file…');
    const version = await api<{ versionId: string; uploadUrl: string }>(
      `/studio/listings/${created.id}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          semver: '1.0.0',
          changelog: 'initial',
          fileName: file.name,
          fileSize: file.size,
        }),
      },
    );
    const target = new URL(version.uploadUrl, window.location.origin);
    const put = await fetch(`${target.pathname}${target.search}`, {
      method: 'PUT',
      body: file,
      credentials: 'include',
    });
    if (!put.ok) throw new Error('upload failed');
    router.push(`/studio/listings/${created.id}/versions/${version.versionId}`);
  }

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">New listing</h1>
        <p className="mt-3 text-ink-2">Connect a wallet first.</p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }

  const lamports = lamportsOf(price);

  return (
    <form
      data-testid="studio"
      className="grid items-start gap-8 lg:grid-cols-[1fr_360px]"
      onSubmit={(event) =>
        void submit(event).catch((err: Error) => {
          setBusy('');
          setMessage(err.message);
        })
      }
    >
      <div className="space-y-6">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[32px] font-semibold tracking-[-0.03em]">New listing</h1>
          <p className="m-0 mt-1 text-ink-2">
            Describe it, set a price, drop the file. AI verification starts the moment it uploads.
          </p>
        </div>

        <div className="space-y-4 rounded-panel border border-line bg-surface p-5">
          <Field label="Title" htmlFor="title">
            <input
              id="title"
              name="title"
              required
              minLength={3}
              maxLength={120}
              placeholder="Bundle Detector Overlay"
              className={INPUT}
            />
          </Field>
          <Field label="Summary" htmlFor="summary" hint="One line buyers see on the card.">
            <input
              id="summary"
              name="summary"
              required
              minLength={3}
              maxLength={280}
              placeholder="Flags bundled launches on Axiom"
              className={INPUT}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="description"
            hint="AI verification checks the file against this, so say exactly what it does."
          >
            <textarea id="description" name="description" required rows={5} className={INPUT} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="category">
              <select id="category" name="category" className={INPUT}>
                {CATEGORIES.map((cat) => (
                  <option key={cat.code} value={cat.code}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Terminals" htmlFor="terminals" hint="Comma separated.">
              <input id="terminals" name="terminals" placeholder="Axiom, GMGN" className={INPUT} />
            </Field>
          </div>
          <Field label="Price (SOL)" htmlFor="price">
            <input
              id="price"
              name="price"
              required
              inputMode="decimal"
              placeholder="1.20"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className={`${INPUT} font-mono`}
            />
          </Field>
        </div>

        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-10 text-center hover:border-accent-line"
        >
          <span className="text-base font-semibold">
            {fileName || 'Drop your file here, or browse'}
          </span>
          <span className="text-[13px] text-muted">
            .user.js, .json, .csv or .zip · up to 5 MB (25 MB for setups)
          </span>
          <input
            id="file"
            name="file"
            type="file"
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!!busy} aria-busy={!!busy || undefined}>
            {busy || 'Create and start review'}
          </Button>
          {message ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {message}
            </p>
          ) : null}
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="rounded-panel border border-line bg-surface p-5">
          <Label>You receive per sale</Label>
          <div className="mt-1 text-xl font-semibold">
            {lamports !== null ? (
              <Money lamports={lamports} centsPerSol={centsPerSol} strong />
            ) : (
              '—'
            )}
          </div>
          <p className="m-0 mt-2 text-[13px] text-ink-2">
            100% of your price. 0% creator commission. Buyers pay a 5% fee on top, cut by their
            $TRENCH tier.
          </p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <Label>What happens next</Label>
          <ol className="m-0 mt-3 space-y-3 p-0 text-sm">
            {[
              ['Static checks', 'eval, remote code, key access, hosts'],
              ['Sandbox run', 'isolated, network and wallet calls logged'],
              ['AI verdict', 'behaviour vs your description'],
            ].map(([title, detail], index) => (
              <li key={title} className="flex list-none gap-3">
                <Square>{index + 1}</Square>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="block text-[13px] text-muted">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-4 text-[13px] text-ink-2">You watch each step live. No queue.</p>
        </div>
        <Panel tone="info" className="p-4 text-[13px] text-ink-2">
          Your listing goes live the moment it passes. Buyers see the checks and the file hash.
        </Panel>
      </aside>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
