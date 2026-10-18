// Devnet live smoke of PR #40: creator uploads a new version, buyer renews updates,
// upload supplement, /verify supplement. Usage: tsx scripts/devnet-versioning-smoke.ts <phase> <keypair> [args]
// Never prints keys. Devnet only.
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { fromBase64, signTx, toBase64 } from '@trenchmart/chain';

const API = process.env.API ?? 'https://api.trenchmart.fun/api/v1';
const load = (f: string) => Uint8Array.from(JSON.parse(readFileSync(f, 'utf8')) as number[]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
let cookie = '';
async function call(path: string, body?: unknown, method?: string) {
  const res = await fetch(`${API}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  return JSON.parse(text) as Record<string, any>;
}
let key: Uint8Array = new Uint8Array();
async function pay(txBase64: string) {
  const signed = signTx(fromBase64(txBase64), [key]);
  const { signature } = await call('/tx/send', { txBase64: toBase64(signed) });
  await sleep(12000);
  return signature as string;
}
async function retry<T>(f: () => Promise<T>) {
  for (let i = 0; ; i += 1) {
    try {
      return await f();
    } catch (e) {
      if (i >= 6) throw e;
      console.log('retry', String(e).slice(0, 160));
      await sleep(5000);
    }
  }
}

const [phase, file, ...args] = process.argv.slice(2);
key = load(file!);
const me = await login(key);
cookie = me.cookie;
console.log('wallet', me.wallet);

if (phase === 'quota') {
  const q = await call(`/studio/listings/${args[0]}/upload-quota`);
  console.log(
    JSON.stringify({
      updatesToday: q.updatesToday,
      uploadsToday: q.uploadsToday,
      limits: q.limits,
      reasons: q.reasons,
      supplementRequired: q.supplementRequired,
      supplementLamports: q.supplementLamports,
      verificationFee: q.verificationFee,
      feeWaived: q.feeWaived,
      versions: q.versions?.slice(0, 3),
    }),
  );
}
if (phase === 'version') {
  const [listingId, semver, source, accept] = args;
  const content = Buffer.from(
    readFileSync(source!, 'utf8').replace(/(\/\/ @version\s+)\S+/, `$1${semver}`),
  );
  const v = await call(`/studio/listings/${listingId}/versions`, {
    semver,
    changelog: `Devnet smoke ${semver}: copycat labels refresh.`,
    fileName: 'trojan-trenches-intel.user.js',
    fileSize: content.length,
    ...(accept ? { acceptSupplementLamports: accept } : {}),
  });
  console.log(
    'version',
    v.versionId,
    'fee',
    v.verificationFee,
    'supplement',
    v.supplement ? `${v.supplement.id} ${v.supplement.lamports} ${v.supplement.reasons}` : null,
  );
  const put = await fetch(
    new URL(v.uploadUrl, API).toString().replace('/api/v1/api/v1', '/api/v1'),
    { method: 'PUT', headers: { cookie }, body: content },
  );
  console.log('upload', put.status);
  if (v.feeTx) {
    const sig = await pay(v.feeTx.txBase64);
    console.log('vfee sig', sig);
    await retry(() => call(`/studio/versions/${v.versionId}/fee`, { txSig: sig }));
  }
  if (v.supplement?.tx) {
    const sig = await pay(v.supplement.tx.txBase64);
    console.log('upload supplement sig', sig);
    await retry(() => call(`/supplements/${v.supplement.id}/submitted`, { txSig: sig }));
  }
  const done = await call(`/studio/versions/${v.versionId}/complete`, {});
  console.log(
    'complete',
    JSON.stringify({
      status: done.status,
      sha256: done.sha256,
      review: done.review?.step ?? done.review,
    }),
  );
}
if (phase === 'buy') {
  const listing = await call(`/listings/${args[0]}`);
  const order = await call('/orders', { listingId: listing.id });
  const sig = await pay(order.txBase64);
  console.log('order', order.orderId, 'checkout sig', sig);
  for (let i = 0; i < 12; i += 1) {
    const o = await call(`/orders/${order.orderId}`).catch(() => null);
    console.log('status', o?.status ?? o?.order?.status);
    if (['paid', 'released'].includes(o?.status ?? o?.order?.status)) break;
    await sleep(5000);
  }
}
if (phase === 'renew') {
  const q = await call(`/orders/${args[0]}/updates/quote`, {});
  console.log('quote', JSON.stringify(q));
  const r = await call(`/orders/${args[0]}/updates/renew`, {});
  const sig = await pay(r.txBase64);
  console.log('renewal', r.renewalId, 'sig', sig);
  const s = await retry(() =>
    call(`/orders/${args[0]}/updates/${r.renewalId}/submitted`, { txSig: sig }),
  );
  console.log('settled', JSON.stringify(s));
}
if (phase === 'verify') {
  const content = readFileSync(args[0]!);
  const q0 = await call('/verify/quota');
  console.log('quota', JSON.stringify(q0));
  const v1 = await call('/verify', {
    fileName: 'trojan-trenches-intel.user.js',
    contentBase64: content.toString('base64'),
  }).catch((e) => String(e).slice(0, 200));
  console.log(
    'verify (free?)',
    typeof v1 === 'string' ? v1 : JSON.stringify({ free: v1.free, match: v1.match ?? v1.status }),
  );
  const s = await call('/verify/supplement', {});
  const sig = await pay(s.txBase64);
  console.log('verify supplement', s.supplementId, s.lamports, 'sig', sig);
  await retry(() => call(`/supplements/${s.supplementId}/submitted`, { txSig: sig }));
  const v2 = await call('/verify', {
    fileName: 'trojan-trenches-intel.user.js',
    contentBase64: content.toString('base64'),
    supplementId: s.supplementId,
  });
  console.log('verify (paid)', JSON.stringify(v2).slice(0, 400));
}
if (phase === 'explain') {
  const r = await call(`/studio/versions/${args[0]}/explain`, { note: args[1] });
  console.log('explain', JSON.stringify(r));
}
if (phase === 'docs') {
  const c = await call(`/studio/listings/${args[0]}/content`);
  const draft = c.draft;
  const before = JSON.stringify(draft);
  const after = before.replace(
    'version **1.4.0**',
    'the version shown under **Versions** on this page',
  );
  console.log('changed', before !== after, Object.keys(draft));
  await call(`/studio/listings/${args[0]}/content`, JSON.parse(after), 'PUT');
  const r = await call(`/studio/listings/${args[0]}/content/review`, {});
  console.log('content review', JSON.stringify(r).slice(0, 400));
}
