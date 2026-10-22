-- Automated payouts through a Squads v4 spending limit (docs/ops/payouts.md).
-- `sending`: a signed transaction exists and its signature is stored BEFORE broadcast, so a
-- crash or retry never builds a second transfer for the same line while the first can land.
alter type payout_status add value if not exists 'sending';
alter table payouts add column if not exists mode text not null default 'squads'
  check (mode in ('squads', 'auto'));
alter table payouts add column if not exists attempts int not null default 0;
alter table payouts add column if not exists last_error text;
-- Block height after which the stored transaction can no longer land (blockhash expiry).
alter table payouts add column if not exists valid_until_height bigint;
alter table payouts add column if not exists sent_at timestamptz;
-- Set when a line is over the automated caps; it then stays for a Squads batch.
alter table payouts add column if not exists held_reason text;
-- No literal 'sending' here: a new enum value cannot be used in the transaction that adds it
-- (the remote migrator runs a file as one transaction).
create index if not exists payouts_open on payouts (status, created_at) where status <> 'sent';
create index if not exists payouts_auto_sent on payouts (sent_at) where mode = 'auto';
