-- Owner decision 2026-10-18: escrow window is 1 hour (maximum).
-- Orders already paid keep the escrow_until stored on chain in their escrow account.
update config set value = '1' where key = 'escrow_hours';
