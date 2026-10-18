import {
  categoryForKind,
  kindMeta,
  parseSpecs,
  solToLamports,
  type ListingKind,
  type ListingSpecs,
} from '@trenchmart/shared';
import { templateFor, type ContentField } from './listing-templates';

/** The seven wizard steps. Step 2's title depends on the kind. */
export const STEPS = [
  { title: 'What you sell', sub: 'Type' },
  { title: 'Specifics', sub: 'Type-specific' },
  { title: 'Details', sub: 'Title, guide' },
  { title: 'Media', sub: 'Cover, screens' },
  { title: 'Pricing', sub: 'Price, updates' },
  { title: 'File', sub: 'Upload, fee' },
  { title: 'Review', sub: 'Submit' },
] as const;
export const STEP_COUNT = STEPS.length;

export const TERMINAL_TILES = [
  { name: 'Axiom', host: 'axiom.trade' },
  { name: 'GMGN', host: 'gmgn.ai' },
  { name: 'Photon', host: 'photon-sol.tinyastro.io' },
  { name: 'Terminal', host: 'trade.padre.gg' },
  { name: 'Trojan', host: 'trojan.com' },
] as const;

export const DEFAULT_SPECS: ListingSpecs = {
  script: {
    managers: ['Tampermonkey', 'Violentmonkey'],
    browsers: ['Chrome', 'Brave', 'Edge', 'Firefox'],
    readsPage: true,
    network: 'terminal',
    hosts: [],
    tradeButtons: false,
    storage: 'local',
  },
  bot: { bots: [], settings: [] },
  wallet: {
    chain: 'solana',
    formats: ['csv'],
    walletCount: 100,
    cadence: 'weekly',
    columns: ['address', 'label'],
  },
  filter: { filterTypes: [] },
  indicator: { platform: 'TradingView', language: 'Pine Script' },
  telegram: { runtime: 'Node.js', features: [] },
  other: { what: '' },
};

export type Draft = {
  version: 1;
  step: number;
  kind: ListingKind | null;
  terminals: string[];
  specs: ListingSpecs;
  title: string;
  summary: string;
  description: string;
  text: Record<ContentField, string>;
  price: string;
  updatesOn: boolean;
  /** null follows the suggested share of the price. */
  updatePrice: string | null;
  savedAt: string | null;
};

export function emptyDraft(): Draft {
  return {
    version: 1,
    step: 1,
    kind: null,
    terminals: [],
    specs: structuredClone(DEFAULT_SPECS),
    title: '',
    summary: '',
    description: '',
    text: templateFor('userscript'),
    price: '',
    updatesOn: true,
    updatePrice: null,
    savedAt: null,
  };
}

export const draftKey = (wallet: string) => `tm:new-listing:${wallet}`;

/** Reads a stored draft; anything unreadable or from another shape starts fresh. */
export function readDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Draft>;
    if (value.version !== 1) return null;
    const base = emptyDraft();
    return {
      ...base,
      ...value,
      specs: { ...base.specs, ...(value.specs ?? {}) },
      text: { ...base.text, ...(value.text ?? {}) },
      step: Math.min(Math.max(1, Number(value.step) || 1), STEP_COUNT),
    } as Draft;
  } catch {
    return null;
  }
}

/** Switching kind swaps untouched template sections to the new category's template. */
export function withKind(draft: Draft, kind: ListingKind): Draft {
  const before = templateFor(draft.kind ? categoryForKind(draft.kind) : 'userscript');
  const after = templateFor(categoryForKind(kind));
  const text = { ...draft.text };
  for (const key of Object.keys(text) as ContentField[]) {
    if (draft.text[key] === before[key]) text[key] = after[key];
  }
  const keepTerminals = kindMeta(kind)?.terminals ? draft.terminals : [];
  return { ...draft, kind, text, terminals: keepTerminals };
}

/** "Any" clears the specific terminals and the other way round. */
export function toggleTerminal(current: string[], name: string): string[] {
  if (name === 'Any') return current.includes('Any') ? [] : ['Any'];
  const rest = current.filter((t) => t !== 'Any');
  return rest.includes(name) ? rest.filter((t) => t !== name) : [...rest, name];
}

export function toggleIn<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function lamportsOf(value: string): bigint | null {
  try {
    const trimmed = value.trim();
    if (!trimmed || !/^\d*(\.\d{0,9})?$/.test(trimmed)) return null;
    return solToLamports(trimmed);
  } catch {
    return null;
  }
}

