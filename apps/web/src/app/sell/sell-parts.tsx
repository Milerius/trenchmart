'use client';

import { Coins, Lock, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { TIER_LABEL, usePublicConfig } from '@/lib/config';
import { useFxModule } from '@/lib/fx';
import { solExact } from '@/lib/money';

export const SELL_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Wallet,
    title: 'Connect and sign in',
    body: 'Sign a message with your wallet. No transaction is needed to sign in.',
  },
  {
    icon: Lock,
    title: 'Post your creator bond',
    body: 'A bond for the category you sell. It backs buyers if a dispute is upheld.',
  },
  {
    icon: ShieldCheck,
    title: 'Upload and watch the review',
    body: 'Static checks (and, for scripts, an isolated sandbox) run at once, then a rules engine and an LLM review the code against your listing and approve, reject or ask for a note. About a minute, not days.',
  },
  {
    icon: Coins,
    title: 'Get paid in SOL',
    body: 'You keep 100% of your price. Each sale pays out after its escrow releases.',
  },
];

const loadStepper = () => import('./sell-stepper');

/** React Bits Stepper on desktop; a plain numbered list on phones, reduced motion and in tests. */
export function SellSteps() {
  const Stepper = useFxModule(loadStepper);
  if (Stepper) return <Stepper />;
  return (
    <ol data-testid="sell-steps" className="m-0 flex flex-col gap-3 p-0">
      {SELL_STEPS.map(({ icon: Icon, title, body }, index) => (
        <li
          key={title}
          className="flex list-none gap-4 rounded-card border border-line bg-surface p-5"
        >
          <span className="font-mono text-xs text-accent">0{index + 1}</span>
          <span className="flex flex-col gap-2">
            <span className="flex items-center gap-2">
              <Icon size={18} className="text-accent" aria-hidden="true" />
              <span className="text-base font-semibold">{title}</span>
            </span>
            <span className="text-sm text-ink-2">{body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const sol = (lamports: string | number) => solExact(lamports).replace(/\.0+$|(\.\d*?)0+$/, '$1');

/** Live creator costs from /config/public. Rows wait for the config rather than guess. */
export function SellFees({
  verificationFreeFrom,
  ogBondDiscount,
  bondUnlockDays,
}: {
  verificationFreeFrom: string;
  ogBondDiscount: string;
  bondUnlockDays: number;
}) {
  const config = usePublicConfig();
  const bonds = config ? Object.values(config.bondLamportsByCategory).map(BigInt) : [];
  const low = bonds.length ? bonds.reduce((a, b) => (b < a ? b : a)) : null;
  const high = bonds.length ? bonds.reduce((a, b) => (b > a ? b : a)) : null;
  const rows: [string, string | null, string][] = [
    ['Creator commission', '0%', 'at every tier'],
    [
      'Verification fee',
      config ? `${sol(config.verificationFeeLamports)} SOL` : null,
      `per version · free from ${TIER_LABEL[verificationFreeFrom] ?? verificationFreeFrom} tier`,
    ],
    [
      'Creator bond',
      low !== null && high !== null
        ? low === high
          ? `${sol(low.toString())} SOL`
          : `${sol(low.toString())}–${sol(high.toString())} SOL`
        : null,
      `by category · OG holders ${ogBondDiscount} off · unlocks after ${bondUnlockDays} days`,
    ],
    [
      'Uploads',
      config?.uploadLimitPerCreatorDay != null
        ? `${config.uploadLimitPerCreatorDay} free / day`
        : null,
      config?.uploadSupplementLamports
        ? `then ${sol(config.uploadSupplementLamports)} SOL each`
        : 'then a small SOL supplement each',
    ],
    [
      'Escrow window',
      config ? `${config.escrowHours} hour${config.escrowHours === 1 ? '' : 's'}` : null,
      'then payout from the Squads vault',
    ],
  ];
  return (
    <div
      data-testid="sell-fees"
      className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface"
    >
      {rows.map(([label, value, note]) => (
        <div key={label} className="flex items-center justify-between gap-4 p-5">
          <span>
            <span className="block font-medium">{label}</span>
            <span className="block text-sm text-muted">{note}</span>
          </span>
          {value ? (
            <span className="shrink-0 font-mono text-lg font-semibold text-accent">{value}</span>
          ) : (
            <span aria-hidden="true" className="h-5 w-16 shrink-0 animate-pulse rounded bg-inset" />
          )}
        </div>
      ))}
    </div>
  );
}

export function StudioLink() {
  return (
    <Link
      href="/studio"
      className="inline-flex h-12 items-center rounded-full border border-line-control px-6 font-medium hover:border-ink-2"
    >
      Open creator studio
    </Link>
  );
}
