'use client';

import bs58 from 'bs58';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import nacl from 'tweetnacl';
import { reportMessage } from '@trenchmart/shared';
import { Label, Panel, utc } from '@/components/ui';
import { api } from '@/lib/api';
import { explorerAddress, explorerTx, shortKey } from '@/lib/protocol-facts';

export default function VerifyPage() {
  const [result, setResult] = useState<{ match: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError('');
    setResult(null);
    setBusy(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      setResult(
        await api<{ match: boolean; message: string }>('/verify', {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, contentBase64: btoa(binary) }),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-14">
      <section className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">Verify a file</h1>
          <p className="m-0 mt-2 text-ink-2">
            Drop a file you downloaded. A match means the bytes are exactly a version that passed
            automated review. Nothing is stored.
          </p>
        </div>
        <label
          htmlFor="verify-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-12 text-center hover:border-accent-line"
        >
          <span className="text-base font-semibold">
            {busy ? 'Checking…' : 'Choose a file to check'}
          </span>
          <span className="text-[13px] text-muted">
            We compare its SHA-256 with every reviewed version.
          </span>
          <input
            id="verify-file"
            type="file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file).catch((err: Error) => setError(err.message));
            }}
          />
        </label>
        {result ? (
          <Panel tone={result.match ? 'ok' : 'warn'} role="status" className="p-4 text-sm">
            <p className="m-0 font-semibold">{result.match ? '✓ Match' : 'No match'}</p>
            <p className="m-0 mt-1 text-ink-2">{result.message}</p>
          </Panel>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>
      <ProofSection />
      <ReportVerifier />
    </div>
  );
}

type Facts = {
  cluster: string;
  checkedAt: string;
  program: {
    address: string | null;
    exists: boolean;
    programData?: string;
    lastDeploySlot?: string;
    upgradeAuthority?: string | null;
    deployedBytes?: number;
    sha256?: string;
    securityTxt?: Record<string, string> | null;
    verifiedBuild?: { status: string; detail: string };
  };
  idl: { account: string; exists: boolean; instructions?: string[] | null };
  multisig: { address: string | null; threshold: number | null; members: string[] };
  accounts: {
    role: string;
    address: string | null;
    exists: boolean;
    owner: string | null;
    lamports: string | null;
  }[];
  review: { engine: string; model: string | null; sandboxEngine: string; note: string };
  reportSigningKey: string | null;
  recentEscrows: {
    escrow: string;
    txSig: string;
    releaseSig: string | null;
    refundSig: string | null;
    status: string;
    total: string;
    paidAt: string | null;
    escrowUntil: string | null;
    listing: { slug: string; title: string };
  }[];
};

function Addr({ value, tx }: { value: string | null | undefined; tx?: boolean }) {
  if (!value) return <span className="text-muted">not set</span>;
  return (
    <a
      href={tx ? explorerTx(value) : explorerAddress(value)}
      target="_blank"
      rel="noreferrer"
      title={value}
      className="font-mono text-ink-2 underline-offset-4 hover:underline"
    >
      {shortKey(value, 8, 6)} ↗
    </a>
  );
}

function useFacts() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Facts>('/transparency')
      .then(setFacts)
      .catch((err: Error) => setError(err.message));
  }, []);
  return { facts, error };
}

