import bs58 from 'bs58';

/**
 * Wallet-list parser for the wallet tracker listing type. The scan counts the wallets in the
 * uploaded file, so the count buyers see is verified rather than typed in by the seller.
 *
 * Formats, tried in this order:
 * - `standard`: the wallet-tracker export (a JSON array of `{ chain, address, name, emoji,
 *   alertSubscriptions, groupIds, fundingInfo, ... }`). Only top-level `address` values with
 *   `chain: "solana"` count; addresses inside `fundingInfo` never do.
 * - `json`: an array of address strings or `{ address | wallet | walletAddress | pubkey }`
 *   objects, `{ "wallets": [...] }`, or an object keyed by address (`{ "<addr>": "label" }`).
 * - `csv`: a header row with an `address` (or `wallet`) column; `,` `;` or tab separated.
 * - `txt`: one address per line. Blank lines and `#` or `//` comments are skipped; text after
 *   the address on the same line (a label) is ignored.
 */
export type WalletListFormat = 'standard' | 'json' | 'csv' | 'txt';

export type WalletListParse = {
  format: WalletListFormat;
  /** Entries that should hold a Solana address (other chains are not counted here). */
  rows: number;
  /** Unique valid Solana addresses: the verified wallet count. */
  count: number;
  duplicates: number;
  /** Entries whose value is not a valid Solana address. */
  invalid: number;
  /** The first few invalid values, cut short, for the scan detail. */
  invalidSamples: string[];
  /** Entries tagged with another chain (standard / json objects with `chain`). */
  otherChains: number;
  /** Unique valid addresses, in file order. Not stored: used for the program-id check. */
  addresses: string[];
  /** Standard format only: wallets with a non-empty name. */
  named?: number;
  /** Standard format only: alert types subscribed across the list, sorted. */
  alertTypes?: string[];
  /** Set when the file is not a wallet list at all (bad JSON, CSV without an address column). */
  error?: string;
};

/** What a version stores and the API returns: counts only, never the addresses. */
export type WalletListFacts = {
  format: WalletListFormat;
  rows: number;
  duplicates: number;
  invalid: number;
  named?: number;
  alertTypes?: string[];
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ADDRESS_KEYS = ['address', 'wallet', 'walletAddress', 'wallet_address', 'pubkey'] as const;
const CSV_COLUMNS = new Set(['address', 'wallet', 'walletaddress', 'wallet_address', 'pubkey']);

/** Base58, 32 to 44 characters, decoding to exactly 32 bytes. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE58.test(value)) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

class Tally {
  rows = 0;
  invalid = 0;
  otherChains = 0;
  invalidSamples: string[] = [];
  private seen = new Set<string>();
  addresses: string[] = [];

  add(raw: unknown) {
    this.rows += 1;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!isSolanaAddress(value)) {
      this.invalid += 1;
      if (this.invalidSamples.length < 3) {
        const shown = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw ?? null);
        this.invalidSamples.push((shown ?? '').slice(0, 48));
      }
      return;
    }
    if (this.seen.has(value)) return;
    this.seen.add(value);
    this.addresses.push(value);
  }

  done(format: WalletListFormat, extra: Partial<WalletListParse> = {}): WalletListParse {
    const valid = this.rows - this.invalid;
    return {
      format,
      rows: this.rows,
      count: this.addresses.length,
      duplicates: valid - this.addresses.length,
      invalid: this.invalid,
      invalidSamples: this.invalidSamples,
      otherChains: this.otherChains,
      addresses: this.addresses,
      ...extra,
    };
  }
}

const empty = (format: WalletListFormat, error: string): WalletListParse => ({
  ...new Tally().done(format),
  error,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addressOf(item: Record<string, unknown>): unknown {
  for (const key of ADDRESS_KEYS) if (key in item) return item[key];
  return undefined;
}

function isStandardEntry(item: unknown): boolean {
  return isRecord(item) && typeof item.chain === 'string' && 'address' in item;
}

function parseJson(json: unknown): WalletListParse {
  let list: unknown[];
  if (Array.isArray(json)) list = json;
  else if (isRecord(json) && Array.isArray(json.wallets)) list = json.wallets;
  else if (isRecord(json) && Object.keys(json).length && Object.keys(json).every(isSolanaAddress)) {
    const tally = new Tally();
    for (const key of Object.keys(json)) tally.add(key);
    return tally.done('json');
  } else return empty('json', 'JSON wallet lists must be an array.');

  const standard = list.length > 0 && list.every(isStandardEntry);
  const tally = new Tally();
  let named = 0;
  const alerts = new Set<string>();
  for (const item of list) {
    if (typeof item === 'string') {
      tally.add(item);
      continue;
    }
    if (!isRecord(item)) {
      tally.add(item);
      continue;
    }
    if (typeof item.chain === 'string' && item.chain.trim().toLowerCase() !== 'solana') {
      tally.otherChains += 1;
      continue;
    }
    // Only the entry's own address counts: fundingInfo.walletAddress and the funder are not
    // wallets of the list.
    const before = tally.addresses.length;
    tally.add(addressOf(item));
    if (standard && tally.addresses.length > before) {
      if (typeof item.name === 'string' && item.name.trim()) named += 1;
      if (Array.isArray(item.alertSubscriptions))
        for (const kind of item.alertSubscriptions)
          if (typeof kind === 'string' && /^[A-Za-z][\w-]{0,31}$/.test(kind)) alerts.add(kind);
    }
  }
  return standard
    ? tally.done('standard', { named, alertTypes: [...alerts].sort() })
    : tally.done('json');
}

function splitRow(line: string, sep: string): string[] {
  return line.split(sep).map((cell) =>
    cell
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim(),
  );
}

function separatorOf(line: string): string | null {
  for (const sep of [',', ';', '\t']) if (line.includes(sep)) return sep;
  return null;
}

/** Parses a wallet list file and counts its unique valid Solana addresses. */
export function parseWalletList(text: string, fileName = ''): WalletListParse {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return empty('json', 'Invalid JSON.');
    }
    return parseJson(json);
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'));
  const first = lines[0] ?? '';
  const sep = separatorOf(first);
  const header = sep ? splitRow(first, sep).map((cell) => cell.toLowerCase()) : [];
  const column = header.findIndex((cell) => CSV_COLUMNS.has(cell));
  const isCsv = fileName.toLowerCase().endsWith('.csv');
  if (column >= 0 && sep) {
    const tally = new Tally();
    for (const line of lines.slice(1)) tally.add(splitRow(line, sep)[column] ?? '');
    return tally.done('csv');
  }
  if (isCsv && sep && !isSolanaAddress(splitRow(first, sep)[0])) {
    return empty('csv', 'CSV needs an address column.');
  }
  // One address per line; a label after the address (space, comma, tab) is ignored.
  const tally = new Tally();
  for (const line of lines) tally.add(line.split(/[\s,;]+/)[0] ?? '');
  return tally.done(isCsv ? 'csv' : 'txt');
}

/** The stored, public part of a parse. */
export function walletListFacts(parse: WalletListParse): WalletListFacts {
  const facts: WalletListFacts = {
    format: parse.format,
    rows: parse.rows,
    duplicates: parse.duplicates,
    invalid: parse.invalid,
  };
  if (parse.named !== undefined) facts.named = parse.named;
  if (parse.alertTypes !== undefined) facts.alertTypes = parse.alertTypes;
  return facts;
}
