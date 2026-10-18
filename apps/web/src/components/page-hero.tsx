import type { ReactNode } from 'react';

/** Content column for the full-bleed pages (same width as the shell's column). */
export const MARKET_WRAP = 'mx-auto max-w-7xl px-4 sm:px-6';

/** Prototype page hero: grid fade, a soft accent glow, mono eyebrow, big title. */
export function PageHero({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line-soft">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className={`${MARKET_WRAP} relative flex flex-col gap-5 pt-14 pb-12 sm:pt-16`}>
        <span className="font-mono text-xs font-medium tracking-[.18em] text-accent uppercase">
          {eyebrow}
        </span>
        <h1 className="m-0 max-w-4xl text-[clamp(38px,5.5vw,72px)] leading-[1] font-semibold tracking-[-0.04em]">
          {title}
        </h1>
        {sub ? <p className="m-0 max-w-2xl text-lg text-ink-2">{sub}</p> : null}
        {children}
      </div>
    </section>
  );
}
