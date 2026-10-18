/** CI assertions after the seller and buyer agents ran against the local stack. */
import assert from 'node:assert/strict';
import { keypairSigner, TrenchmartClient } from '@trenchmart/sdk';
import { loadKeypair } from '../common';

const dir = process.argv[2];
if (!dir) throw new Error('usage: check.ts <dir>');
const client = new TrenchmartClient({ baseUrl: process.env.TM_API_URL ?? 'http://127.0.0.1:8787' });
const creator = keypairSigner(loadKeypair(`${dir}/creator.json`).secretKey);
const buyer = loadKeypair(`${dir}/buyer.json`).publicKey.toBase58();
await client.createApiKey(creator, { name: 'ci check', scopes: ['read', 'sell'] });

const { sales } = await client.sales();
const sale = sales.find((s) => s.buyer === buyer);
assert.ok(sale, 'the buyer agent purchase is in the creator sales');
assert.equal(sale.status, 'released', 'escrow released after the window');
assert.ok(sale.tx_sig, 'sale carries the on-chain signature');

const { reviews } = await client.creatorReviews();
const review = reviews.find((r) => r.reviewer === buyer);
assert.ok(review, 'the buyer agent review is visible to the creator');
assert.equal(review.rating, 5);
assert.ok(review.reply, 'the seller agent replied to the review');

const listing = await client.listing(sale.slug);
assert.equal(listing.ratingCount, 1);
const subs = await client.subscribers();
assert.ok(subs.subscribers.some((s) => s.buyer === buyer), 'buyer receives updates');
await client.revokeKey();
console.log(JSON.stringify({ ok: true, sale: sale.id, review: review.id, slug: sale.slug }));
