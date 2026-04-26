-- Home Pot — lock down anonymous spectators to read-only.
--
-- The PublicView / PublicCashView routes use supabase.auth.signInAnonymously()
-- so unauthenticated guests can read the tournament state without a real
-- account. Migration 02-collab.sql opened up *all* writes to anyone with
-- auth.role() = 'authenticated', which inadvertently includes those
-- anonymous spectator sessions. A spectator could mutate every game.
--
-- Fix: tighten the write policies so they additionally require the calling
-- auth user to NOT be anonymous. Reads stay open to authenticated +
-- anonymous (so the spectator views still work).

-- Helper: returns true when the current auth.uid() is a real (non-anonymous)
-- account. Used by all write policies below.
create or replace function public.is_real_user() returns boolean
language sql stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select not coalesce(is_anonymous, false) from auth.users where id = auth.uid()),
    false
  );
$$;
grant execute on function public.is_real_user() to authenticated;

-- Tighten every write policy added in 02-collab.sql.
drop policy if exists "auth write sessions"  on public.sessions;
drop policy if exists "auth write sp"        on public.session_participants;
drop policy if exists "auth write tour"      on public.tournaments;
drop policy if exists "auth write tplayers"  on public.tournament_players;
drop policy if exists "auth write cgames"    on public.cash_games;
drop policy if exists "auth write cgp"       on public.cash_game_players;
drop policy if exists "auth write cbi"       on public.cash_buy_ins;

create policy "real write sessions"  on public.sessions             for all
  using (public.is_real_user()) with check (public.is_real_user());
create policy "real write sp"        on public.session_participants for all
  using (public.is_real_user()) with check (public.is_real_user());
create policy "real write tour"      on public.tournaments          for all
  using (public.is_real_user()) with check (public.is_real_user());
create policy "real write tplayers"  on public.tournament_players   for all
  using (public.is_real_user()) with check (public.is_real_user());
create policy "real write cgames"    on public.cash_games           for all
  using (public.is_real_user()) with check (public.is_real_user());
create policy "real write cgp"       on public.cash_game_players    for all
  using (public.is_real_user()) with check (public.is_real_user());
create policy "real write cbi"       on public.cash_buy_ins         for all
  using (public.is_real_user()) with check (public.is_real_user());

-- Bank ledger from 03-bank.sql also opened up to authenticated; do the same.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bank_transactions' and policyname = 'auth write bank') then
    drop policy "auth write bank" on public.bank_transactions;
  end if;
end $$;
create policy "real write bank" on public.bank_transactions for all
  using (public.is_real_user()) with check (public.is_real_user());
