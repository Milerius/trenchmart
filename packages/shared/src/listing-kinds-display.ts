import type { CategoryCode } from './config';

/**
 * What a seller picks on step 1 of the new-listing wizard. Each kind maps onto one market
 * category (what buyers browse) and carries its own structured specs, shown on the listing.
 */
export const LISTING_KIND_CODES = [
  'script',
  'bot',
  'wallet',
  'filter',
  'indicator',
  'telegram',
  'other',
] as const;
export type ListingKind = (typeof LISTING_KIND_CODES)[number];

export type ListingKindMeta = {
  code: ListingKind;
  label: string;
  blurb: string;
  examples: string;
  files: string;
  category: CategoryCode;
  /** Title of wizard step 2 for this kind. */
  specificsLabel: string;
  /** Whether step 2 asks for terminals (stored in listings.terminals for market filters). */
  terminals: 'run' | 'import' | 'paste' | null;
};

export const LISTING_KINDS: readonly ListingKindMeta[] = [
  {
    code: 'script',
    label: 'Terminal script',
    blurb: 'A userscript that adds overlays, buttons or alerts to a trading terminal.',
    examples: 'bundle checker · PnL overlay · hotkeys',
    files: '.user.js',
    category: 'userscript',
    specificsLabel: 'Terminals',
    terminals: 'run',
  },
  {
    code: 'bot',
    label: 'Trading bot config',
    blurb: 'Presets for a sniper or copy bot: slippage, fees, TP/SL ladders.',
    examples: 'Trojan · BonkBot · Maestro',
    files: '.json · .txt',
    category: 'setup',
    specificsLabel: 'Bot',
    terminals: null,
  },
  {
    code: 'wallet',
    label: 'Wallet tracker list',
    blurb: 'Labelled wallets to import into a tracker or terminal watchlist.',
    examples: 'smart money · KOLs · insiders',
    files: '.txt · .json · .csv',
    category: 'wallet_list',
    specificsLabel: 'List details',
    terminals: 'import',
  },
  {
    code: 'filter',
    label: 'Filter / preset pack',
    blurb: 'Scanner and pair filters you paste into a terminal’s settings.',
    examples: 'new pairs · migrations · rug filters',
    files: '.json',
    category: 'filter',
    specificsLabel: 'Terminals',
    terminals: 'paste',
  },
  {
    code: 'indicator',
    label: 'Indicator',
    blurb: 'TradingView Pine scripts and chart templates with a setup guide.',
    examples: 'volume profile · VWAP bands',
    files: '.pine · .txt',
    category: 'strategy',
    specificsLabel: 'Platform',
    terminals: null,
  },
  {
    code: 'telegram',
    label: 'Telegram bot',
    blurb: 'A self-hosted alert or call bot with its config and deploy guide.',
    examples: 'dev-wallet alerts · call feed',
    files: '.zip',
    category: 'alerts',
    specificsLabel: 'Bot setup',
    terminals: null,
  },
  {
    code: 'other',
    label: 'Something else',
    blurb: 'Layouts, playbooks, bundles. Say what it is and the review picks the checks.',
    examples: 'full setups · strategy docs',
    files: '.zip · .pdf',
    category: 'setup',
    specificsLabel: 'What it is',
    terminals: null,
  },
];

export function kindMeta(code: string | null | undefined): ListingKindMeta | null {
  return LISTING_KINDS.find((kind) => kind.code === code) ?? null;
}

