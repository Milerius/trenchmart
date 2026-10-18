/* global Buffer, URL, console */
// Builds packages/scanner/src/__fixtures__/wallet-tracker-standard.json: an anonymized copy of
// the wallet-tracker export format (767 entries, the same shape and field mix as a real export).
// Addresses, names, ids and amounts are synthetic and deterministic; no real wallet data.
// Run: node scripts/wallet-fixture.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import bs58 from 'bs58';

const digest = (seed) => createHash('sha256').update(seed).digest();
const address = (seed) => bs58.encode(digest(`wallet:${seed}`));
const uuid = (seed) => {
  const h = digest(`uuid:${seed}`).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const EMOJI = ['🐋', '🧠', '🎯', '🔥', '👀'];
const group = uuid('group');
const N = 767;
const list = [];
for (let i = 0; i < N; i++) {
  const addr = address(i);
  const n = digest(`n:${i}`)[0];
  const off = i % 2 === 0 && i < 4 ? 1 : 0; // two entries with alerts off, like the real export
  const created = new Date(Date.UTC(2026, 2, 1) + i * 3_600_000).toISOString();
  const entry = {
    chain: 'solana',
    address: addr,
    name: `Wallet ${i + 1}`,
    isAlertEnabled: !off,
    alertSubscriptions: off ? [] : ['buy', 'sell', 'transfer', 'poolCreate'],
    soundName: 'alert',
    isMarkerEnabled: true,
    isToastEnabled: true,
    groupIds: n % 3 === 0 ? [] : [group],
    createdAt: created,
    updatedAt: created,
    fundingInfo: {
      walletAddress: addr,
      // About one in eleven was funded by another wallet of the list (also true of real lists).
      firstNativeFunderAddress: i % 11 === 5 ? address(i - 1) : address(`funder:${i}`),
      firstNativeFundingAmount: Number(((n + 1) / 25).toFixed(4)),
      firstNativeFundingTxHash: bs58.encode(Buffer.concat([digest(`tx:${i}`), digest(`tx2:${i}`)])),
      firstNativeIncomingTimestamp: 1_760_000_000 + i * 977,
      nativeBalance: Number((n / 7).toFixed(6)),
      numTokensCreated: n % 5,
      numTokensMigrated: n % 2,
    },
  };
  if (n % 4 !== 0) entry.emoji = EMOJI[n % EMOJI.length];
  list.push(entry);
}
writeFileSync(
  new URL('../packages/scanner/src/__fixtures__/wallet-tracker-standard.json', import.meta.url),
  // One entry per line keeps the fixture small and diffable.
  '[\n' + list.map((entry) => '  ' + JSON.stringify(entry)).join(',\n') + '\n]\n',
);
console.log(`wrote ${list.length} entries`);
