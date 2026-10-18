import { Fragment } from 'react';
import { terminalLogo } from '@/lib/terminal-logos';

/**
 * Small inline logo shown before a terminal's name. Decorative (the name is next to it);
 * renders nothing for terminals without a bundled logo.
 */
export function TerminalMark({
  name,
  className = 'h-3 w-3',
}: {
  name: string;
  className?: string;
}) {
  const src = terminalLogo(name);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      data-terminal-logo={name}
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`inline-block shrink-0 rounded-[3px] object-cover align-[-0.125em] ${className}`}
    />
  );
}

/** A terminal name with its logo, kept inline so surrounding text and spacing stay as they were. */
export function TerminalName({ name, logoClassName }: { name: string; logoClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <TerminalMark name={name} className={logoClassName} />
      {name}
    </span>
  );
}

/** "Axiom · GMGN" with each name's logo; the text reads exactly as the old joined string. */
export function TerminalNames({
  names,
  logoClassName,
}: {
  names: readonly string[];
  logoClassName?: string;
}) {
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={name}>
          {i ? ' · ' : null}
          <TerminalName name={name} logoClassName={logoClassName} />
        </Fragment>
      ))}
    </>
  );
}
