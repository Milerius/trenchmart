-- Escrow program v2 (security review L-01): terminal escrows are closed and their rent is
-- returned to the buyer by the cron. This marks the orders whose escrow is already closed.
alter table orders add column if not exists escrow_closed_at timestamptz;
-- Checkout kill switch (mainnet readiness #18). Admins flip it with
--   update config set value = 'true' where key = 'checkout_paused';
insert into config (key, value) values ('checkout_paused', 'false') on conflict (key) do nothing;
