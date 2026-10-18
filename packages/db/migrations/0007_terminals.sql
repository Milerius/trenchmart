-- Terminals: Padre is now "Terminal", Trojan is listed, BullX is retired.
update config
  set value = '["Axiom","GMGN","Photon","Terminal","Trojan","Any"]'
  where key = 'terminals';
-- Existing listings: canonical names, Padre -> Terminal, drop BullX, no duplicates.
update listings l
  set terminals = coalesce((
    select array_agg(name order by first_pos)
    from (
      select name, min(pos) as first_pos
      from (
        select
          case lower(btrim(t))
            when 'padre' then 'Terminal'
            when 'terminal' then 'Terminal'
            when 'trojan' then 'Trojan'
            when 'axiom' then 'Axiom'
            when 'gmgn' then 'GMGN'
            when 'photon' then 'Photon'
            when 'any' then 'Any'
            else btrim(t)
          end as name,
          pos
        from unnest(l.terminals) with ordinality as u(t, pos)
        where lower(btrim(t)) <> 'bullx' and btrim(t) <> ''
      ) mapped
      group by name
    ) deduped
  ), '{}')
  where exists (
    select 1 from unnest(l.terminals) t
    where lower(btrim(t)) in ('padre', 'bullx', 'terminal', 'trojan', 'axiom', 'gmgn', 'photon', 'any')
      and btrim(t) not in ('Terminal', 'Trojan', 'Axiom', 'GMGN', 'Photon', 'Any')
  );
