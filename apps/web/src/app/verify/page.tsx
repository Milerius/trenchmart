'use client';

import bs58 from 'bs58';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import nacl from 'tweetnacl';
import { reportMessage } from '@trenchmart/shared';
import { Card, Label, Panel, StatusTag, Tag, type Tone, utc } from '@/components/ui';
import { solText } from '@/lib/money';
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
  review: {
    engine: string;
    model: string | null;
    reasoningEffort?: string | null;
    sandboxEngine: string;
    note: string;
  };
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

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={`${label} ${value}`}
      className="motion-press inline-flex h-7 items-center rounded-tag border border-line-control px-2 font-mono text-[11px] text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Short address, copy button and Explorer link. The full value is in the title and the copy. */
function Addr({ value, tx }: { value: string | null | undefined; tx?: boolean }) {
  if (!value) return <span className="text-[13px] text-muted">not set</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={tx ? explorerTx(value) : explorerAddress(value)}
        target="_blank"
        rel="noreferrer"
        title={value}
        className="font-mono text-[13px] text-ink underline-offset-4 hover:underline"
      >
        {shortKey(value, 6, 6)} <span aria-hidden="true">↗</span>
        <span className="sr-only"> (opens Solana Explorer)</span>
      </a>
      <CopyButton value={value} />
    </span>
  );
}

type Check = { tone: Tone; label: string };
const LIVE: Check = { tone: 'ok', label: 'LIVE' };
const VERIFIED: Check = { tone: 'ok', label: 'VERIFIED' };
const NOT_YET: Check = { tone: 'neutral', label: 'NOT YET' };

function Chip({ check }: { check: Check }) {
  const symbol = check.tone === 'ok' ? '✓' : check.tone === 'warn' ? '!' : '○';
  return (
    <Tag tone={check.tone} data-testid="proof-chip">
      <span aria-hidden="true">{symbol}</span> {check.label}
    </Tag>
  );
}

function Details({
  children,
  summary = 'Show details',
}: {
  children: ReactNode;
  summary?: string;
}) {
  return (
    <details className="group mt-3 rounded-ctl border border-line-soft bg-inset px-3 py-2">
      <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-ink">{summary}</summary>
      <div className="mt-2 space-y-2 text-[13px] text-ink-2">{children}</div>
    </details>
  );
}

/** One fact: what it is, what it proves, its status, and where to check it. */
function ProofItem({
  title,
  proves,
  check,
  address,
  addressLabel,
  children,
  details,
  testId,
}: {
  title: string;
  proves: string;
  check: Check;
  address?: string | null;
  addressLabel?: string;
  children?: ReactNode;
  details?: ReactNode;
  testId?: string;
}) {
  return (
    <li
      className="list-none border-t border-line-soft px-4 py-4 first:border-t-0 sm:px-5"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-semibold text-ink">{title}</h3>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">{proves}</p>
        </div>
        <Chip check={check} />
      </div>
      {address !== undefined || children ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {address !== undefined ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {addressLabel ? <Label>{addressLabel}</Label> : null}
              <Addr value={address} />
            </span>
          ) : null}
          {children}
        </div>
      ) : null}
      {details ? <Details>{details}</Details> : null}
    </li>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="break-all font-mono text-[12px] text-ink">{children}</code>;
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

const SECURITY_TXT_LABEL: Record<string, string> = {
  name: 'Name',
  project_url: 'Project',
  contacts: 'Contact',
  policy: 'Policy',
  preferred_languages: 'Languages',
  source_code: 'Source code',
  auditors: 'Auditors',
};

function SecurityTxtValue({ value }: { value: string }) {
  const url = value.replace(/^link:/, '');
  return /^https?:\/\//.test(url) ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="break-all text-ink underline-offset-4 hover:underline"
    >
      {url.replace(/^https?:\/\//, '')}
    </a>
  ) : (
    <span className="text-ink">{value}</span>
  );
}

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h3 className="m-0 text-lg font-semibold tracking-[-0.01em]">{title}</h3>
      {children ? <p className="m-0 mt-1 text-[13px] text-ink-2">{children}</p> : null}
    </div>
  );
}

