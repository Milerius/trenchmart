import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { parseSecretKey, publicKeyOf, readEscrowSafe } from './transparency-chain';
import { REPORT_SCHEMA, reportMessage, type SignedReport } from '@trenchmart/shared';
import { RULES_ENGINE } from '@trenchmart/ai-verifier';
import { HttpError, SANDBOX_ENGINE, sha256Hex, type Deps } from './logic';

type Row = Record<string, any>;

const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
/** Program Metadata program; holds the IDL that `anchor idl init` publishes. */
export const PROGRAM_METADATA_PROGRAM = 'ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S';
/**
 * Canonical "idl" metadata account for the devnet escrow program, created by `anchor idl init`.
 * Fetch it yourself: npx @solana-program/program-metadata fetch idl <program id> --rpc <devnet rpc>
 */
export const ESCROW_IDL_ACCOUNT = '61vN1BEi11AV8i2udqd1xkYUoHBCTrDtubk5UhtMA6UJ';

export const SQUADS_V4_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

/** Threshold and members of a Squads v4 multisig account. */
export function decodeSquadsMultisig(
  data: Uint8Array,
): { threshold: number; members: string[] } | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const threshold = view.getUint16(72, true);
    let at = 72 + 2 + 4 + 8 + 8;
    at += data[at] === 1 ? 33 : 1; // rent_collector: Option<Pubkey>
    at += 1; // bump
    const count = view.getUint32(at, true);
    at += 4;
    if (count > 64) return null;
    const members: string[] = [];
    for (let i = 0; i < count; i++) {
      members.push(bs58.encode(data.subarray(at, at + 32)));
      at += 33;
    }
    return { threshold, members };
  } catch {
    return null;
  }
}

const CACHE_MS = 5 * 60_000;
let cached: { at: number; key: string; value: unknown } | null = null;

function u32(data: Uint8Array, at: number) {
  return new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0, true);
}

/** Parses the neodyme security.txt block embedded in a program binary. */
export function securityTxtOf(elf: Uint8Array): Record<string, string> | null {
  const text = new TextDecoder('latin1').decode(elf);
  const begin = text.indexOf('=======BEGIN SECURITY.TXT V1=======\0');
  if (begin < 0) return null;
  const end = text.indexOf('=======END SECURITY.TXT V1=======', begin);
  if (end < 0) return null;
  const parts = text
    .slice(begin + 36, end)
    .split('\0')
    .filter(Boolean);
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i]!] = parts[i + 1]!;
  return out;
}

