/**
 * Trading terminals a listing can declare compatibility with. "Terminal" is the
 * former Padre (padre.gg). BullX is no longer listed.
 */
export const TERMINALS = ['Axiom', 'GMGN', 'Photon', 'Terminal', 'Trojan'] as const;
export type TerminalName = (typeof TERMINALS)[number] | 'Any';

const ALIASES: Record<string, TerminalName | null> = {
  axiom: 'Axiom',
  gmgn: 'GMGN',
  photon: 'Photon',
  terminal: 'Terminal',
  padre: 'Terminal',
  trojan: 'Trojan',
  any: 'Any',
  bullx: null,
};

/** Canonical casing for a known terminal; `null` drops a retired one; others pass through trimmed. */
export function canonicalTerminal(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (key in ALIASES) return ALIASES[key] ?? null;
  return trimmed;
}

/** Normalised, de-duplicated terminal tags in input order. */
export function canonicalTerminals(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const value = canonicalTerminal(name);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}