function ProofSection() {
  const { facts, error } = useFacts();
  const program = facts?.program;
  const authorityIsMultisig =
    !!program?.upgradeAuthority &&
    (program.upgradeAuthority === facts?.multisig.address ||
      facts?.accounts.some(
        (account) => account.address === program.upgradeAuthority && /vault/i.test(account.role),
      ));
  const checks: { name: string; check: Check }[] = facts
    ? [
        { name: 'Escrow program', check: program?.exists ? LIVE : NOT_YET },
        { name: 'Program bytes', check: program?.sha256 ? LIVE : NOT_YET },
        {
          name: 'security.txt',
          check: program?.securityTxt ? VERIFIED : NOT_YET,
        },
        { name: 'IDL', check: facts.idl.exists ? VERIFIED : NOT_YET },
        { name: 'Treasury multisig', check: facts.multisig.threshold ? VERIFIED : NOT_YET },
        {
          name: 'Verified build',
          check: program?.verifiedBuild?.status === 'verified' ? VERIFIED : NOT_YET,
        },
      ]
    : [];
  const confirmed = checks.filter((item) => item.check.tone === 'ok').length;
  return (
    <section id="proof" data-testid="proof" className="mx-auto max-w-3xl">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">On-chain proof</h2>
        <p className="m-0 mt-2 text-ink-2">
          Read live from Solana {facts?.cluster ?? 'devnet'} by our API
          {facts ? ` at ${utc(facts.checkedAt)}` : ''}. Every address opens in Solana Explorer, so
          you can check each item yourself.
        </p>
      </div>
      {error ? <p className="m-0 mt-4 text-sm text-danger">{error}</p> : null}
      {!facts && !error ? <p className="m-0 mt-4 text-sm text-muted">Reading devnet…</p> : null}
      {facts ? (
        <>
          <Panel className="mt-5 p-4 sm:p-5" data-testid="proof-summary">
            <p className="m-0 text-[15px] font-semibold text-ink">
              {confirmed} of {checks.length} checks confirmed on-chain
            </p>
            <ul className="m-0 mt-3 flex flex-wrap gap-2 p-0">
              {checks.map((item) => (
                <li key={item.name} className="list-none">
                  <Tag tone={item.check.tone}>
                    <span aria-hidden="true">{item.check.tone === 'ok' ? '✓' : '○'}</span>{' '}
                    {item.name}
                  </Tag>
                </li>
              ))}
            </ul>
          </Panel>

          <SectionHead title="Escrow program">
            The program that holds buyer SOL until release. Program name: trench_escrow.
          </SectionHead>
          <Panel>
            <ul className="m-0 p-0">
              <ProofItem
                title="Escrow program is deployed"
                proves="Checkout locks your SOL in an escrow account owned by this program, not in a wallet."
                check={program?.exists ? LIVE : NOT_YET}
                address={program?.address ?? null}
                addressLabel="Program"
                details={
                  <p className="m-0">
                    Last deployed at slot <Mono>{program?.lastDeploySlot ?? '—'}</Mono>. Program
                    data account:{' '}
                    {program?.programData ? <Addr value={program.programData} /> : 'not set'}
                  </p>
                }
              />
              <ProofItem
                title="Who can upgrade it"
                proves={
                  authorityIsMultisig
                    ? 'Only the treasury multisig can change the program code.'
                    : 'One key can change the program code today. It is not yet the multisig; this is devnet.'
                }
                check={
                  program?.upgradeAuthority
                    ? authorityIsMultisig
                      ? VERIFIED
                      : { tone: 'warn', label: 'SINGLE KEY' }
                    : { tone: 'ok', label: 'IMMUTABLE' }
                }
                address={program?.upgradeAuthority ?? null}
                addressLabel="Authority"
              />
              <ProofItem
                title="Program bytes you can compare"
                proves="The fingerprint of the code that is deployed right now. Build it yourself and compare."
                check={program?.sha256 ? LIVE : NOT_YET}
              >
                <span className="text-[13px] text-ink-2">
                  {program?.deployedBytes ? `${program.deployedBytes} bytes` : ''}
                  {program?.sha256 ? ` · sha256 ${program.sha256.slice(0, 12)}…` : ''}
                </span>
                {program?.sha256 ? <CopyButton value={program.sha256} label="Copy sha256" /> : null}
              </ProofItem>
              <ProofItem
                title="Verified (reproducible) build"
                proves="An independent rebuild from the public source matches the deployed bytes."
                check={program?.verifiedBuild?.status === 'verified' ? VERIFIED : NOT_YET}
                details={
                  <>
                    <p className="m-0">{program?.verifiedBuild?.detail ?? '—'}</p>
                    {program?.sha256 ? (
                      <p className="m-0">
                        Deployed sha256: <Mono>{program.sha256}</Mono>
                      </p>
                    ) : null}
                  </>
                }
              />
              <ProofItem
                title="Security contact in the program"
                proves="The program itself says who to contact and where its source code lives (security.txt)."
                check={program?.securityTxt ? VERIFIED : NOT_YET}
                details={
                  program?.securityTxt ? (
                    <dl className="m-0 grid gap-x-4 gap-y-1.5 sm:grid-cols-[120px_1fr]">
                      {Object.entries(program.securityTxt).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-muted">{SECURITY_TXT_LABEL[key] ?? key}</dt>
                          <dd className="m-0">
                            <SecurityTxtValue value={value} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="m-0">Not embedded.</p>
                  )
                }
              />
              <ProofItem
                title="Interface (IDL) published on-chain"
                proves="Wallets and explorers can decode every escrow instruction you sign."
                check={facts.idl.exists ? VERIFIED : NOT_YET}
                address={facts.idl.exists ? facts.idl.account : null}
                addressLabel="IDL"
              >
                {facts.idl.instructions?.length ? (
                  <ul className="m-0 flex flex-wrap gap-1.5 p-0" aria-label="Instructions">
                    {facts.idl.instructions.map((name) => (
                      <li key={name} className="list-none">
                        <Tag>{name}</Tag>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </ProofItem>
            </ul>
          </Panel>

          <SectionHead title="Treasury">
            Fees and payouts sit in a Squads multisig vault. Moving them needs the signer threshold
            below.
          </SectionHead>
          <Panel>
            <ul className="m-0 p-0">
              <ProofItem
                testId="multisig"
                title="Squads multisig"
                proves={
                  facts.multisig.threshold
                    ? `${facts.multisig.threshold} of ${facts.multisig.members.length} signers must approve every treasury transfer, read from the account.`
                    : 'Not readable right now.'
                }
                check={facts.multisig.threshold ? VERIFIED : NOT_YET}
                address={facts.multisig.address}
                addressLabel="Multisig"
                details={
                  <ul className="m-0 space-y-2 p-0">
                    {facts.multisig.members.map((member, index) => (
                      <li key={member} className="flex list-none flex-wrap items-center gap-2">
                        <Label>Signer {index + 1}</Label>
                        <Addr value={member} />
                      </li>
                    ))}
                  </ul>
                }
              />
            </ul>
          </Panel>
          <ul className="m-0 mt-3 grid gap-3 p-0 sm:grid-cols-2" data-testid="accounts">
            {facts.accounts
              .filter((account) => account.address !== facts.multisig.address)
              .map((account) => (
                <li key={account.role} className="list-none">
                  <Card className="h-full p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="m-0 text-[14px] font-semibold text-ink">{account.role}</h4>
                      <Chip
                        check={account.exists ? LIVE : { tone: 'neutral', label: 'NOT CREATED' }}
                      />
                    </div>
                    {account.lamports && account.exists ? (
                      <p className="m-0 mt-1 text-[13px] text-ink-2">
                        Balance {solText(account.lamports)}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <Addr value={account.address} />
                    </div>
                  </Card>
                </li>
              ))}
          </ul>

          <SectionHead title="Review engine">What decides whether a version goes live.</SectionHead>
          <Panel className="p-4 sm:p-5">
            <dl className="m-0 grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[150px_1fr]">
              <dt className="text-muted">Engine</dt>
              <dd className="m-0 font-mono text-ink">{facts.review.engine}</dd>
              <dt className="text-muted">Language model</dt>
              <dd className="m-0 text-ink">
                {facts.review.model ? (
                  <>
                    <span className="font-mono">{facts.review.model}</span>
                    {facts.review.reasoningEffort
                      ? `, reasoning ${facts.review.reasoningEffort}`
                      : ''}
                  </>
                ) : (
                  'none'
                )}
              </dd>
              <dt className="text-muted">Sandbox</dt>
              <dd className="m-0 font-mono text-ink">{facts.review.sandboxEngine}</dd>
              <dt className="text-muted">Report signing key</dt>
              <dd className="m-0">
                {facts.reportSigningKey ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="font-mono text-ink" title={facts.reportSigningKey}>
                      {shortKey(facts.reportSigningKey, 6, 6)}
                    </span>
                    <CopyButton value={facts.reportSigningKey} />
                  </span>
                ) : (
                  'not configured'
                )}
              </dd>
            </dl>
            <p className="m-0 mt-3 text-[13px] leading-relaxed text-ink-2">{facts.review.note}</p>
          </Panel>

          <SectionHead title="Recent escrows">
            Paid orders and their escrow accounts. Open one in Explorer to see the SOL it holds.
          </SectionHead>
          <Panel data-testid="recent-escrows">
            {facts.recentEscrows.length ? (
              <ul className="m-0 p-0">
                {facts.recentEscrows.map((row) => (
                  <li
                    key={row.escrow}
                    className="list-none border-t border-line-soft px-4 py-4 first:border-t-0 sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        href={`/l/${row.listing.slug}`}
                        className="text-[15px] font-semibold text-ink hover:underline"
                      >
                        {row.listing.title}
                      </Link>
                      <StatusTag status={row.status} />
                    </div>
                    <p className="m-0 mt-1 text-[13px] text-ink-2">
                      {solText(row.total)}
                      {row.escrowUntil ? ` · releasable after ${utc(row.escrowUntil)}` : ''}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Label>Escrow</Label>
                        <Addr value={row.escrow} />
                      </span>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Label>Payment</Label>
                        <Addr value={row.txSig} tx />
                      </span>
                      {row.releaseSig ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Label>Release</Label>
                          <Addr value={row.releaseSig} tx />
                        </span>
                      ) : null}
                      {row.refundSig ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Label>Refund</Label>
                          <Addr value={row.refundSig} tx />
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 p-4 text-[13px] text-muted">No paid escrows yet.</p>
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
      <details className="rounded-card border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
        <summary className="cursor-pointer text-[14px] font-semibold text-ink">
          Verify it yourself, without this page
        </summary>
        <ol className="m-0 mt-3 list-decimal space-y-2 pl-5 leading-relaxed">
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
      </details>
    </section>
  );
}
