import { existsSync, readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { scan } from './scan';
import { isSolanaAddress, parseWalletList, walletListFacts } from './wallets';

const addr = (seed: number) =>
  bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seed) % 256));
const A = addr(1);
const B = addr(2);
const C = addr(3);
const fixture = readFileSync(
  new URL('./__fixtures__/wallet-tracker-standard.json', import.meta.url),
  'utf8',
);

describe('isSolanaAddress', () => {
  it('accepts 32-byte base58 and the 32-char system program', () => {
    expect(isSolanaAddress(A)).toBe(true);
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
  });
  it('rejects bad alphabet, wrong length and wrong decoded size', () => {
    expect(isSolanaAddress(`${A.slice(0, -1)}0`)).toBe(false); // '0' is not base58
    expect(isSolanaAddress(`${A.slice(0, -1)}l`)).toBe(false); // 'l' is not base58
    expect(isSolanaAddress('abc')).toBe(false);
    expect(isSolanaAddress(`${A}${A}`)).toBe(false); // over 44 chars
    expect(isSolanaAddress(bs58.encode(new Uint8Array(31).fill(9)))).toBe(false); // 31 bytes
    expect(isSolanaAddress('0x52908400098527886E0F7030069857D2E4169EE7')).toBe(false); // EVM
    expect(isSolanaAddress(42)).toBe(false);
  });
});

describe('parseWalletList: the wallet-tracker standard export', () => {
  it('counts the 767 top-level solana addresses of the export', () => {
    const out = parseWalletList(fixture, 'wallets.txt');
    expect(out.format).toBe('standard');
    expect(out.count).toBe(767);
    expect(out.rows).toBe(767);
    expect(out.invalid).toBe(0);
    expect(out.duplicates).toBe(0);
    expect(out.named).toBe(767);
    expect(out.alertTypes).toEqual(['buy', 'poolCreate', 'sell', 'transfer']);
  });

  it('never counts fundingInfo addresses', () => {
    const list = JSON.parse(fixture) as { fundingInfo: { firstNativeFunderAddress: string } }[];
    const funders = new Set(list.map((entry) => entry.fundingInfo.firstNativeFunderAddress));
    expect(funders.size).toBeGreaterThan(600);
    expect(parseWalletList(fixture, 'wallets.json').count).toBe(767);
  });

  it('skips other chains and dedupes repeated entries', () => {
    const list = JSON.parse(fixture) as Record<string, unknown>[];
    const extra = [
      list[0],
      list[1],
      { ...list[2], chain: 'ethereum', address: '0x52908400098527886E0F7030069857D2E4169EE7' },
    ];
    const out = parseWalletList(JSON.stringify([...list, ...extra]));
    expect(out.count).toBe(767);
    expect(out.duplicates).toBe(2);
    expect(out.otherChains).toBe(1);
    expect(out.invalid).toBe(0);
  });

  it('counts a solana entry with a bad address as invalid, not as a wallet', () => {
    const list = JSON.parse(fixture) as Record<string, unknown>[];
    const out = parseWalletList(
      JSON.stringify([...list.slice(0, 3), { ...list[3], address: 'nope' }]),
    );
    expect(out).toMatchObject({
      format: 'standard',
      count: 3,
      invalid: 1,
      invalidSamples: ['nope'],
    });
  });

  it.skipIf(!existsSync('/workspace/samples/wallet-list-standard.txt'))(
    'counts 767 in the real export kept outside the repo',
    () => {
      const text = readFileSync('/workspace/samples/wallet-list-standard.txt', 'utf8');
      expect(parseWalletList(text, 'wallet-list-standard.txt').count).toBe(767);
    },
  );
});

describe('parseWalletList: fallback formats', () => {
  it('JSON array of strings and of address objects', () => {
    expect(parseWalletList(JSON.stringify([A, B, A]))).toMatchObject({
      format: 'json',
      count: 2,
      duplicates: 1,
    });
    expect(
      parseWalletList(JSON.stringify([{ address: A, label: 'x' }, { wallet: B }, { pubkey: C }])),
    ).toMatchObject({ format: 'json', count: 3 });
  });

  it('JSON { wallets: [...] } and an object keyed by address', () => {
    expect(parseWalletList(JSON.stringify({ wallets: [A, B] })).count).toBe(2);
    expect(parseWalletList(JSON.stringify({ [A]: 'whale', [B]: 'kol' })).count).toBe(2);
  });

  it('rejects JSON that is not a wallet list', () => {
    expect(parseWalletList('{"a":1}').error).toMatch(/array/);
    expect(parseWalletList('[oops').error).toBe('Invalid JSON.');
  });

  it('CSV with an address column, any column order, quotes and ; separators', () => {
    const csv = `label,address,tags\nwhale,${A},smart\n"kol","${B}",x\ndup,${A},y\n`;
    expect(parseWalletList(csv, 'w.csv')).toMatchObject({ format: 'csv', count: 2, duplicates: 1 });
    expect(parseWalletList(`Wallet;Label\r\n${A};a\r\n${C};c\r\n`, 'w.csv').count).toBe(2);
  });

  it('CSV without an address column is an error', () => {
    expect(parseWalletList('name,label\nfoo,bar\n', 'w.csv').error).toMatch(/address column/);
  });

  it('TXT one per line with comments, blanks, labels and duplicates', () => {
    const txt = `# my list\n${A}\n\n${B} whale\n// note\n${A}\n${C},kol\n`;
    expect(parseWalletList(txt, 'w.txt')).toMatchObject({
      format: 'txt',
      count: 3,
      duplicates: 1,
      invalid: 0,
    });
  });

  it('TXT with invalid lines counts only valid addresses', () => {
    const txt = `${A}\nnot-a-wallet\n0x52908400098527886E0F7030069857D2E4169EE7\n${B}\n`;
    expect(parseWalletList(txt)).toMatchObject({ count: 2, invalid: 2, rows: 4 });
  });

  it('stored facts hold counts only, never addresses', () => {
    const facts = walletListFacts(parseWalletList(fixture));
    expect(JSON.stringify(facts)).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    expect(facts).toMatchObject({ format: 'standard', named: 767, rows: 767 });
  });
});

describe('wallet list scan', () => {
  const enc = (text: string) => new TextEncoder().encode(text);
  it('passes the standard export and reports the count', async () => {
    const out = await scan({ name: 'wallets.txt', bytes: enc(fixture) }, 'wallet_list');
    const schema = out.checks.find((c) => c.ruleId === 'wl-schema');
    expect(schema?.result).toBe('pass');
    expect(schema?.detail).toMatch(/767 unique Solana wallets counted from the file/);
    expect(out.wallets).toMatchObject({ count: 767, format: 'standard', named: 767 });
    expect(JSON.stringify(out.wallets)).not.toContain(JSON.parse(fixture)[0].address);
  });

  it('passes a plain TXT list and fails a file with no wallets', async () => {
    const txt = await scan({ name: 'w.txt', bytes: enc(`${A}\n${B}\n`) }, 'wallet_list');
    expect(txt.summary).not.toBe('fail');
    expect(txt.wallets?.count).toBe(2);
    const none = await scan({ name: 'w.txt', bytes: enc('# nothing\n') }, 'wallet_list');
    expect(none.checks.find((c) => c.ruleId === 'wl-schema')?.result).toBe('fail');
    expect(none.wallets?.count).toBe(0);
  });
});
