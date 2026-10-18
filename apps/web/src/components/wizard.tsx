'use client';

import {
  BOT_RUNTIMES,
  BOT_SETTINGS,
  BOTS,
  BROWSERS,
  CADENCE_LABEL,
  CADENCES,
  FILTER_TYPES,
  INDICATOR_LANGUAGES,
  INDICATOR_PLATFORMS,
  kindMeta,
  LISTING_KINDS,
  SCRIPT_MANAGERS,
  TELEGRAM_FEATURES,
  WALLET_COLUMNS,
  WALLET_FORMATS,
  type ListingKind,
  type ListingSpecs,
} from '@trenchmart/shared';
import { useState, type ReactNode } from 'react';
import { CheckIcon, FileIcon, LockIcon, WebIcon } from './icons';
import { Label } from './ui';
import { STEPS, STEP_COUNT, TERMINAL_TILES, toggleIn, toggleTerminal } from '@/lib/wizard';

// Step icons, drawn for TrenchMart (no third-party marks).
const KIND_ICON: Record<ListingKind, ReactNode> = {
  script: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  bot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 7V6a2 2 0 0 1 2-2h10v3" />
      <circle cx="16" cy="13.5" r="1.3" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
  indicator: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  telegram: (
    <>
      <path d="M21 4 3 11l6 2 2 6 3-4 5 4z" />
      <path d="M9 13l12-9" />
    </>
  ),
  other: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <path d="M16.5 13.5v6M13.5 16.5h6" />
    </>
  ),
};

const KIND_COLOR: Record<ListingKind, [string, string, string]> = {
  script: ['#C6F432', '#141A10', 'USERSCRIPT'],
  bot: ['#C9A2FF', '#18121F', 'SETUP'],
  wallet: ['#7CC4FF', '#0F1620', 'WALLET LIST'],
  filter: ['#F5A524', '#1C160A', 'FILTER'],
  indicator: ['#6EE7C8', '#0E1A17', 'STRATEGY'],
  telegram: ['#FF8A7A', '#1F1210', 'ALERTS'],
  other: ['#B4BAB2', '#161916', 'SETUP'],
};

export function KindIcon({
  kind,
  className = 'h-6 w-6',
}: {
  kind: ListingKind;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {KIND_ICON[kind]}
    </svg>
  );
}

export function kindTag(kind: ListingKind) {
  const [color, , tag] = KIND_COLOR[kind];
  return (
    <span className="font-mono text-[11px] font-semibold tracking-wide" style={{ color }}>
      {tag}
    </span>
  );
}

function CheckBadge({ on }: { on: boolean }) {
  return on ? (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-onaccent">
      <CheckIcon className="h-3 w-3" />
    </span>
  ) : (
    <span className="block h-5 w-5 rounded-full border border-line-control" />
  );
}

