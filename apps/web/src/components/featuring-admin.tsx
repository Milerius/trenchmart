'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Money, Tag } from '@/components/ui';
import { api } from '@/lib/api';

type Kind = 'home' | 'category' | 'band';
const KINDS: Kind[] = ['home', 'category', 'band'];
const TIERS = ['none', 'scout', 'trencher', 'og'] as const;

type AdminFeaturing = {
  config: {
    slots: Record<Kind, { perDay: number; lamportsPerDay: string; label: string }>;
    discountBps: Record<string, number>;
    rules: Record<string, number>;
  };
  bookings: {
    id: string;
    title: string;
    kind: Kind;
    startDay: string;
    days: number;
    total: string;
    status: string;
    refundLamports: string;
  }[];
  totals: { received: string; refunded: string; active: number };
};

const RULE_LABEL: Record<string, string> = {
  maxConsecutiveDays: 'Max consecutive days',
  maxDaysAhead: 'Max days ahead',
  minRatingX10: 'Min rating ×10',
  holdMinutes: 'Payment hold (min)',
  cancelHours: 'Full-refund cancel cutoff (h)',
  homePerCreatorPerDay: 'Home slots per creator per day',
};

function solToLamports(text: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (!m) return null;
  return (BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0'))).toString();
}

function lamportsToSol(lamports: string): string {
  const n = BigInt(lamports);
  const whole = n / 1_000_000_000n;
  const frac = (n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Admin: featuring prices, slots per day, $TRENCH tier discounts and rules (config rows). */
export function FeaturingAdmin() {
  const [data, setData] = useState<AdminFeaturing | null>(null);
  const [prices, setPrices] = useState<Record<Kind, { perDay: string; sol: string }> | null>(null);
  const [discounts, setDiscounts] = useState<Record<string, string>>({});
  const [rules, setRules] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<AdminFeaturing>('/admin/featuring')
      .then((body) => {
        setData(body);
        setPrices(
          Object.fromEntries(
            KINDS.map((k) => [
              k,
              {
                perDay: String(body.config.slots[k].perDay),
                sol: lamportsToSol(body.config.slots[k].lamportsPerDay),
              },
            ]),
          ) as Record<Kind, { perDay: string; sol: string }>,
        );
        setDiscounts(
          Object.fromEntries(
            TIERS.map((t) => [t, String((body.config.discountBps[t] ?? 0) / 100)]),
          ),
        );
        setRules(
          Object.fromEntries(Object.entries(body.config.rules).map(([k, v]) => [k, String(v)])),
        );
      })
      .catch(() => setData(null));
  }, []);
  useEffect(load, [load]);

  async function save() {
    if (!prices) return;
    setStatus(null);
    const slots: Record<string, { perDay: number; lamportsPerDay: string }> = {};
    for (const k of KINDS) {
      const lamports = solToLamports(prices[k].sol);
      if (lamports === null) return setStatus(`Invalid price for ${k}`);
      slots[k] = { perDay: Number(prices[k].perDay), lamportsPerDay: lamports };
    }
    const discountBps = Object.fromEntries(
      TIERS.map((t) => [t, Math.round(Number(discounts[t] ?? 0) * 100)]),
    );
    const ruleValues = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, Number(v)]));
    try {
      for (const [key, value] of [
        ['feature_slots', slots],
        ['feature_discount_bps', discountBps],
        ['feature_rules', ruleValues],
      ] as const) {
        await api(`/admin/config/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });
      }
      setStatus('Saved.');
      load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'save failed');
    }
  }

  if (!data || !prices) return null;
  const input = 'w-24 rounded-ctl border border-line bg-bg px-2 py-1 font-mono text-sm';
  return (
    <section
      className="space-y-4 rounded-panel border border-line bg-surface p-5"
      data-testid="featuring-admin"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold">Featuring</h2>
        <span className="flex flex-wrap gap-2 text-sm text-ink-2">
          <Tag tone="ok">{data.totals.active} running or booked</Tag>
          <span>
            received <Money lamports={data.totals.received} centsPerSol={null} />
          </span>
          <span>
            refunded <Money lamports={data.totals.refunded} centsPerSol={null} />
          </span>
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <fieldset className="m-0 space-y-2 rounded-ctl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Slots and price per day (SOL)</legend>
          {KINDS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink-2">{data.config.slots[k].label}</span>
              <span className="flex gap-1">
                <input
                  aria-label={`${k} slots per day`}
                  className={`${input} w-14`}
                  value={prices[k].perDay}
                  onChange={(e) =>
                    setPrices({ ...prices, [k]: { ...prices[k], perDay: e.target.value } })
                  }
                />
                <input
                  aria-label={`${k} SOL per day`}
                  className={input}
                  value={prices[k].sol}
                  onChange={(e) =>
                    setPrices({ ...prices, [k]: { ...prices[k], sol: e.target.value } })
                  }
                />
              </span>
            </div>
          ))}
        </fieldset>
        <fieldset className="m-0 space-y-2 rounded-ctl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">$TRENCH tier discount (%)</legend>
          {TIERS.map((t) => (
            <div key={t} className="flex items-center justify-between gap-2 text-sm">
              <span className="capitalize text-ink-2">{t}</span>
              <input
                aria-label={`${t} discount percent`}
                className={input}
                value={discounts[t] ?? '0'}
                onChange={(e) => setDiscounts({ ...discounts, [t]: e.target.value })}
              />
            </div>
          ))}
        </fieldset>
        <fieldset className="m-0 space-y-2 rounded-ctl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Rules</legend>
          {Object.keys(rules).map((k) => (
            <div key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink-2">{RULE_LABEL[k] ?? k}</span>
              <input
                aria-label={RULE_LABEL[k] ?? k}
                className={`${input} w-16`}
                value={rules[k]}
                onChange={(e) => setRules({ ...rules, [k]: e.target.value })}
              />
            </div>
          ))}
        </fieldset>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()}>Save featuring config</Button>
        {status ? <span className="text-sm text-muted">{status}</span> : null}
      </div>
      {data.bookings.length ? (
        <ul className="m-0 space-y-1 p-0 text-sm">
          {data.bookings.slice(0, 20).map((b) => (
            <li
              key={b.id}
              className="flex list-none flex-wrap gap-3 border-t border-line-soft pt-1"
            >
              <span className="font-mono text-muted">{b.startDay}</span>
              <span>{b.title}</span>
              <span className="text-ink-2">{b.kind}</span>
              <span>{b.days}d</span>
              <Money lamports={b.total} centsPerSol={null} />
              <Tag>{b.status.toUpperCase()}</Tag>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted">No bookings yet.</p>
      )}
    </section>
  );
}