/** sha256 of the deployed program bytes with trailing zero padding removed (solana-verify's convention). */
export async function programHash(elf: Uint8Array): Promise<string> {
  let end = elf.length;
  while (end > 0 && elf[end - 1] === 0) end--;
  return sha256Hex(elf.subarray(0, end));
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes.slice().buffer).body!.pipeThrough(
    new DecompressionStream('deflate'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function reportPublicKey(deps: Deps): string | null {
  if (!deps.env.reportSigningKey) return null;
  return publicKeyOf(parseSecretKey(deps.env.reportSigningKey));
}

/** Everything a third party needs to check the deployment, read live from devnet. */
export async function transparency(deps: Deps) {
  const env = deps.env;
  const key = `${env.escrowProgramId}:${env.cluster}`;
  if (cached && cached.key === key && deps.now().getTime() - cached.at < CACHE_MS)
    return cached.value;
  const chain = deps.escrowChain;
  const look = async (address: string) => {
    if (!address || !chain) return null;
    try {
      return await chain.account(address);
    } catch {
      return null;
    }
  };
  const account = async (role: string, address: string, note?: string) => {
    const info = await look(address);
    return {
      role,
      address: address || null,
      exists: Boolean(info),
      owner: info?.owner ?? null,
      lamports: info ? info.lamports.toString() : null,
      note: note ?? null,
    };
  };

  let program: Record<string, unknown> = { address: env.escrowProgramId || null, exists: false };
  if (env.escrowProgramId) {
    const info = await look(env.escrowProgramId);
    if (
      info &&
      info.owner === BPF_UPGRADEABLE_LOADER &&
      info.data.length >= 36 &&
      u32(info.data, 0) === 2
    ) {
      const programData = bs58.encode(info.data.subarray(4, 36));
      const pd = await look(programData);
      if (pd && pd.data.length > 45) {
        const slot = new DataView(pd.data.buffer, pd.data.byteOffset + 4, 8).getBigUint64(0, true);
        const authority = pd.data[12] === 1 ? bs58.encode(pd.data.subarray(13, 45)) : null;
        const elf = pd.data.subarray(45);
        program = {
          address: env.escrowProgramId,
          exists: true,
          executable: true,
          programData,
          lastDeploySlot: slot.toString(),
          upgradeAuthority: authority,
          deployedBytes: elf.length,
          sha256: await programHash(elf),
          securityTxt: securityTxtOf(elf),
          verifiedBuild: {
            status: 'not_verified',
            detail:
              'No reproducible (solana-verify, Docker) build is published yet. Compare sha256 above with `solana-verify get-program-hash -u devnet <program>` and with your own `anchor build` of programs/trench_escrow.',
          },
        };
      }
    }
  }

  let idl: Record<string, unknown> = { account: ESCROW_IDL_ACCOUNT, exists: false };
  const idlInfo = await look(ESCROW_IDL_ACCOUNT);
  if (idlInfo && idlInfo.owner === PROGRAM_METADATA_PROGRAM) {
    const body = idlInfo.data.subarray(96);
    let instructions: string[] | null = null;
    try {
      const json = JSON.parse(new TextDecoder().decode(await inflate(body))) as {
        address?: string;
        instructions?: { name: string }[];
      };
      if (json.address === env.escrowProgramId)
        instructions = (json.instructions ?? []).map((ix) => ix.name);
    } catch {
      instructions = null;
    }
    idl = { account: ESCROW_IDL_ACCOUNT, exists: true, owner: idlInfo.owner, instructions };
  }

  const msInfo = await look(env.multisigAddress);
  const multisig =
    msInfo && msInfo.owner === SQUADS_V4_PROGRAM
      ? { address: env.multisigAddress, ...decodeSquadsMultisig(msInfo.data) }
      : { address: env.multisigAddress || null, threshold: null, members: [] };

  const value = {
    cluster: env.cluster,
    multisig,
    checkedAt: deps.now().toISOString(),
    program,
    idl,
    accounts: await Promise.all([
      account('Treasury vault (Squads v4 vault PDA)', env.vaultAddress),
      account('Squads multisig (2-of-3) controlling the vault', env.multisigAddress),
      account('Escrow resolver (signs refund / reject_dispute)', env.escrowResolver),
      account('Fee bucket: buyback', env.buckets.buyback),
      account('Fee bucket: review (verification)', env.buckets.ai_verification),
      account('Fee bucket: ops', env.buckets.ops),
      account('Fee bucket: safety', env.buckets.safety),
      account('$TRENCH devnet mint', env.trenchMint),
    ]),
    review: {
      engine: env.llm.apiKey && env.llm.model ? `${RULES_ENGINE}+llm` : RULES_ENGINE,
      model: env.llm.apiKey && env.llm.model ? env.llm.model : null,
      sandboxEngine: SANDBOX_ENGINE,
      note:
        env.llm.apiKey && env.llm.model
          ? 'Rules engine plus a language model. The model can only make a verdict stricter.'
          : 'Rules engine only (no language model is configured). Reports say which engine reviewed each version.',
    },
    reportSigningKey: reportPublicKey(deps),
  };
  cached = { at: deps.now().getTime(), key, value };
  return value;
}

/** Full scan report for a listing's live version, signed with REPORT_SIGNING_KEY when set. */
export async function scanReport(deps: Deps, slug: string) {
  const listings = await deps.sql<Row[]>`
    select l.id, l.slug, l.title, l.category, l.live_version_id from listings l
    where l.slug = ${slug} and l.delisted_at is null
  `;
  const listing = listings[0];
  if (!listing?.live_version_id) throw new HttpError(404, 'NOT_FOUND', 'no reviewed version');
  const versionId = listing.live_version_id as string;
  const version = (await deps.sql<Row[]>`select * from versions where id = ${versionId}`)[0];
  if (!version) throw new HttpError(404, 'NOT_FOUND', 'no reviewed version');
  const scans = await deps.sql<Row[]>`
    select id, kind, started_at, finished_at, engine_ver, summary, raw from scans
    where version_id = ${versionId} order by started_at
  `;
  const checks = await deps.sql<Row[]>`
    select sc.scan_id, sc.rule_id, sc.result, sc.title, sc.detail, sc.locations
    from scan_checks sc join scans s on s.id = sc.scan_id
    where s.version_id = ${versionId} order by sc.rule_id
  `;
  const reviews = await deps.sql<Row[]>`
    select agent_id, decision, notes, attestation, signature, engine, model, created_at
    from ai_reviews where version_id = ${versionId} order by created_at
  `;
  const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);
  const report = {
    schema: REPORT_SCHEMA,
    cluster: deps.env.cluster,
    listing: { slug: listing.slug, title: listing.title, category: listing.category },
    version: {
      id: versionId,
      semver: version.semver,
      fileName: version.file_name,
      fileSize: Number(version.file_size),
      sha256: version.sha256,
      uploadedAt: iso(version.created_at),
      status: version.status,
    },
    steps: scans.map((scan) => {
      const raw = (scan.raw ?? {}) as Record<string, unknown>;
      return {
        kind: scan.kind,
        engine: scan.engine_ver,
        startedAt: iso(scan.started_at),
        finishedAt: iso(scan.finished_at),
        summary: scan.summary,
        checks: checks
          .filter((check) => check.scan_id === scan.id)
          .map((check) => ({
            ruleId: check.rule_id,
            result: check.result,
            title: check.title,
            detail: check.detail,
            locations: check.locations ?? [],
          })),
        ...(scan.kind === 'sandbox'
          ? {
              sandbox: {
                verdict: raw.verdict ?? null,
                walletCalls: raw.walletCalls ?? [],
                requests: raw.requests ?? [],
                errors: raw.errors ?? [],
              },
            }
          : {}),
      };
    }),
    reviews: reviews.map((review) => ({
      agentId: review.agent_id,
      engine: review.engine ?? RULES_ENGINE,
      model: review.model ?? null,
      decision: review.decision,
      notes: review.notes,
      decidedAt: iso(review.created_at),
      attestation: review.attestation,
      attestationHmac: review.signature,
    })),
  };
  if (!deps.env.reportSigningKey)
    return { report, signature: null } satisfies SignedReport<typeof report>;
  const secret = parseSecretKey(deps.env.reportSigningKey);
  const message = reportMessage(report);
  return {
    report,
    signature: {
      alg: 'ed25519',
      publicKey: publicKeyOf(secret),
      value: bs58.encode(nacl.sign.detached(message, secret)),
      signedMessage:
        'UTF-8 of "trenchmart-scan-report:v1\\n" + canonical JSON of `report` (keys sorted, no spaces)',
    },
  } satisfies SignedReport<typeof report>;
}

/** Live on-chain state of the buyer's own order escrow. */
export async function orderEscrow(deps: Deps, orderId: string, userId: string) {
  const order = (
    await deps.sql<Row[]>`select * from orders where id = ${orderId} and buyer_id = ${userId}`
  )[0];
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  const address = order.escrow_address as string | null;
  const base = {
    orderId,
    programId: deps.env.escrowProgramId || null,
    address,
    txSig: order.tx_sig ?? null,
    releaseSig: order.release_sig ?? null,
    refundSig: order.refund_sig ?? null,
    db: {
      status: order.status,
      escrowUntil: order.escrow_until ?? null,
      total: String(order.total),
    },
  };
  if (!address || !deps.escrowChain || !deps.env.escrowProgramId) return { ...base, onChain: null };
  const account = await readEscrowSafe(deps.escrowChain, deps.env.escrowProgramId, address);
  if (!account) return { ...base, onChain: { exists: false } };
  return {
    ...base,
    onChain: {
      exists: true,
      status: account.status,
      price: account.price.toString(),
      deposit: account.deposit.toString(),
      escrowUntil: new Date(Number(account.escrowUntil) * 1000).toISOString(),
      expiresAt: new Date(Number(account.expiresAt) * 1000).toISOString(),
      buyer: account.buyer,
      seller: account.seller,
      resolver: account.resolver,
    },
  };
}

/** Recent escrows, public: addresses and signatures are on chain anyway. No wallets, no ids. */
export async function recentEscrows(deps: Deps) {
  const rows = await deps.sql<Row[]>`
    select o.escrow_address, o.tx_sig, o.release_sig, o.refund_sig, o.status, o.total,
      o.paid_at, o.escrow_until, l.slug, l.title
    from orders o join listings l on l.id = o.listing_id
    where o.escrow_address is not null and o.tx_sig is not null
    order by o.paid_at desc nulls last limit 10
  `;
  return rows.map((row) => ({
    escrow: row.escrow_address,
    txSig: row.tx_sig,
    releaseSig: row.release_sig ?? null,
    refundSig: row.refund_sig ?? null,
    status: row.status,
    total: String(row.total),
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    escrowUntil: row.escrow_until ? new Date(row.escrow_until).toISOString() : null,
    listing: { slug: row.slug, title: row.title },
  }));
}

export function resetTransparencyCache() {
  cached = null;
}
