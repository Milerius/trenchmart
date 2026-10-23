-- Status page: which Solana RPC answered the watchdog's rpc check (docs/ops/networks.md).
-- 'helius' = primary private RPC, 'public' = public fallback. Null for other components and for
-- probes from before this column. A provider name only: never the RPC URL or its key.
alter table status_probes add column if not exists provider text
  check (provider is null or provider in ('helius', 'public'));
