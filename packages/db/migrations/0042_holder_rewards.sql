-- $MART holder rewards (docs/ops/holder-rewards.md). 50% of NET platform revenue goes to the top
-- 1000 $MART holders every epoch (3 h). Money path: the fee split's buyback slot is paid to the
-- rewards vault (Squads vault index 1); per epoch a Squads spending limit moves the holder pool
-- (+ the buyback share, forwarded) to the rewards hot wallet, which pushes SOL in batches of 20.

-- One row per revenue item that paid the rewards vault. ref is unique: a retry never counts twice.
create table if not exists reward_revenue (
  id bigserial primary key,
  source text not null check (source in ('order', 'vfee', 'featuring', 'supplement', 'renewal')),
  ref text not null unique,
  net_fee bigint not null check (net_fee >= 0),
  -- What the rewards vault actually received for this item (holders + buyback share).
  slot_lamports bigint not null check (slot_lamports >= 0),
  -- 50% of net_fee (before costs), never more than slot_lamports.
  holder_gross bigint not null check (holder_gross >= 0 and holder_gross <= slot_lamports),
  released_at timestamptz not null,
  epoch_id bigint not null
);
create index if not exists reward_revenue_epoch on reward_revenue (epoch_id);

-- status: open → closed (allocated) → funding → paying → paid; halted / skipped are terminal-ish.
create table if not exists reward_epochs (
  epoch_id bigint primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'closed', 'funding', 'paying', 'paid', 'halted', 'skipped')),
  -- Sample ticks (0..ticks-1) chosen from a secret seed; the seed is published after close.
  seed text not null,
  sample_ticks int[] not null,
  samples_done int not null default 0,
  supply bigint,
  min_balance bigint,
  revenue_lamports bigint not null default 0,
  slot_lamports bigint not null default 0,
  holder_gross bigint not null default 0,
  cost_lamports bigint not null default 0,
  holder_pool bigint not null default 0,
  carry_in bigint not null default 0,
  buyback_forward bigint not null default 0,
  cost_reserve bigint not null default 0,
  eligible int not null default 0,
  paid_count int not null default 0,
  carried_count int not null default 0,
  paid_lamports bigint not null default 0,
  carry_out bigint not null default 0,
  fund_lamports bigint not null default 0,
  fund_sig text,
  fund_valid_until bigint,
  fund_attempts int not null default 0,
  halted_reason text,
  last_error text,
  closed_at timestamptz,
  paid_at timestamptz
);

-- Cost lines per epoch (RPC, network fee, priority fee, payout fee, infra pro-rata).
create table if not exists reward_costs (
  epoch_id bigint not null references reward_epochs(epoch_id),
  kind text not null check (kind in ('rpc', 'network_fee', 'priority_fee', 'payout_fee', 'infra')),
  lamports bigint not null check (lamports >= 0),
  note text,
  primary key (epoch_id, kind)
);

-- Running lowest balance of each candidate across the epoch's random samples.
create table if not exists reward_balances (
  epoch_id bigint not null,
  owner text not null,
  min_amount numeric(20, 0) not null,
  samples int not null default 1,
  primary key (epoch_id, owner)
);

create table if not exists reward_holders (
  owner text primary key,
  first_seen_at timestamptz not null default now(),
  -- Undistributed share below the minimum payout, paid once it reaches it.
  carry bigint not null default 0 check (carry >= 0)
);

create table if not exists reward_exclusions (
  address text primary key,
  reason text not null,
  added_at timestamptz not null default now()
);

create table if not exists reward_allocations (
  epoch_id bigint not null references reward_epochs(epoch_id),
  owner text not null,
  rank int not null,
  weight numeric(20, 0) not null,
  share bigint not null,
  carry_in bigint not null,
  lamports bigint not null,
  status text not null check (status in ('pay', 'carried')),
  batch_no int,
  primary key (epoch_id, owner)
);
create index if not exists reward_allocations_owner on reward_allocations (owner, epoch_id desc);

-- One push transaction (≤ 20 transfers). Same claim-before-broadcast pattern as payouts.
create table if not exists reward_batches (
  epoch_id bigint not null references reward_epochs(epoch_id),
  batch_no int not null,
  recipients jsonb not null,
  lamports bigint not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  tx_sig text,
  valid_until_height bigint,
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  primary key (epoch_id, batch_no)
);
create index if not exists reward_batches_open on reward_batches (status) where status <> 'sent';
