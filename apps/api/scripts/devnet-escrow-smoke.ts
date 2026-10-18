// Devnet smoke test of the escrow v2 flow against the live API: checkout into the buyer-keyed
// PDA, dispute frozen on chain by the resolver (no buyer signature), optional admin refund.
// Usage: pnpm --filter @trenchmart/api exec tsx scripts/devnet-escrow-smoke.ts <buyer-keypair.json> <listing-slug> [admin-keypair.json]
// Devnet only (the API refuses mainnet). Never prints keys.
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { decodeEscrow, escrowAddress, fromBase64, signTx, toBase64 } from '@trenchmart/chain';

const API = process.env.API ?? 'https://api.trenchmart.fun/api/v1';
const RPC = process.env.RPC ?? 'https://solana-devnet.api.onfinality.io/public';
const PROGRAM = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
const load = (f: string) => Uint8Array.from(JSON.parse(readFileSync(f, 'utf8')) as number[]);

async function login(secret: Uint8Array) {
  const wallet = bs58.encode(secret.subarray(32));
  const n = (await (
    await fetch(`${API}/auth/nonce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet }),
    })
  ).json()) as { message: string };
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), secret));
  const v = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, signature }),
  });
  if (v.status !== 200) throw new Error(`login ${v.status} ${await v.text()}`);
  return { wallet, cookie: (v.headers.get('set-cookie') ?? '').split(';')[0]! };
}

async function call(cookie: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  return JSON.parse(text) as Record<string, any>;
}

async function account(address: string) {
  const r = (await (
    await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [address, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    })
  ).json()) as { result: { value: { data: [string]; owner: string } | null } };
  return r.result.value;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const [buyerFile, slug, adminFile] = process.argv.slice(2);
const buyerKey = load(buyerFile!);
const buyer = await login(buyerKey);
const listing = await call(buyer.cookie, `/listings/${slug}`);
const order = await call(buyer.cookie, '/orders', { listingId: listing.id });
const expected = escrowAddress(order.orderId, PROGRAM, buyer.wallet);
console.log(
  'order',
  order.orderId,
  'escrow',
  order.escrow,
  'v2 PDA match',
  order.escrow === expected,
);
const signed = signTx(fromBase64(order.txBase64), [buyerKey]);
const { signature } = await call(buyer.cookie, '/tx/send', { txBase64: toBase64(signed) });
console.log('checkout sig', signature);
for (let i = 0; i < 20; i += 1) {
  try {
    await call(buyer.cookie, `/orders/${order.orderId}/submitted`, { txSig: signature });
    break;
  } catch (e) {
    if (i === 19) throw e;
    await sleep(3000);
  }
}
let info = await account(order.escrow);
console.log(
  'escrow owner',
  info?.owner,
  'status',
  info && decodeEscrow(Buffer.from(info.data[0], 'base64')).status,
);
const dispute = await call(buyer.cookie, `/orders/${order.orderId}/dispute`, {
  reason: 'other',
  details: 'Devnet smoke test of the resolver freeze (escrow v2).',
});
console.log('dispute', dispute.disputeId, 'buyer tx needed:', dispute.txBase64 !== null);
info = await account(order.escrow);
console.log(
  'escrow status after dispute',
  info && decodeEscrow(Buffer.from(info.data[0], 'base64')).status,
);
if (adminFile) {
  const admin = await login(load(adminFile));
  await call(admin.cookie, `/admin/disputes/${dispute.disputeId}/resolve`, {
    status: 'upheld',
    resolution: 'devnet smoke test refund',
  });
  info = await account(order.escrow);
  console.log(
    'escrow status after resolve',
    info && decodeEscrow(Buffer.from(info.data[0], 'base64')).status,
  );
  const o = await call(buyer.cookie, `/orders/${order.orderId}`);
  console.log(
    'order status',
    o.status ?? o.order?.status,
    'refund_sig',
    o.refund_sig ?? o.order?.refund_sig ?? '(see DB)',
  );
}
