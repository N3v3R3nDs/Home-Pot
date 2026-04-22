-- Home Pot — collaborative trust model
-- The original schema had host-only writes (only the tournament creator could
-- record a buy-in or bust). Real home games are collaborative — anyone at the
-- table should be able to record a buy-in for themselves OR for a friend who
-- just stepped away. This migration opens write access to ALL authenticated
-- users on transactional tables. Setup ownership (host_id) is preserved for
-- bookkeeping but no longer enforced.

-- Drop host-only policies if they exist
drop policy if exists "host write sessions"  on public.sessions;
drop policy if exists "host write sp"        on public.session_participants;
drop policy if exists "host write tour"      on public.tournaments;
drop policy if exists "host write tplayers"  on public.tournament_players;
drop policy if exists "host write cgames"    on public.cash_games;
drop policy if exists "host write cgp"       on public.cash_game_players;
drop policy if exists "host write cbi"       on public.cash_buy_ins;

-- Open writes to any authenticated user (friend-group trust).
create policy "auth write sessions"  on public.sessions             for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth write sp"        on public.session_participants for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth write tour"      on public.tournaments          for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth write tplayers"  on public.tournament_players   for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth write cgames"    on public.cash_games           for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth write cgp"       on public.cash_game_players    for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth write cbi"       on public.cash_buy_ins         for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
