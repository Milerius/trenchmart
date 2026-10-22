import { CLUSTER } from '@/lib/cluster';
import { ENDPOINTS } from '@/lib/cluster-endpoints';
import { DEFAULT_CONFIG_JSON } from '@trenchmart/shared/config';
import {
  AI_AGENT_ID,
  DEVNET_ADDRESSES,
  ESCROW_CLUSTER,
  ESCROW_PROGRAM_ID,
} from '@/lib/protocol-facts';
import { publicApi } from '@/lib/server-api';

export const revalidate = 300;

type Transparency = {
  cluster?: string;
  multisig?: { address: string | null; threshold: number | null; members: string[] };
  program?: { address: string; upgradeAuthority: string | null; sha256: string | null };
  idl?: { account: string };
  accounts?: { role: string; address: string }[];
  reportSigningKey?: string | null;
  checkedAt?: string;
};

const explorer = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=${ESCROW_CLUSTER}`;

/** Machine-readable deployment facts. Everything here is Solana DEVNET, not mainnet. */
export async function GET() {
  const { data: live } = await publicApi<Transparency>('/transparency', 300);
  const role = (re: RegExp) => live?.accounts?.find((a) => re.test(a.role))?.address ?? null;
  const vault = role(/vault/i) ?? DEVNET_ADDRESSES.vault;
  const mint = role(/mint/i) ?? DEVNET_ADDRESSES.martMint;
  const multisig = live?.multisig?.address ?? DEVNET_ADDRESSES.multisig;
  const body = {
    name: 'TrenchMart',
    site: 'https://trenchmart.fun',
    cluster: ESCROW_CLUSTER,
    mainnet: false,
    notice:
      'Every address below is on Solana DEVNET. Looking them up on mainnet returns nothing. Use ?cluster=devnet on Solana Explorer or RPC https://api.devnet.solana.com.',
    rpc: ENDPOINTS[CLUSTER.id].rpc,
    escrowProgram: {
      programId: ESCROW_PROGRAM_ID,
      idlAccount: live?.idl?.account ?? null,
      upgradeAuthority: live?.program?.upgradeAuthority ?? vault,
      sha256: live?.program?.sha256 ?? null,
      explorer: explorer(ESCROW_PROGRAM_ID),
    },
    treasury: {
      squadsMultisig: multisig,
      vault,
      threshold: live?.multisig?.threshold ?? 2,
      members: live?.multisig?.members ?? [],
      explorer: explorer(vault),
    },
    escrowResolver: role(/resolver/i),
    feeBuckets: (live?.accounts ?? [])
      .filter((a) => /bucket/i.test(a.role))
      .map((a) => ({ role: a.role, address: a.address })),
    token: {
      symbol: 'TRENCH',
      mint,
      decimals: DEFAULT_CONFIG_JSON.trench_decimals,
      supply: '1000000000',
      tierThresholdsWholeTokens: DEFAULT_CONFIG_JSON.tier_thresholds,
      tierWindowHours: DEFAULT_CONFIG_JSON.tier_window_hours,
      explorer: explorer(mint),
    },
    review: {
      agentId: AI_AGENT_ID,
      reportSigningKey: live?.reportSigningKey ?? null,
      signature: 'ed25519 over the canonical JSON report (base58 public key)',
    },
    endpoints: {
      transparency: 'https://api.trenchmart.fun/api/v1/transparency',
      verifyPage: 'https://trenchmart.fun/verify',
      health: 'https://api.trenchmart.fun/api/v1/health',
    },
    checkedAt: live?.checkedAt ?? null,
  };
  return Response.json(body, {
    headers: {
      'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
      'access-control-allow-origin': '*',
    },
  });
}