export const SCRIPT_MANAGERS = [
  'Tampermonkey',
  'Violentmonkey',
  'Greasemonkey',
  'ScriptCat',
] as const;
export const BROWSERS = ['Chrome', 'Brave', 'Edge', 'Firefox', 'Safari'] as const;
export const BOTS = [
  'Trojan',
  'BonkBot',
  'Maestro',
  'Banana Gun',
  'Photon',
  'GMGN',
  'Other',
] as const;
export const BOT_SETTINGS = [
  'Slippage',
  'Priority fees',
  'TP/SL ladder',
  'Anti-MEV',
  'Copy-trade targets',
  'Auto-buy filters',
] as const;
export const WALLET_FORMATS = ['csv', 'json'] as const;
export const CADENCES = ['oneoff', 'daily', 'weekly', 'monthly'] as const;
export const CADENCE_LABEL: Record<(typeof CADENCES)[number], string> = {
  oneoff: 'One-off',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
export const WALLET_COLUMNS = [
  'address',
  'label',
  'tags',
  '30d PnL',
  'win rate',
  'last active',
  'avg hold',
  'first-buy timing',
] as const;
export const FILTER_TYPES = [
  'New pairs',
  'Migrations',
  'Rug filters',
  'Volume',
  'Holders',
  'Dev wallet',
] as const;
export const INDICATOR_PLATFORMS = ['TradingView', 'Terminal chart', 'Other'] as const;
export const INDICATOR_LANGUAGES = ['Pine Script', 'Chart template', 'Other'] as const;
export const BOT_RUNTIMES = ['Node.js', 'Python', 'Docker'] as const;
export const TELEGRAM_FEATURES = [
  'Dev-wallet alerts',
  'Call feed',
  'Buy alerts',
  'KOL tracking',
  'Migration alerts',
] as const;

/** Verified wallet count of a wallet list version, counted from its file by the scan. */
export type WalletCount = {
  /** Unique valid Solana addresses in the file. */
  count: number;
  versionId: string;
  semver: string;
  source: 'file';
  facts: {
    format: 'standard' | 'json' | 'csv' | 'txt';
    rows: number;
    duplicates: number;
    invalid: number;
    named?: number;
    alertTypes?: string[];
  } | null;
};

/** "767 wallets, counted from the file". */
export function walletCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} wallet${count === 1 ? '' : 's'}, counted from the file`;
}

/** Category a kind lists under. A kind is only valid with its own category. */
export function categoryForKind(kind: ListingKind): CategoryCode {
  return kindMeta(kind)!.category;
}

const list = (values: readonly string[] | undefined) => (values?.length ? values.join(', ') : null);
const STORAGE: Record<string, string> = {
  none: 'Saves nothing',
  local: 'Settings in your browser',
  remote: 'Settings on a remote server',
};
const NETWORK: Record<string, string> = {
  none: 'No network requests',
  terminal: 'Calls the terminal’s own API only',
  hosts: 'Calls listed hosts',
};

/** "Spec buyers see": label/value rows for a listing, skipping empty answers. */
export function specRows(
  kind: string | null | undefined,
  specs: unknown,
  terminals: readonly string[] = [],
  /** Wallet lists: the count the scan took from the live version's file. */
  walletCount: number | null = null,
): [string, string][] {
  const meta = kindMeta(kind);
  if (!meta || !specs || typeof specs !== 'object') return [];
  const s = specs as Record<string, any>;
  const rows: [string, string | null][] = [];
  const terms = list(terminals);
  if (meta.code === 'script') {
    rows.push(['Runs on', terms]);
    rows.push(['Script managers', list(s.managers)]);
    rows.push(['Browsers', list(s.browsers)]);
    rows.push(['Reads the page', s.readsPage ? 'Yes' : 'No']);
    rows.push([
      'Network',
      s.network === 'hosts' && s.hosts?.length
        ? `${NETWORK.hosts}: ${s.hosts.join(', ')}`
        : (NETWORK[s.network] ?? null),
    ]);
    rows.push(['Trade buttons', s.tradeButtons ? 'Opens the terminal’s own form' : 'No']);
    rows.push(['Storage', STORAGE[s.storage] ?? null]);
    rows.push(['Keys and signing', 'Never']);
  } else if (meta.code === 'bot') {
    rows.push(['Bots', list(s.bots)]);
    rows.push(['Settings included', list(s.settings)]);
  } else if (meta.code === 'wallet') {
    rows.push(['Chain', 'Solana']);
    // Only the scan's count is shown; a seller-typed number (older listings) never is.
    rows.push(['Wallets', typeof walletCount === 'number' ? walletCountLabel(walletCount) : null]);
    rows.push(['Formats', list((s.formats as string[] | undefined)?.map((f) => f.toUpperCase()))]);
    rows.push(['Refresh', CADENCE_LABEL[s.cadence as keyof typeof CADENCE_LABEL] ?? null]);
    rows.push(['Imports into', terms]);
    rows.push(['Columns', list(s.columns)]);
  } else if (meta.code === 'filter') {
    rows.push(['Terminals', terms]);
    rows.push(['Filters', list(s.filterTypes)]);
  } else if (meta.code === 'indicator') {
    rows.push(['Platform', s.platform ?? null]);
    rows.push(['Format', s.language ?? null]);
  } else if (meta.code === 'telegram') {
    rows.push(['Runtime', s.runtime ?? null]);
    rows.push(['Hosting', 'Self-hosted']);
    rows.push(['Features', list(s.features)]);
  } else {
    rows.push(['What it is', s.what ?? null]);
  }
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}
