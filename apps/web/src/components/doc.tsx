import type { ReactNode } from 'react';

export function DocHeader({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: ReactNode;
  lede: string;
}) {
  return (
    <header className="flex max-w-3xl flex-col gap-3">
      <span className="font-mono text-xs font-medium tracking-[.18em] text-accent uppercase">
        {kicker}
      </span>
      <h1 className="m-0 text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] sm:text-5xl">
        {title}
      </h1>
      <p className="m-0 text-lg text-ink-2">{lede}</p>
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
      <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-ink-2">{children}</div>
    </section>
  );
}

export function FactGrid({ facts }: { facts: { testId: string; label: string; text: string }[] }) {
  return (
    <dl className="m-0 mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.testId} className="min-w-0 rounded-card border border-line bg-surface p-4">
          <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            {fact.label}
          </dt>
          <dd
            data-testid={fact.testId}
            className="m-0 mt-1 text-base font-semibold text-ink [overflow-wrap:anywhere]"
          >
            {fact.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <figure className="m-0 overflow-hidden rounded-card border border-line bg-inset">
      {label ? (
        <figcaption className="border-b border-line-soft px-4 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
          {label}
        </figcaption>
      ) : null}
      <pre
        tabIndex={0}
        className="m-0 overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-ink-2"
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[13px] text-ink [overflow-wrap:anywhere]">{children}</code>
  );
}
