-- Verified wallet count (2026-10-18). The static scan counts the unique valid Solana addresses
-- in a wallet list version's file and stores them here, with counts-only parse facts (format,
-- rows, duplicates, invalid, named, alert types). Replaces the seller-typed specs.walletCount,
-- which is dropped from existing listings so it is never shown again.
alter table versions add column if not exists wallet_count int;
alter table versions add column if not exists wallet_facts jsonb;
update listings set specs = specs - 'walletCount' where kind = 'wallet' and specs ? 'walletCount';