/** Desktop stepper; collapses to a progress bar on phones. */
export function Stepper({
  step,
  specificsLabel,
  reached,
  onJump,
}: {
  step: number;
  specificsLabel: string;
  reached: number;
  onJump: (step: number) => void;
}) {
  const title = (n: number) => (n === 2 ? specificsLabel : STEPS[n - 1]!.title);
  return (
    <div>
      <ol
        data-testid="stepper"
        className="m-0 hidden list-none items-center rounded-panel border border-line bg-surface p-0 px-4 py-3 lg:flex"
      >
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = n < step;
          const now = n === step;
          return (
            <li key={s.title} className={`flex flex-1 items-center gap-3 ${i ? 'pl-3' : ''}`}>
              <button
                type="button"
                disabled={n > reached}
                aria-current={now ? 'step' : undefined}
                onClick={() => onJump(n)}
                className="flex min-w-0 items-center gap-3 text-left disabled:cursor-default"
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] font-mono text-xs font-bold ${done ? 'bg-accent text-onaccent' : now ? 'border-2 border-accent bg-accent-bg text-accent' : 'border border-line-strong text-faint'}`}
                >
                  {done ? '✓' : n}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block whitespace-nowrap text-[13px] font-medium ${done || now ? 'text-ink' : 'text-muted'}`}
                  >
                    {title(n)}
                  </span>
                  <span
                    className={`block whitespace-nowrap text-[11px] ${now ? 'text-accent' : 'text-faint'}`}
                  >
                    {now ? 'You are here' : done ? 'Done' : s.sub}
                  </span>
                </span>
              </button>
              {n < STEP_COUNT ? (
                <span
                  className={`ml-auto h-px min-w-4 flex-1 ${done ? 'bg-accent-line' : 'bg-line'}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="space-y-2 lg:hidden" data-testid="stepper-mobile">
        <div className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
          Step {step} of {STEP_COUNT} · <span className="text-accent">{title(step)}</span>
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 flex-1 rounded-full ${i + 1 < step ? 'bg-accent' : i + 1 === step ? 'bg-accent/50' : 'bg-line-strong'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Section({
  title,
  sub,
  right,
  children,
}: {
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-6">
        <div>
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          {sub ? <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p> : null}
        </div>
        {right}
      </div>
      <div className="p-5 pt-4 sm:p-6 sm:pt-4">{children}</div>
    </section>
  );
}

export function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-2 rounded-ctl border px-3.5 text-[13px] ${on ? 'border-accent-line bg-accent-bg text-ink' : 'border-line-control text-ink-2 hover:text-ink'}`}
    >
      {on ? (
        <span className="text-accent">
          <CheckIcon />
        </span>
      ) : (
        <span className="text-muted">+</span>
      )}
      {children}
    </button>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap rounded-ctl border border-line-control bg-inset p-1"
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={`rounded-[7px] px-3 py-1.5 text-[13px] ${value === key ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-ink'}`}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

// ---------- Step 1 ----------

export function TypeStep({
  kind,
  onPick,
  liveCounts,
}: {
  kind: ListingKind | null;
  onPick: (kind: ListingKind) => void;
  liveCounts: Record<string, number>;
}) {
  const selected = kindMeta(kind);
  return (
    <div className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.02em]">What are you selling?</h2>
          <p className="m-0 mt-1 text-[13px] text-muted">
            Pick one. Bundles of several things go under “Something else”.
          </p>
        </div>
        <a href="/docs" className="text-[13px] text-accent hover:text-accent-hover">
          Read the seller guide →
        </a>
      </div>
      <div
        role="radiogroup"
        aria-label="What you sell"
        className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4"
      >
        {LISTING_KINDS.map((k) => {
          const on = k.code === kind;
          const [color, bg] = KIND_COLOR[k.code];
          const live = liveCounts[k.category];
          return (
            <button
              key={k.code}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`kind-${k.code}`}
              onClick={() => onPick(k.code)}
              className={`relative flex h-full flex-col rounded-card border p-4 text-left sm:p-5 ${k.code === 'other' ? 'col-span-2 sm:col-span-1' : ''} ${on ? 'border-accent bg-accent-bg shadow-[0_0_0_3px_rgba(198,244,50,0.12)]' : 'border-line bg-surface hover:border-line-strong'}`}
            >
              <span className="flex items-start justify-between">
                <span
                  className="grid h-10 w-10 place-items-center rounded-ctl border sm:h-12 sm:w-12"
                  style={{ color, background: bg, borderColor: `${color}33` }}
                >
                  <KindIcon kind={k.code} className="h-5 w-5 sm:h-6 sm:w-6" />
                </span>
                <CheckBadge on={on} />
              </span>
              <span className="mt-3 block text-[15px] font-semibold tracking-[-0.01em] sm:mt-4 sm:text-[17px]">
                {k.label}
              </span>
              <span className="mt-1 block text-[13px] leading-snug text-ink-2">{k.blurb}</span>
              <span className="mt-2 hidden font-mono text-[11px] text-muted sm:block">
                {k.examples}
              </span>
              <span className="mt-auto flex items-center justify-between gap-2 pt-3 sm:mt-4 sm:border-t sm:border-line-soft">
                {kindTag(k.code)}
                <span className="hidden font-mono text-[11px] text-muted sm:inline">{k.files}</span>
              </span>
              {live ? (
                <span className="mt-1.5 hidden text-[11px] text-faint sm:block">
                  {live} live in this category
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="hidden flex-col justify-between rounded-card border border-dashed border-line-control bg-inset p-5 lg:flex">
          <div>
            <Label>Selected</Label>
            <p className="m-0 mt-2 text-[15px] font-semibold">{selected?.label ?? 'Nothing yet'}</p>
            <p className="m-0 mt-1 text-[13px] text-ink-2">
              {selected
                ? `Next: ${selected.specificsLabel.toLowerCase()}. The guide starts from the matching template.`
                : 'Pick a type to see what comes next.'}
            </p>
          </div>
          <ul className="m-0 mt-4 space-y-1.5 p-0 text-[12px] text-muted">
            {[
              'Static scan · eval, remote code, keys',
              'Sandbox run',
              'AI verdict, rules engine + LLM',
            ].map((t) => (
              <li key={t} className="flex list-none gap-2">
                <span className="text-accent">→</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------- Step 2 ----------

function Monogram({
  name,
  className = 'h-11 w-11 text-base',
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[10px] border border-line bg-surface-2 font-mono font-semibold text-ink ${className}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function TerminalPicker({
  value,
  onChange,
  title,
  sub,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  title: string;
  sub: ReactNode;
}) {
  const count = value.includes('Any') ? 'Any site' : `${value.length} selected`;
  return (
    <Section title={title} sub={sub}>
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6"
        data-testid="terminals"
      >
        {TERMINAL_TILES.map((t) => {
          const on = value.includes(t.name);
          return (
            <button
              key={t.name}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleTerminal(value, t.name))}
              className={`relative flex items-center gap-3 rounded-card border p-3 text-left sm:flex-col sm:items-start sm:p-4 ${on ? 'border-accent bg-accent-bg' : 'border-line-control/60 bg-inset hover:border-line-strong'}`}
            >
              <Monogram name={t.name} className="h-9 w-9 text-sm sm:h-11 sm:w-11 sm:text-base" />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{t.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted">{t.host}</span>
              </span>
              <span className="ml-auto sm:absolute sm:right-3 sm:top-3">
                <CheckBadge on={on} />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={value.includes('Any')}
          onClick={() => onChange(toggleTerminal(value, 'Any'))}
          className={`relative flex items-center gap-3 rounded-card border border-dashed p-3 text-left sm:flex-col sm:items-start sm:p-4 ${value.includes('Any') ? 'border-accent bg-accent-bg' : 'border-line-control bg-inset'}`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface-2 text-ink-2 sm:h-11 sm:w-11">
            <WebIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[15px] font-semibold">Any site</span>
            <span className="block font-mono text-[11px] text-muted">all terminals</span>
          </span>
          <span className="ml-auto sm:absolute sm:right-3 sm:top-3">
            <CheckBadge on={value.includes('Any')} />
          </span>
        </button>
      </div>
      <p className="m-0 mt-3 text-[12px] text-muted">
        <span className="text-accent">{count}</span> · “Any site” clears the others. Names are shown
        as text only; TrenchMart is not affiliated with these terminals.
      </p>
    </Section>
  );
}

function PermRow({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-3.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[12px] text-muted">{sub}</div>
      </div>
      {children}
    </div>
  );
}

function HostList({ hosts, onChange }: { hosts: string[]; onChange: (hosts: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const host = input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '');
    if (host && !hosts.includes(host) && hosts.length < 10) onChange([...hosts, host]);
    setInput('');
  };
  return (
    <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2 rounded-ctl border border-line bg-inset px-3 py-2.5">
      <span className="font-mono text-[12px] text-muted">hosts</span>
      {hosts.map((h) => (
        <span
          key={h}
          className="inline-flex items-center gap-1.5 rounded-tag border border-line bg-surface px-2 py-1 font-mono text-[12px] text-ink-2"
        >
          {h}
          <button
            type="button"
            aria-label={`Remove ${h}`}
            className="text-faint hover:text-ink"
            onClick={() => onChange(hosts.filter((x) => x !== h))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        aria-label="Add host"
        placeholder="+ add host, e.g. api.example.com"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className="min-w-[200px] flex-1 bg-transparent font-mono text-[12px] text-ink placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}

type SpecProps<K extends ListingKind> = {
  specs: ListingSpecs[K];
  set: (patch: Partial<ListingSpecs[K]>) => void;
};

export function ScriptSpecs({ specs, set }: SpecProps<'script'>) {
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Script manager" sub="Which extensions you tested it with.">
          <div className="flex flex-wrap gap-2">
            {SCRIPT_MANAGERS.map((m) => (
              <Pill
                key={m}
                on={specs.managers.includes(m)}
                onClick={() => set({ managers: toggleIn(specs.managers, m) })}
              >
                {m}
              </Pill>
            ))}
          </div>
        </Section>
        <Section title="Browsers" sub="Desktop only for userscripts.">
          <div className="flex flex-wrap gap-2">
            {BROWSERS.map((b) => (
              <Pill
                key={b}
                on={specs.browsers.includes(b)}
                onClick={() => set({ browsers: toggleIn(specs.browsers, b) })}
              >
                {b}
              </Pill>
            ))}
          </div>
        </Section>
      </div>
      <Section
        title="What it touches"
        sub="Declared up front. The review compares these with what the file actually does, and buyers see them on the listing."
      >
        <PermRow title="Reads the terminal page" sub="Token list, chart, holder panel">
          <Seg
            label="Reads the terminal page"
            options={
              [
                ['no', 'No'],
                ['yes', 'Yes'],
              ] as const
            }
            value={specs.readsPage ? 'yes' : 'no'}
            onChange={(v) => set({ readsPage: v === 'yes' })}
          />
        </PermRow>
        <PermRow title="Network requests" sub="Every host it calls must be listed">
          <Seg
            label="Network requests"
            options={
              [
                ['none', 'None'],
                ['terminal', 'Terminal API only'],
                ['hosts', 'Listed hosts'],
              ] as const
            }
            value={specs.network}
            onChange={(v) => set({ network: v })}
          />
        </PermRow>
        {specs.network === 'hosts' ? (
          <HostList hosts={specs.hosts} onChange={(hosts) => set({ hosts })} />
        ) : null}
        <PermRow
          title="Adds trade buttons"
          sub="Buttons that open the terminal’s own buy/sell form"
        >
          <Seg
            label="Adds trade buttons"
            options={
              [
                ['no', 'No'],
                ['yes', 'Yes'],
              ] as const
            }
            value={specs.tradeButtons ? 'yes' : 'no'}
            onChange={(v) => set({ tradeButtons: v === 'yes' })}
          />
        </PermRow>
        <PermRow title="Stores settings" sub="Where preferences are saved">
          <Seg
            label="Stores settings"
            options={
              [
                ['none', 'Nowhere'],
                ['local', 'localStorage'],
                ['remote', 'Remote'],
              ] as const
            }
            value={specs.storage}
            onChange={(v) => set({ storage: v })}
          />
        </PermRow>
        <PermRow
          title="Private keys, seed phrases, signing"
          sub="Scripts that read keys or sign transactions are rejected"
        >
          <span className="inline-flex items-center gap-2 rounded-ctl border border-line bg-inset px-3 py-2 text-[13px] text-muted">
            <LockIcon className="h-3.5 w-3.5" /> Never · locked
          </span>
        </PermRow>
      </Section>
    </>
  );
}

export function BotSpecs({ specs, set }: SpecProps<'bot'>) {
  return (
    <>
      <Section
        title="Which bot is it for?"
        sub="Buyers filter by bot. Pick every bot the config imports into."
      >
        <div className="flex flex-wrap gap-2" data-testid="bots">
          {BOTS.map((b) => (
            <Pill
              key={b}
              on={specs.bots.includes(b)}
              onClick={() => set({ bots: toggleIn(specs.bots, b) })}
            >
              {b}
            </Pill>
          ))}
        </div>
      </Section>
      <Section title="Settings included" sub="What the preset sets. Buyers see this list.">
        <div className="flex flex-wrap gap-2">
          {BOT_SETTINGS.map((s) => (
            <Pill
              key={s}
              on={specs.settings.includes(s)}
              onClick={() => set({ settings: toggleIn(specs.settings, s) })}
            >
              {s}
            </Pill>
          ))}
        </div>
      </Section>
    </>
  );
}

export function WalletSpecs({ specs, set }: SpecProps<'wallet'>) {
  return (
    <>
      <Section title="Chain" sub="Lists are Solana wallets; the review checks every address.">
        <div className="flex items-center gap-3 rounded-card border border-accent bg-accent-bg p-3.5 sm:max-w-[260px]">
          <span
            className="h-8 w-8 rounded-full"
            style={{ background: 'linear-gradient(135deg,#9945FF,#14F195)' }}
          />
          <span className="flex-1 text-[15px] font-semibold">Solana</span>
          <CheckBadge on />
        </div>
      </Section>
      <div className="grid gap-6 md:grid-cols-[1.25fr_1fr]">
        <Section title="Format" sub="Ship one or both. The review parses every row.">
          <div className="grid grid-cols-2 gap-3">
            {WALLET_FORMATS.map((f) => {
              const on = specs.formats.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ formats: toggleIn(specs.formats, f) })}
                  className={`rounded-card border p-4 text-left ${on ? 'border-accent bg-accent-bg' : 'border-line bg-inset'}`}
                >
                  <span className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-mono text-[15px] font-semibold">
                      <FileIcon className="h-4 w-4" />.{f}
                    </span>
                    <CheckBadge on={on} />
                  </span>
                  <span className="mt-2 block truncate font-mono text-[11px] text-muted">
                    {f === 'csv' ? 'address,label,tags,…' : '[{ "address", "label", … }]'}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
        <Section
          title="Wallet count"
          sub="How many wallets the file holds. Say it exactly: buyers compare."
        >
          <div className="flex items-center gap-3">
            <div className="flex h-14 flex-1 items-center rounded-ctl border border-line-control bg-inset">
              <button
                type="button"
                aria-label="Fewer wallets"
                className="grid h-full w-12 place-items-center border-r border-line text-lg text-muted hover:text-ink"
                onClick={() => set({ walletCount: Math.max(1, specs.walletCount - 1) })}
              >
                −
              </button>
              <input
                aria-label="Wallet count"
                inputMode="numeric"
                value={String(specs.walletCount)}
                onChange={(e) =>
                  set({ walletCount: Number(e.target.value.replace(/\D/g, '')) || 0 })
                }
                className="tabular w-full flex-1 bg-transparent text-center font-mono text-2xl font-semibold focus:outline-none"
              />
              <button
                type="button"
                aria-label="More wallets"
                className="grid h-full w-12 place-items-center border-l border-line text-lg text-muted hover:text-ink"
                onClick={() => set({ walletCount: specs.walletCount + 1 })}
              >
                +
              </button>
            </div>
            <span className="text-[13px] text-muted">wallets</span>
          </div>
        </Section>
      </div>
      <Section
        title="Refresh cadence"
        sub="Each refresh ships as a new version. Update subscribers get it automatically."
      >
        <div
          role="radiogroup"
          aria-label="Refresh cadence"
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          {CADENCES.map((c) => {
            const on = specs.cadence === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ cadence: c })}
                className={`rounded-card border p-4 text-left ${on ? 'border-accent bg-accent-bg' : 'border-line-control/60 bg-inset'}`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">{CADENCE_LABEL[c]}</span>
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full border ${on ? 'border-accent' : 'border-line-control'}`}
                  >
                    {on ? <span className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
                  </span>
                </span>
                <span className="mt-1 block text-[12px] text-muted">
                  {c === 'oneoff'
                    ? 'Snapshot, no refresh'
                    : c === 'daily'
                      ? 'New version every day'
                      : c === 'weekly'
                        ? 'New version every week'
                        : 'Once a month'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Columns included" sub="Address is always there.">
        <div className="flex flex-wrap gap-2">
          {WALLET_COLUMNS.map((col) => (
            <Pill
              key={col}
              on={specs.columns.includes(col)}
              onClick={() => set({ columns: toggleIn(specs.columns, col) })}
            >
              {col}
            </Pill>
          ))}
        </div>
      </Section>
    </>
  );
}

export function FilterSpecs({ specs, set }: SpecProps<'filter'>) {
  return (
    <Section
      title="What the filters cover"
      sub="Shown on the listing so buyers know what they paste in."
    >
      <div className="flex flex-wrap gap-2">
        {FILTER_TYPES.map((f) => (
          <Pill
            key={f}
            on={specs.filterTypes.includes(f)}
            onClick={() => set({ filterTypes: toggleIn(specs.filterTypes, f) })}
          >
            {f}
          </Pill>
        ))}
      </div>
    </Section>
  );
}

export function IndicatorSpecs({ specs, set }: SpecProps<'indicator'>) {
  return (
    <>
      <Section title="Platform" sub="Where buyers load it.">
        <Seg
          label="Platform"
          options={INDICATOR_PLATFORMS.map((p) => [p, p] as const)}
          value={specs.platform}
          onChange={(v) => set({ platform: v })}
        />
      </Section>
      <Section title="Format" sub="What the file is.">
        <Seg
          label="Format"
          options={INDICATOR_LANGUAGES.map((p) => [p, p] as const)}
          value={specs.language}
          onChange={(v) => set({ language: v })}
        />
      </Section>
    </>
  );
}

export function TelegramSpecs({ specs, set }: SpecProps<'telegram'>) {
  return (
    <>
      <Section title="Runtime" sub="Buyers host it themselves; say what it needs.">
        <Seg
          label="Runtime"
          options={BOT_RUNTIMES.map((p) => [p, p] as const)}
          value={specs.runtime}
          onChange={(v) => set({ runtime: v })}
        />
      </Section>
      <Section title="What it does" sub="Shown on the listing.">
        <div className="flex flex-wrap gap-2">
          {TELEGRAM_FEATURES.map((f) => (
            <Pill
              key={f}
              on={specs.features.includes(f)}
              onClick={() => set({ features: toggleIn(specs.features, f) })}
            >
              {f}
            </Pill>
          ))}
        </div>
      </Section>
    </>
  );
}

export function OtherSpecs({ specs, set }: SpecProps<'other'>) {
  return (
    <Section title="What is it?" sub="A few words. The review uses it to pick the checks.">
      <input
        aria-label="What it is"
        value={specs.what}
        maxLength={120}
        placeholder="Full Axiom layout with filters and a playbook PDF"
        onChange={(e) => set({ what: e.target.value })}
        className="w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm placeholder:text-faint"
      />
    </Section>
  );
}
