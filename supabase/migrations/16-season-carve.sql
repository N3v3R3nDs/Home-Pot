-- Home Pot — season carve + season pot view.
--
-- A season can run with a per-entry "carve": every buy-in, rebuy and addon
-- contributes a fixed amount to the season pot instead of the tournament
-- prize pool. At the end of the season the host runs a final-table
-- tournament whose prize pool is the accumulated carve.
--
-- Example: 250 buy-in, 50 carve. 200 goes to that night's prize pool, 50
-- accumulates in the season pot. After 8 tournaments × 6 entries × 50 =
-- 2,400 sitting in the pot.

alter table public.tournaments
  add column if not exists season_carve numeric not null default 0
    check (season_carve >= 0);

create index if not exists idx_tournaments_season_carve
  on public.tournaments(season_id) where season_carve > 0;

-- Per-season accumulated carve. Counts every buy-in + rebuy + addon row.
-- Excludes deleted tournaments. Excludes tournaments without a season_id
-- (they never contributed). The view is read-only; clients can SELECT it.
drop view if exists public.season_pots;
create view public.season_pots as
select
  t.season_id,
  s.name             as season_name,
  s.starts_on,
  s.ends_on,
  coalesce(sum(
    t.season_carve * (
      coalesce(p.buy_ins, 0) + coalesce(p.rebuys, 0) + coalesce(p.addons, 0)
    )
  ), 0)              as pot,
  count(distinct t.id) filter (where t.season_carve > 0) as contributing_tournaments,
  count(p.id) filter (where t.season_carve > 0)          as contributing_entries
from public.seasons s
left join public.tournaments t on t.season_id = s.id and t.deleted_at is null
left join public.tournament_players p on p.tournament_id = t.id
group by t.season_id, s.id, s.name, s.starts_on, s.ends_on;

grant select on public.season_pots to authenticated;
