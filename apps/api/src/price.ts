import { parseUsdCents } from '@trenchmart/shared';

export type PriceCache = { centsPerSol: bigint; at: number } | null;

export type SolUsdQuote = {
  centsPerSol: bigint | null;
  source: 'override' | 'live' | 'cache' | 'unavailable';
  fetchedAt: string | null;
  cache: PriceCache;
};

const DEFAULT_TTL_MS = 60_000;

export async function cachedSolUsd(input: {
  nowMs: number;
  cache: PriceCache;
  override?: string;
  ttlMs?: number;
  fetchUsd?: () => Promise<number | null>;
}): Promise<SolUsdQuote> {
  const override = parseUsdCents(input.override ?? '');
  if (override !== null) {
    return {
      centsPerSol: override,
      source: 'override',
      fetchedAt: new Date(input.nowMs).toISOString(),
      cache: input.cache,
    };
  }
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  if (input.cache && input.nowMs - input.cache.at < ttl) {
    return {
      centsPerSol: input.cache.centsPerSol,
      source: 'cache',
      fetchedAt: new Date(input.cache.at).toISOString(),
      cache: input.cache,
    };
  }
  try {
    const usd = input.fetchUsd ? await input.fetchUsd() : null;
    if (usd === null || !Number.isFinite(usd) || usd < 0) {
      return stale(input.cache);
    }
    const centsPerSol = parseUsdCents(usd.toFixed(2));
    if (centsPerSol === null) return stale(input.cache);
    const cache = { centsPerSol, at: input.nowMs };
    return { centsPerSol, source: 'live', fetchedAt: new Date(input.nowMs).toISOString(), cache };
  } catch {
    return stale(input.cache);
  }
}

function stale(cache: PriceCache): SolUsdQuote {
  if (!cache) return { centsPerSol: null, source: 'unavailable', fetchedAt: null, cache: null };
  return {
    centsPerSol: cache.centsPerSol,
    source: 'cache',
    fetchedAt: new Date(cache.at).toISOString(),
    cache,
  };
}

export async function fetchCoinGeckoSolUsd(): Promise<number | null> {
  const response = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    {
      signal: AbortSignal.timeout(4000),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { solana?: { usd?: number } };
  const usd = body.solana?.usd;
  return typeof usd === 'number' && Number.isFinite(usd) ? usd : null;
}
