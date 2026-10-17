-- Orders settle through the trench_escrow program: the buyer funds a per-order PDA and the
-- resolver key releases or refunds it. These columns record the account and the settling txs.
alter table orders add column if not exists escrow_address text;
alter table orders add column if not exists release_sig text;
alter table orders add column if not exists refund_sig text;
create unique index if not exists orders_escrow_address_idx on orders (escrow_address)
  where escrow_address is not null;
