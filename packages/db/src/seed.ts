import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { scan } from '@trenchmart/scanner';
import { attestationMessage, runAiVerifier, signAttestation } from '@trenchmart/ai-verifier';
import { SAMPLE_LISTINGS, arrayBufferOf } from '@trenchmart/shared';
import type { Sql } from './client';

const SNIPER = `// ==UserScript==
// @name         Sniper Filter Pack v2
// @namespace    trenchmart
// @version      2.1.3
// @description  Scoped filters for new pairs. No wallet access.
// @match        https://axiom.trade/*
// @match        https://gmgn.ai/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  const preset = { terminal: 'Axiom', name: 'Sniper Filter Pack v2', devHolding: '<5%', top10: '<25%', migratedOnly: true };
  console.log(preset.name);
})();
`;

function pubkey(): string {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

function fakeSig(): string {
  return bs58.encode(nacl.randomBytes(64));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', arrayBufferOf(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type ListingSeed = {
  slug: string;
  title: string;
  creator: string;
  category: string;
  terminals: readonly string[];
  price: string;
  summary: string;
  rating: string;
  sales: number;
  fileName: string;
  bytes: Uint8Array;
  holderOnly?: boolean;
  holderOnlyHours?: number;
  featured?: boolean;
  extra?: { fileName: string; bytes: Uint8Array; semver: string };
};

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function samples(wallet: string): ListingSeed[] {
  const bySlug = Object.fromEntries(SAMPLE_LISTINGS.map((listing) => [listing.slug, listing]));
  const sniper = bySlug['sniper-filter-pack-v2'];
  const wallets = bySlug['120-early-wallets-q4'];
  const migration = bySlug['migration-sniper-presets'];
  const desk = bySlug['full-trench-desk-setup'];
  const bundle = bySlug['bundle-detector-overlay'];
  const playbook = bySlug['copy-trade-exit-playbook'];
  const kol = bySlug['kol-buy-alerts-config'];
  const tooltip = bySlug['dev-wallet-history-tooltip'];
  if (!sniper || !wallets || !migration || !desk || !bundle || !playbook || !kol || !tooltip) {
    throw new Error('sample catalogue is missing a listing');
  }
  const list = text(JSON.stringify([wallet, pubkey(), pubkey()]));
  const filter = text(
    JSON.stringify({
      terminal: 'Photon',
      name: 'Migration',
      migratedOnly: true,
      devHolding: '<4%',
    }),
  );
  const zip = zipSync({
    'README.md': strToU8('# Desk\n\nFilters and a short readme.\n'),
    'preset.json': strToU8(JSON.stringify({ terminal: 'Axiom', name: 'Desk', migratedOnly: true })),
  });
  const userscript = (name: string) =>
    text(
      SNIPER.replace('Sniper Filter Pack v2', name).replace(
        'Scoped filters for new pairs. No wallet access.',
        name,
      ),
    );
  const kolWarn = text(`// ==UserScript==
// @name         KOL Buy Alerts
// @match        https://padre.gg/*
// @grant        none
// ==/UserScript==
GM_xmlhttpRequest({ url: 'https://api.telegram.org/bot', method: 'POST' });
`);
  return [
    {
      ...meta(sniper),
      fileName: 'sniper.user.js',
      bytes: text(SNIPER),
      featured: true,
      creator: 'dev_degen',
    },
    {
      ...meta(tooltip),
      fileName: 'tooltip.user.js',
      bytes: userscript('Dev Wallet History Tooltip'),
      holderOnly: true,
      holderOnlyHours: 48,
      creator: 'dev_degen',
    },
    {
      ...meta(bundle),
      fileName: 'bundle.user.js',
      bytes: userscript('Bundle Detector Overlay'),
      creator: 'rugradar',
    },
    {
      ...meta(kol),
      fileName: 'kol.user.js',
      bytes: userscript('KOL Buy Alerts Config'),
      creator: 'rugradar',
      extra: { fileName: 'kol-warn.user.js', bytes: kolWarn, semver: '1.1.0' },
    },
    { ...meta(wallets), fileName: 'wallets.json', bytes: list, creator: 'onchainsleuth' },
    { ...meta(migration), fileName: 'migration.json', bytes: filter, creator: 'onchainsleuth' },
    { ...meta(desk), fileName: 'desk.zip', bytes: zip, creator: 'nightshift' },
    {
      ...meta(playbook),
      fileName: 'playbook.md',
      bytes: text('# Exit\n\nTake profit in thirds. No links.\n'),
      creator: 'nightshift',
    },
  ];
}

function meta(listing: (typeof SAMPLE_LISTINGS)[number]) {
  return {
    slug: listing.slug,
    title: listing.title,
    creator: listing.creator.replace('@', ''),
    category: listing.category,
    terminals: listing.terminals,
    price: listing.priceLamports,
    summary: listing.summary,
    rating: listing.rating,
    sales: listing.sales,
  };
}

async function reset(sql: Sql): Promise<void> {
  await sql`
    truncate table
      audit_log, ledger, notifications, downloads, listing_reviews, disputes, licenses, payouts,
      orders, scan_checks, scans, ai_reviews, sandbox_jobs, listing_media, versions, listings,
      bonds, token_balances, auth_nonces, reports, buybacks, rate_buckets, users
    restart identity cascade
  `;
}

export async function seed(sql: Sql, blobDir: string, attestSecret: string): Promise<void> {
  await reset(sql);
  const creators = ['dev_degen', 'rugradar', 'onchainsleuth', 'nightshift'];
  const ids = new Map<string, { id: string; wallet: string }>();
  for (const handle of creators) {
    const wallet = pubkey();
    const rows = await sql<{ id: string }[]>`
      insert into users (wallet, roles, handle, x_handle)
      values (${wallet}, ${sql.array(['buyer', 'creator'])}::user_role[], ${handle}, ${handle})
      returning id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('user insert failed');
    ids.set(handle, { id, wallet });
    await sql`
      insert into bonds (user_id, amount, tx_sig, status)
      values (${id}, ${5_000_000_000n}, ${fakeSig()}, 'active')
    `;
  }
  const buyerWallet = pubkey();
  const buyer = await sql<{ id: string }[]>`
    insert into users (wallet, roles, handle) values (${buyerWallet}, ${sql.array(['buyer'])}::user_role[], 'demo_buyer')
    returning id
  `;
  const buyerId = buyer[0]?.id;
  if (!buyerId) throw new Error('buyer insert failed');

  const catalogue = samples(buyerWallet);
  for (const item of catalogue) {
    const creator = ids.get(item.creator);
    if (!creator) throw new Error(`missing creator ${item.creator}`);
    const listingRows = await sql<{ id: string }[]>`
      insert into listings (
        creator_id, slug, title, summary, description, category, terminals, price, license,
        holder_only, holder_only_hours, is_featured, sales_7d, rating_avg, rating_count
      ) values (
        ${creator.id}, ${item.slug}, ${item.title}, ${item.summary}, ${item.summary},
        ${item.category}::category, ${sql.array([...item.terminals])}, ${BigInt(item.price)}, 'single',
        ${item.holderOnly ?? false}, ${item.holderOnlyHours ?? 0}, ${item.featured ?? false},
        ${item.sales}, ${item.rating}, ${item.sales > 0 ? 12 : 0}
      ) returning id
    `;
    const listingId = listingRows[0]?.id;
    if (!listingId) throw new Error('listing insert failed');
    const liveId = await insertVersion(sql, blobDir, attestSecret, {
      listingId,
      category: item.category,
      fileName: item.fileName,
      bytes: item.bytes,
      semver: '1.0.0',
      approve: true,
    });
    await sql`update listings set live_version_id = ${liveId}, first_live_at = now() - interval '7 days' where id = ${listingId}`;
    if (item.extra) {
      await insertVersion(sql, blobDir, attestSecret, {
        listingId,
        category: item.category,
        fileName: item.extra.fileName,
        bytes: item.extra.bytes,
        semver: item.extra.semver,
        approve: false,
      });
    }
    const order = await sql<{ id: string }[]>`
      insert into orders (
        buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
        tier_at_purchase, memo, status, tx_sig, paid_at, escrow_until, released_at, expires_at
      ) values (
        ${buyerId}, ${listingId}, ${liveId}, ${BigInt(item.price)}, 500, 0, 0, 0, ${BigInt(item.price)},
        'none', ${'tm:' + fakeSig().slice(0, 8)}, 'released', ${fakeSig()}, now() - interval '3 days',
        now() - interval '1 day', now() - interval '1 day', now() - interval '4 days'
      ) returning id
    `;
    const orderId = order[0]?.id;
    if (!orderId) throw new Error('order insert failed');
    await sql`insert into licenses (order_id, wallet) values (${orderId}, ${buyerWallet})`;
    await sql`
      insert into listing_reviews (order_id, listing_id, rating, body)
      values (${orderId}, ${listingId}, 5, 'Verified buyer fixture from the seed catalogue.')
    `;
  }
}

async function insertVersion(
  sql: Sql,
  blobDir: string,
  attestSecret: string,
  input: {
    listingId: string;
    category: string;
    fileName: string;
    bytes: Uint8Array;
    semver: string;
    approve: boolean;
  },
): Promise<string> {
  const hash = await sha256(input.bytes);
  const output = await scan({ name: input.fileName, bytes: input.bytes }, input.category);
  const key = `blobs/${hash}`;
  const path = join(blobDir, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.bytes);
  const status =
    input.approve && output.summary !== 'fail'
      ? 'live'
      : output.summary === 'fail'
        ? 'rejected'
        : 'needs_creator';
  const rows = await sql<{ id: string }[]>`
    insert into versions (listing_id, semver, changelog, file_name, file_size, sha256, r2_key, status, declared)
    values (
      ${input.listingId}, ${input.semver}, 'Seeded catalogue version.', ${input.fileName}, ${input.bytes.length},
      ${hash}, ${key}, ${status}::version_status, ${sql.json(output.declared as never)}
    ) returning id
  `;
  const versionId = rows[0]?.id;
  if (!versionId) throw new Error('version insert failed');
  const scanRows = await sql<{ id: string }[]>`
    insert into scans (version_id, kind, finished_at, engine_ver, summary, raw)
    values (${versionId}, 'static', now(), ${output.engineVer}, ${output.summary}::check_result, ${sql.json(output as never)})
    returning id
  `;
  const scanId = scanRows[0]?.id;
  if (!scanId) throw new Error('scan insert failed');
  for (const check of output.checks) {
    await sql`
      insert into scan_checks (scan_id, rule_id, result, title, detail, locations)
      values (
        ${scanId}, ${check.ruleId}, ${check.result}::check_result, ${check.title}, ${check.detail},
        ${sql.json(check.locations as never)}
      )
    `;
  }
  if (status === 'live') {
    const decision = runAiVerifier({ checks: output.checks, sandboxVerdict: 'pass' });
    if (decision.decision !== 'approve') {
      throw new Error(`seed file ${input.fileName} was not approved: ${decision.notes}`);
    }
    const issuedAt = new Date().toISOString();
    const message = attestationMessage({
      versionId,
      sha256: hash,
      decision: 'approve',
      issuedAt,
    });
    const signature = await signAttestation(message, attestSecret);
    await sql`
      insert into ai_reviews (version_id, agent_id, decision, notes, attestation, signature, credit_lamports)
      values (${versionId}, ${decision.agentId}, 'approve', ${decision.notes}, ${message}, ${signature}, 0)
    `;
  }
  return versionId;
}
