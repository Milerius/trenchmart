-- Real $TRENCH holder tier thresholds, in whole tokens (1B supply, 6 decimals).
-- Scout 100k (0.01% of supply), Trencher 1M (0.1%), OG 10M (1%).
-- Only replaces the original "[X]"/"[Y]"/"[Z]" placeholders, never an owner-set value.
update config
  set value = '{"scout":"100000","trencher":"1000000","og":"10000000"}'
  where key = 'tier_thresholds' and value::text like '%[X]%';
insert into config (key, value) values ('trench_decimals', '6') on conflict (key) do nothing;
