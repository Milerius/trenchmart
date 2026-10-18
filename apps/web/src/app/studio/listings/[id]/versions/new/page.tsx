'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Label, Money, Panel, Skeleton, Square, StatusTag, utc } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSolUsd } from '@/lib/config';
import { paySupplement, payVerificationFee, type UnsignedTx } from '@/lib/studio';
import { supplementReasonText } from '@/lib/updates';
import { useWallet } from '@/lib/wallet';

const INPUT =
  'mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm placeholder:text-faint';

type Quota = {
  listing: { id: string; slug: string; title: string; updatePrice: string };
  isUpdate: boolean;
  currentSemver: string | null;
  suggestedSemver: string;
  updatesToday: number;
  uploadsToday: number;
  limits: { updatesPerListingPerDay: number; uploadsPerCreatorPerDay: number };
  reasons: string[];
  supplementLamports: string;
  supplementRequired: boolean;
  resetsAt: string;
  verificationFee: string;
  feeWaived: boolean;
  versions: { id: string; semver: string; status: string; created_at: string }[];
};

type Created = {
  versionId: string;
  uploadUrl: string;
  feeTx: UnsignedTx | null;
  supplement: { id: string; lamports: string; tx: UnsignedTx | null } | null;
};

/** Upload a new version of a live listing. Same upload, fee, scan and review as the first. */
export default function NewVersionPage() {
  const params = useParams<{ id: string }>();
  const wallet = useWallet();
  const router = useRouter();
  const centsPerSol = useSolUsd();
  const [quota, setQuota] = useState<Quota | null>(null);
  const [semver, setSemver] = useState('');
  const [changelog, setChangelog] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const next = await api<Quota>(`/studio/listings/${params.id}/upload-quota`);
    setQuota(next);
    setSemver((value) => value || next.suggestedSemver);
  }

  useEffect(() => {
    if (wallet.session) void load().catch((err: Error) => setMessage(err.message));
  }, [wallet.session, params.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const file = new FormData(event.currentTarget).get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose the file to upload.');
    setBusy('Creating version…');
    let created: Created;
    try {
      created = await api<Created>(`/studio/listings/${params.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          semver: semver.trim(),
          changelog: changelog.trim(),
          fileName: file.name,
          fileSize: file.size,
          // The supplement shown above; the API refuses an amount the creator did not see.
          ...(quota?.supplementRequired
            ? { acceptSupplementLamports: quota.supplementLamports }
            : {}),
        }),
      });
    } catch (err) {
      // The limit changed since the page loaded (another tab, midnight UTC): show the new state.
      if (err instanceof ApiError && err.code === 'SUPPLEMENT_REQUIRED') await load();
      throw err;
    }
    if (created.feeTx) {
      setBusy('Paying verification fee…');
      await payVerificationFee({
        api,
        versionId: created.versionId,
        feeTx: created.feeTx,
        signAndSend: wallet.signAndSend,
      });
    }
    if (created.supplement?.tx) {
      setBusy('Paying upload supplement…');
      await paySupplement({
        api,
        supplementId: created.supplement.id,
        tx: created.supplement.tx,
        signAndSend: wallet.signAndSend,
      });
    }
    setBusy('Uploading file…');
    const target = new URL(created.uploadUrl, window.location.origin);
    const put = await fetch(`${target.pathname}${target.search}`, {
      method: 'PUT',
      body: file,
      credentials: 'include',
    });
    if (!put.ok) throw new Error('upload failed');
    router.push(`/studio/listings/${params.id}/versions/${created.versionId}`);
  }

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Upload new version</h1>
        <p className="mt-3 text-ink-2">Connect a wallet first.</p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }

  const feeText = !quota
    ? null
    : quota.verificationFee === '0'
      ? 'Free right now'
      : quota.feeWaived
        ? 'Waived for your tier'
        : null;

  return (
    <form
      data-testid="new-version"
      className="grid items-start gap-8 lg:grid-cols-[1fr_360px]"
      onSubmit={(event) =>
        void submit(event).catch((err: Error) => {
          setBusy('');
          setMessage(err.message);
        })
      }
    >
      <div className="min-w-0 space-y-6">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[32px] font-semibold tracking-[-0.03em]">
            {quota && !quota.isUpdate ? 'Upload file' : 'Upload new version'}
          </h1>
          <p className="m-0 mt-1 text-ink-2">
            {quota ? (
              <>
                {quota.listing.title}
                {quota.currentSemver ? (
                  <span className="font-mono text-muted"> · live v{quota.currentSemver}</span>
                ) : null}
                . The new file goes through the same automated review and replaces the live version
                once it passes.
              </>
            ) : (
              <Skeleton className="inline-block h-4 w-64" />
            )}
          </p>
        </div>

        <div className="space-y-4 rounded-panel border border-line bg-surface p-5">
          <div>
            <label htmlFor="semver" className="text-sm font-medium">
              Version
            </label>
            <input
              id="semver"
              name="semver"
              required
              pattern="\d+\.\d+\.\d+"
              value={semver}
              onChange={(event) => setSemver(event.target.value)}
              className={`${INPUT} font-mono`}
            />
            <p className="m-0 mt-1 text-xs text-muted">
              Suggested patch bump{quota?.currentSemver ? ` from v${quota.currentSemver}` : ''}.
              Edit it for a minor or major release; it must be higher than the live version.
            </p>
          </div>
          <div>
            <label htmlFor="changelog" className="text-sm font-medium">
              Changelog
            </label>
            <textarea
              id="changelog"
              name="changelog"
              required
              minLength={3}
              maxLength={10_000}
              rows={4}
              value={changelog}
              onChange={(event) => setChangelog(event.target.value)}
              placeholder="What changed for buyers"
              className={INPUT}
            />
            <p className="m-0 mt-1 text-xs text-muted">
              Buyers see this on their Purchases page next to the update.
            </p>
          </div>
        </div>

        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-10 text-center hover:border-accent-line"
        >
          <span className="text-base font-semibold">
            {fileName || 'Drop the new file here, or browse'}
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

        {quota?.supplementRequired ? (
          <Panel tone="warn" data-testid="supplement-notice" className="p-4 text-sm">
            <p className="m-0 font-semibold">
              Daily limit reached: this upload needs a{' '}
              <Money lamports={quota.supplementLamports} centsPerSol={centsPerSol} /> supplement
            </p>
            <p className="m-0 mt-1 text-ink-2">
              {supplementReasonText(quota.reasons, quota.limits.uploadsPerCreatorPerDay)} You pay it
              on chain with your wallet before the file uploads, or wait until {utc(quota.resetsAt)}
              .
            </p>
          </Panel>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            data-testid="submit-version"
            disabled={!!busy || !quota}
            aria-busy={!!busy || undefined}
          >
            {busy ||
              (quota?.supplementRequired ? 'Pay supplement and start review' : 'Start review')}
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
          <Label>Today (UTC)</Label>
          {quota ? (
            <ul data-testid="upload-limits" className="m-0 mt-3 space-y-3 p-0 text-sm">
              <li className="flex list-none gap-3">
                <Square
                  tone={quota.updatesToday < quota.limits.updatesPerListingPerDay ? 'ok' : 'warn'}
                >
                  {quota.updatesToday}
                </Square>
                <span>
                  <span className="block font-medium">
                    {quota.updatesToday} of {quota.limits.updatesPerListingPerDay} free update
                    {quota.limits.updatesPerListingPerDay === 1 ? '' : 's'} on this listing
                  </span>
                </span>
              </li>
              <li className="flex list-none gap-3">
                <Square
                  tone={quota.uploadsToday < quota.limits.uploadsPerCreatorPerDay ? 'ok' : 'warn'}
                >
                  {quota.uploadsToday}
                </Square>
                <span className="block font-medium">
                  {quota.uploadsToday} of {quota.limits.uploadsPerCreatorPerDay} free uploads across
                  your listings
                </span>
              </li>
            </ul>
          ) : (
            <Skeleton className="mt-3 h-10 w-full" />
          )}
          <p className="m-0 mt-4 text-[13px] text-ink-2">
            Beyond that, each upload costs a{' '}
            {quota ? (
              <Money lamports={quota.supplementLamports} centsPerSol={centsPerSol} />
            ) : (
              'small'
            )}{' '}
            supplement. Limits reset at midnight UTC.
          </p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <Label>Verification fee</Label>
          <p className="m-0 mt-2 text-sm text-ink-2">
            {feeText ??
              (quota ? (
                <>
                  <Money lamports={quota.verificationFee} centsPerSol={centsPerSol} /> per version
                </>
              ) : (
                '—'
              ))}
          </p>
        </div>
        {quota && quota.versions.length ? (
          <div className="rounded-panel border border-line bg-surface p-5">
            <Label>Versions</Label>
            <ul className="m-0 mt-3 space-y-2 p-0 text-sm">
              {quota.versions.slice(0, 6).map((version) => (
                <li key={version.id} className="flex list-none items-center justify-between gap-2">
                  <span className="font-mono">v{version.semver}</span>
                  <StatusTag status={version.status} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </form>
  );
}
