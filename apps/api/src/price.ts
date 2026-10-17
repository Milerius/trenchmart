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

const USER_AGENT = 'trenchmart/1.0 (+https://trenchmart.fun)';

type Fetch = typeof fetch;

/** One public SOL/USD source: URL plus how to read the price out of its JSON. */
export const SOL_USD_SOURCES: { name: string; url: string; read: (body: any) => unknown }[] = [
  {
    // CoinGecko rejects requests without a User-Agent (403) and rate-limits shared egress
    // IPs such as Cloudflare Workers (429), so it is first but never the only source.
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    read: (body) => body?.solana?.usd,
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot',
    read: (body) =>
      body?.data?.currency === 'USD' && body?.data?.base === 'SOL' ? body.data.amount : null,
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=SOLUSD',
    read: (body) =>
      Array.isArray(body?.error) && body.error.length === 0 ? body?.result?.SOLUSD?.c?.[0] : null,
  },
  {
    name: 'jupiter',
    url: 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
    read: (body) => body?.So11111111111111111111111111111111111111112?.usdPrice,
  },
];

function priceOf(value: unknown): number | null {
  const usd = typeof value === 'string' ? Number(value) : value;
  // A sanity band: a source returning 0 or a wild number is treated as unavailable.
  return typeof usd === 'number' && Number.isFinite(usd) && usd > 0.01 && usd < 100_000
    ? usd
    : null;
}

/** First public source that answers with a sane SOL/USD price, or null if none do. */
export const SOL_USD_SOURCE_TIMEOUT_MS = 3000;
/** The whole fallback chain shares this budget, so a stalled run costs one request at most 5 s. */
export const SOL_USD_TOTAL_BUDGET_MS = 5000;

export async function fetchSolUsd(
  fetchImpl: Fetch = fetch,
  now: () => number = Date.now,
): Promise<number | null> {
  const deadline = now() + SOL_USD_TOTAL_BUDGET_MS;
  for (const source of SOL_USD_SOURCES) {
    const left = deadline - now();
    if (left <= 0) break;
    try {
      const response = await fetchImpl(source.url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(Math.min(SOL_USD_SOURCE_TIMEOUT_MS, left)),
      });
      if (!response.ok) continue;
      const usd = priceOf(source.read(await response.json()));
      if (usd !== null) return usd;
    } catch {
      // Network error or bad JSON: try the next source.
    }
  }
  return null;
}
