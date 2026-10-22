'use client';

import { useEffect, useState } from 'react';
import { Identicon } from '@/components/leaderboard';
import { MARKET_WRAP, PageHero } from '@/components/page-hero';
import { RewardEpochsTable } from '@/components/rewards';
import {
  sol,
  useRewardCurrent,
  useRewardEpochs,
  useRewardTop,
  useWalletRewards,
} from '@/components/rewards-data';
import { Skeleton, buttonClass } from '@/components/ui';
import { useWallet } from '@/lib/wallet';

const card = 'rounded-panel border border-line bg-surface p-7';
const eyebrow = 'm-0 font-mono text-[11px] uppercase tracking-[0.08em] text-muted';
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (now === null) return <span className="tabular">--:--:--</span>;
  const s = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="tabular" data-testid="rewards-countdown">
      {`${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`}
    </span>
  );
}

export default function RewardsPage() {
  const current = useRewardCurrent();
  const epochs = useRewardEpochs(8);
  const top = useRewardTop(5);
  const wallet = useWallet();
  const me = wallet.session?.wallet ?? null;
  const mine = useWalletRewards(me);
  const cur = current && current !== 'error' ? current : null;
  const gross = BigInt(cur?.holderGrossSoFar ?? '0');
  const minSol = cur ? sol(cur.rules.minPayoutLamports, 2) : '0.01';
  const last = mine && mine !== 'error' ? mine.epochs[0] : undefined;

  return (
    <article>
      <PageHero
        eyebrow="$MART · holder rewards · devnet"
        title="Half the net revenue, to the top 1,000 holders. Every 3 hours."
        sub={`50% of released-sale revenue, net of costs (RPC, network and priority fees, payout fees, infra share), is pushed in SOL to the top 1,000 $MART holders by time-weighted balance. Minimum holding 0.05% of supply. Shares under ${minSol} SOL carry over to the next epoch.`}
      />
      <div className={`${MARKET_WRAP} flex flex-col gap-10 py-12`}>
        <section className="grid gap-4 lg:grid-cols-3">
          <div
            className={`${card} flex flex-col gap-3`}
            style={{ boxShadow: 'inset 0 2px 0 #C6F432' }}
          >
            <p className={`${eyebrow} flex items-center gap-2 text-accent`}>
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Next distribution{cur ? ` · epoch #${cur.epoch}` : ''}
            </p>
            <span className="text-5xl font-semibold tracking-[-0.04em] text-accent">
              {cur ? <Countdown endsAt={cur.endsAt} /> : <Skeleton className="h-12 w-52" />}
            </span>
            <span className="text-sm text-muted">
              Balance samples are taken at random times this epoch.
              {cur ? ` ${cur.samples.done} of ${cur.samples.planned} done.` : ''}
            </span>
          </div>
          <div className={`${card} flex flex-col gap-3`}>
            <p className={eyebrow}>Pool so far (this epoch)</p>
            <span
              className="tabular text-5xl font-semibold tracking-[-0.04em]"
              data-testid="rewards-pool"
            >
              ◎ {sol(gross + BigInt(cur?.carryIn ?? '0'), 3)}
            </span>
            <dl className="m-0 grid grid-cols-3 gap-2 font-mono text-[12px] text-ink-2">
              <div>
                <dt className="text-muted">Revenue</dt>
                <dd className="m-0">◎ {sol(cur?.revenueSoFar ?? '0', 3)}</dd>
              </div>
              <div>
                <dt className="text-muted">Carried in</dt>
                <dd className="m-0">◎ {sol(cur?.carryIn ?? '0', 3)}</dd>
              </div>
              <div>
                <dt className="text-muted">Holders 50%</dt>
                <dd className="m-0 text-accent">◎ {sol(gross, 3)}</dd>
              </div>
            </dl>
            <span className="text-xs text-faint">Costs are subtracted when the epoch closes.</span>
          </div>
          <div
            className={`${card} flex flex-col gap-3`}
            style={{ boxShadow: 'inset 0 2px 0 #7CC4FF' }}
            data-testid="rewards-mine"
          >
            <p className={eyebrow}>Your share{me ? ` · ${short(me)}` : ''}</p>
            {!me ? (
              <>
                <span className="text-2xl font-semibold tracking-tight">Connect a wallet</span>
                <span className="text-sm text-ink-2">
                  to see your rank, weight and anything carried over.
                </span>
              </>
            ) : mine === null ? (
              <Skeleton className="h-12 w-40" />
            ) : mine === 'error' ? (
              <span className="text-sm text-ink-2">Could not load your rewards right now.</span>
            ) : (
              <>
                <span className="tabular text-5xl font-semibold tracking-[-0.04em]">
                  ◎ {sol(last ? last.lamports : '0', 4)}
                </span>
                <span className="text-sm text-ink-2">
                  {last
                    ? `Last epoch #${last.epoch}: rank #${last.rank} of 1,000 · ${last.status === 'pay' ? 'paid' : 'carried'}`
                    : 'Not in the top 1,000 yet. Hold at least 0.05% of supply for two epochs.'}
                </span>
                {BigInt(mine.carry) > 0n ? (
                  <span className="rounded-ctl border border-line bg-inset px-3 py-2 font-mono text-[12px] text-warning">
                    Carried: ◎ {sol(mine.carry, 4)} (paid once it reaches {minSol} SOL)
                  </span>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="m-0 text-3xl font-semibold tracking-[-0.03em]">Last distributions</h2>
            <a
              className={buttonClass('secondary', 'sm')}
              href="/api/v1/rewards/epochs/recent"
              target="_blank"
              rel="noopener noreferrer"
            >
              Feed JSON · /api/v1/rewards/epochs/recent
            </a>
          </div>
          {epochs === null ? (
            <Skeleton className="h-40 w-full" />
          ) : epochs === 'error' || epochs.length === 0 ? (
            <p data-testid="rewards-empty" className={`${card} m-0 text-sm text-ink-2`}>
              {epochs === 'error'
                ? 'Distributions could not be loaded right now.'
                : 'No distributions yet. The first one runs when an epoch with revenue closes.'}
            </p>
          ) : (
            <RewardEpochsTable epochs={epochs} />
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className={card}>
            <h2 className="m-0 mb-4 text-2xl font-semibold tracking-tight">
              Top holders · last epoch
            </h2>
            {top && top !== 'error' && top.holders.length ? (
              <ol className="m-0 flex flex-col gap-2 p-0" data-testid="rewards-top">
                {top.holders.map((h) => (
                  <li
                    key={h.wallet}
                    className="flex list-none items-center gap-3 rounded-ctl border border-line bg-inset px-3 py-2"
                  >
                    <span className="w-8 font-mono text-[12px] text-muted">#{h.rank}</span>
                    <Identicon wallet={h.wallet} className="h-6 w-6 rounded-full" />
                    <span className="flex-1 font-mono text-[13px]">{short(h.wallet)}</span>
                    <span className="font-mono text-[12px] text-muted">
                      {(h.weightBps / 100).toFixed(2)}%
                    </span>
                    <span className="font-mono text-[13px] text-accent">
                      ◎ {sol(h.lamports, 4)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 text-sm text-ink-2">No allocations yet.</p>
            )}
          </div>
          <div className={`${card} flex flex-col gap-3 text-sm text-ink-2`}>
            <h2 className="m-0 text-2xl font-semibold tracking-tight text-ink">How it works</h2>
            <p className="m-0">
              Only released sales count. Refunds and disputes never enter the pool.
            </p>
            <p className="m-0">
              Costs are subtracted first and listed per epoch: RPC, network and priority fees,
              payout fees, infra share.
            </p>
            <p className="m-0">
              Excluded: bonding curve, LP and pool vaults, treasury, team, burn and CEX wallets.
            </p>
            <p className="m-0">
              Weight is your lowest balance across 6 random samples. You must hold 0.05% of supply
              for 2 epochs to qualify. Ties at rank 1,000 go to the older holder.
            </p>
            <p className="m-0 text-faint">
              Revenue sharing may have legal implications. Devnet preview, not an offer.
            </p>
          </div>
        </section>
      </div>
    </article>
  );
}