function ProofSection() {
  const { facts, error } = useFacts();
  const program = facts?.program;
  return (
    <section id="proof" data-testid="proof" className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">On-chain proof</h2>
        <p className="m-0 mt-2 text-ink-2">
          Read live from Solana {facts?.cluster ?? 'devnet'} by our API
          {facts ? ` at ${utc(facts.checkedAt)}` : ''}. Every address links to Solana Explorer, so
          you can check each line yourself.
        </p>
      </div>
      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
      {!facts && !error ? <p className="m-0 text-sm text-muted">Reading devnet…</p> : null}
      {facts ? (
        <>
          <Panel className="p-4">
            <Label>Escrow program (trench_escrow)</Label>
            <dl className="m-0 mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[180px_1fr]">
              <dt className="text-muted">Program id</dt>
              <dd className="m-0">
                <Addr value={program?.address} />
              </dd>
              <dt className="text-muted">Deployed</dt>
              <dd className="m-0 text-ink-2">
                {program?.exists
                  ? `yes · slot ${program.lastDeploySlot} · ${program.deployedBytes} bytes`
                  : 'not found'}
              </dd>
              <dt className="text-muted">Upgrade authority</dt>
              <dd className="m-0">
                <Addr value={program?.upgradeAuthority} />
              </dd>
              <dt className="text-muted">Program data</dt>
              <dd className="m-0">
                <Addr value={program?.programData} />
              </dd>
              <dt className="text-muted">Deployed sha256</dt>
              <dd className="m-0 break-all font-mono text-ink-2">{program?.sha256 ?? '—'}</dd>
              <dt className="text-muted">Verified build</dt>
              <dd className="m-0 text-ink-2">
                {program?.verifiedBuild?.status === 'not_verified' ? 'Not yet. ' : ''}
                {program?.verifiedBuild?.detail ?? '—'}
              </dd>
              <dt className="text-muted">security.txt</dt>
              <dd className="m-0 text-ink-2">
                {program?.securityTxt
                  ? Object.entries(program.securityTxt)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')
                  : 'not embedded'}
              </dd>
              <dt className="text-muted">IDL on chain</dt>
              <dd className="m-0 text-ink-2">
                {facts.idl.exists ? (
                  <>
                    <Addr value={facts.idl.account} />
                    {facts.idl.instructions ? ` · ${facts.idl.instructions.join(', ')}` : ''}
                  </>
                ) : (
                  'not published'
                )}
              </dd>
            </dl>
          </Panel>
          <Panel className="p-4">
            <Label>Treasury, fee buckets and token</Label>
            <p className="m-0 mt-2 text-[13px] text-ink-2" data-testid="multisig">
              Squads multisig <Addr value={facts.multisig.address} />:{' '}
              {facts.multisig.threshold
                ? `${facts.multisig.threshold} of ${facts.multisig.members.length} signers, read from the account.`
                : 'not readable right now.'}{' '}
              {facts.multisig.members.map((member) => (
                <span key={member} className="mr-2">
                  <Addr value={member} />
                </span>
              ))}
            </p>
            <ul className="m-0 mt-2 space-y-1 p-0 text-[13px]">
              {facts.accounts.map((account) => (
                <li key={account.role} className="flex list-none flex-wrap justify-between gap-2">
                  <span className="text-ink-2">{account.role}</span>
                  <span>
                    <Addr value={account.address} />{' '}
                    <span className="text-muted">
                      {account.address
                        ? account.exists
                          ? '· exists'
                          : '· not created on chain yet'
                        : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="p-4">
            <Label>Review engine</Label>
            <p className="m-0 mt-2 text-[13px] text-ink-2">
              {facts.review.engine}
              {facts.review.model ? ` · model ${facts.review.model}` : ''} · sandbox{' '}
              {facts.review.sandboxEngine}. {facts.review.note}
            </p>
            <p className="m-0 mt-1 text-[13px] text-ink-2">
              Scan reports are signed with Ed25519 key{' '}
              <span className="font-mono">{facts.reportSigningKey ?? 'not configured'}</span>.
            </p>
          </Panel>
          <Panel className="p-4" data-testid="recent-escrows">
            <Label>Recent escrows</Label>
            {facts.recentEscrows.length ? (
              <ul className="m-0 mt-2 space-y-1 p-0 text-[13px]">
                {facts.recentEscrows.map((row) => (
                  <li key={row.escrow} className="flex list-none flex-wrap justify-between gap-2">
                    <span className="text-ink-2">
                      <Link href={`/l/${row.listing.slug}`} className="hover:underline">
                        {row.listing.title}
                      </Link>{' '}
                      · {row.status}
                      {row.escrowUntil ? ` · releasable after ${utc(row.escrowUntil)}` : ''}
                    </span>
                    <span className="space-x-3">
                      <Addr value={row.escrow} />
                      <Addr value={row.txSig} tx />
                      {row.releaseSig ? <Addr value={row.releaseSig} tx /> : null}
                      {row.refundSig ? <Addr value={row.refundSig} tx /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-2 text-[13px] text-muted">No paid escrows yet.</p>
            )}
          </Panel>
        </>
      ) : null}
    </section>
  );
}

type Signed = { report: unknown; signature: { publicKey: string; value: string } | null };

function ReportVerifier() {
  const { facts } = useFacts();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function check(file: File) {
    try {
      const signed = JSON.parse(await file.text()) as Signed;
      if (!signed.signature) {
        setResult({ ok: false, text: 'This report has no signature.' });
        return;
      }
      const valid = nacl.sign.detached.verify(
        reportMessage(signed.report),
        bs58.decode(signed.signature.value),
        bs58.decode(signed.signature.publicKey),
      );
      const published = facts?.reportSigningKey === signed.signature.publicKey;
      setResult({
        ok: valid && published,
        text: !valid
          ? 'Signature does not match: the report was changed or not signed by this key.'
          : published
            ? 'Valid. Signed by the published TrenchMart report key, and unchanged.'
            : 'The signature is valid, but the key is not the one TrenchMart publishes.',
      });
    } catch {
      setResult({ ok: false, text: 'Not a TrenchMart report JSON file.' });
    }
  }

  return (
    <section id="report" data-testid="report-verifier" className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Check a scan report</h2>
        <p className="m-0 mt-2 text-ink-2">
          Every listing has a downloadable report on its Security tab. It lists the file hash, every
          static, sandbox and review step with timestamps, and an Ed25519 signature. This check runs
          in your browser.
        </p>
      </div>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-8 text-center hover:border-accent-line">
        <span className="text-base font-semibold">Choose a report .json</span>
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void check(file);
          }}
        />
      </label>
      {result ? (
        <Panel tone={result.ok ? 'ok' : 'warn'} role="status" className="p-4 text-sm">
          {result.text}
        </Panel>
      ) : null}
      <Panel className="p-4 text-[13px] text-ink-2">
        <Label>Verify it yourself</Label>
        <ol className="m-0 mt-2 list-decimal space-y-1 pl-5">
          <li>
            Signed bytes: UTF-8 of <code className="font-mono">trenchmart-scan-report:v1</code>, a
            newline, then <code className="font-mono">report</code> as JSON with keys sorted at
            every level and no spaces.
          </li>
          <li>
            Check <code className="font-mono">signature.value</code> (base58) against{' '}
            <code className="font-mono">signature.publicKey</code> (base58) with any Ed25519
            library, for example tweetnacl&apos;s{' '}
            <code className="font-mono">sign.detached.verify</code>.
          </li>
          <li>
            The public key must equal the one shown above, which our API also serves at{' '}
            <code className="font-mono">/api/v1/transparency</code>.
          </li>
          <li>
            Compare <code className="font-mono">report.version.sha256</code> with your download.
            Downloads carry a license watermark for your wallet, so use the file check at the top of
            this page, which removes the watermark before hashing.
          </li>
        </ol>
      </Panel>
    </section>
  );
}
