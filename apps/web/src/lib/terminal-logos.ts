import { canonicalTerminal, TERMINALS } from '@trenchmart/shared';

/**
 * Each terminal's own logo, taken from its site's favicon and served from apps/web/public
 * (never hotlinked). Keyed by the canonical name from @trenchmart/shared.
 */
export const TERMINAL_LOGOS: Record<(typeof TERMINALS)[number], string> = {
  Axiom: '/terminals/axiom.svg',
  GMGN: '/terminals/gmgn.png',
  Photon: '/terminals/photon.png',
  Terminal: '/terminals/terminal.svg',
  Trojan: '/terminals/trojan.png',
};

/** Logo path for a terminal name (any casing or alias such as "padre"); null for unknown ones and "Any". */
export function terminalLogo(name: string): string | null {
  const canonical = canonicalTerminal(name);
  if (!canonical) return null;
  return (TERMINAL_LOGOS as Record<string, string | undefined>)[canonical] ?? null;
}
