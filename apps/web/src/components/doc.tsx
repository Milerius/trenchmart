import type { ReactNode } from 'react';
import { Label } from '@/components/ui';

export function DocHeader({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="max-w-2xl">
      <Label className="text-accent-label">{kicker}</Label>
      <h1 className="m-0 mt-2 text-[40px] font-semibold leading-tight tracking-[-0.03em]">
        {title}
      </h1>
      <p className="m-0 mt-3 text-[17px] text-ink-2">{lede}</p>
    </header>
  );
}

export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10 max-w-3xl">
      <h2 className="m-0 text-xl font-semibold tracking-[-0.02em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-ink-2">{children}</div>
    </section>
  );
}

export function FactGrid({ facts }: { facts: { testId: string; label: string; text: string }[] }) {
  return (
    <dl className="m-0 mt-4 grid gap-3 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.testId} className="rounded-card border border-line bg-surface p-4">
          <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            {fact.label}
          </dt>
          <dd data-testid={fact.testId} className="m-0 mt-1 text-base font-semibold text-ink">
            {fact.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}