/** First problem that blocks leaving a step, or null. */
export function stepProblem(
  draft: Draft,
  step: number,
  extra: { file?: File | null } = {},
): string | null {
  if (step === 1) return draft.kind ? null : 'Pick what you are selling.';
  const kind = draft.kind;
  if (!kind) return 'Pick what you are selling.';
  if (step === 2) {
    const meta = kindMeta(kind)!;
    if (meta.terminals && !draft.terminals.length)
      return 'Pick at least one terminal, or Any site.';
    const specs = draft.specs[kind] as Record<string, unknown>;
    if (
      kind === 'script' &&
      (specs.network as string) === 'hosts' &&
      !(specs.hosts as string[]).length
    )
      return 'List every host the script calls.';
    const parsed = parseSpecs(kind, specs);
    return parsed.ok ? null : specMessage(parsed.error);
  }
  if (step === 3) {
    if (draft.title.trim().length < 3) return 'Add a title (3 characters or more).';
    if (draft.summary.trim().length < 3) return 'Add a one-line summary.';
    if (!draft.description.trim()) return 'Describe exactly what it does.';
    return null;
  }
  if (step === 5) {
    const price = lamportsOf(draft.price);
    if (price === null || price <= 0n) return 'Set a price in SOL.';
    if (draft.updatesOn && draft.updatePrice !== null && lamportsOf(draft.updatePrice) === null)
      return 'Set the monthly update price in SOL.';
    return null;
  }
  if (step === 6) return extra.file ? null : 'Add the file buyers download.';
  return null;
}

function specMessage(error: string): string {
  const [path, message] = error.split(': ');
  const nice: Record<string, string> = {
    bots: 'Pick the bot this config is for.',
    formats: 'Pick at least one file format.',
    walletCount: 'Wallet count must be between 1 and 100,000.',
    what: 'Say in a few words what it is.',
  };
  const key = path?.split('.')[0] ?? '';
  return nice[key] ?? message ?? error;
}

/** Number of [bracketed] template parts still left in the guide. */
export function placeholdersLeft(text: Record<ContentField, string>): number {
  return Object.values(text).reduce(
    (n, value) => n + (value.match(/\[[^\]\n]{2,80}\]/g)?.length ?? 0),
    0,
  );
}

/** Median of real prices, or null with fewer than three to compare. */
export function medianLamports(prices: readonly (string | bigint)[]): bigint | null {
  if (prices.length < 3) return null;
  const sorted = prices.map((p) => BigInt(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

export type ScriptHeader = { name: string | null; matches: string[]; grants: string[] };

/** Reads a userscript's metadata block in the browser, as a pre-check before upload. */
export function readUserscriptHeader(source: string): ScriptHeader | null {
  const block = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(source);
  if (!block) return null;
  const values = (key: string) =>
    [...block[1]!.matchAll(new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, 'gm'))].map((m) => m[1]!);
  return {
    name: values('name')[0] ?? null,
    matches: [...values('match'), ...values('include')],
    grants: values('grant'),
  };
}

/** Hosts a userscript's @match lines cover. */
export function matchHosts(matches: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const match of matches) {
    const host = /^[a-z*]+:\/\/([^/]+)/i.exec(match)?.[1];
    if (host) hosts.add(host.replace(/^\*\./, '').toLowerCase());
  }
  return [...hosts];
}

/** Terminals picked in step 2 that none of the @match lines cover. */
export function uncoveredTerminals(
  terminals: readonly string[],
  matches: readonly string[],
): string[] {
  const hosts = matchHosts(matches);
  if (hosts.includes('*')) return [];
  return terminals.filter((name) => {
    const tile = TERMINAL_TILES.find((t) => t.name === name);
    if (!tile) return false;
    const base = tile.host.split('.').slice(-2).join('.');
    return !hosts.some((h) => h === tile.host || h.endsWith(`.${base}`) || h === base);
  });
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Body for POST /studio/listings. */
export function listingRequest(draft: Draft, updatePriceSol: string) {
  const kind = draft.kind!;
  return {
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    description: draft.description.trim(),
    category: categoryForKind(kind),
    kind,
    specs: draft.specs[kind],
    terminals: draft.terminals,
    priceLamports: solToLamports(draft.price.trim()).toString(),
    updatePriceLamports: draft.updatesOn ? solToLamports(updatePriceSol || '0').toString() : '0',
  };
}
