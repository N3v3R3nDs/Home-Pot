-- Home Pot — short join codes + better anonymous-user profile creation
--
-- Each tournament and cash game gets a 4-letter human-friendly code (e.g. "BEAR").
-- A friend opens the app, enters the code, signs in anonymously, then taps
-- their seat on the roster — no email, no password, on the table in seconds.

alter table public.tournaments add column if not exists join_code text;
alter table public.cash_games  add column if not exists join_code text;

create unique index if not exists ux_tournaments_join_code on public.tournaments(join_code) where join_code is not null;
create unique index if not exists ux_cash_games_join_code  on public.cash_games(join_code)  where join_code is not null;

-- Improve the profile-on-signup trigger so anonymous users (no email) still
-- get a usable display name. Anonymous users will be renamed when they tap
-- a seat to claim it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  fallback text;
begin
  fallback := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Guest'
  );
  insert into public.profiles (id, display_name)
  values (new.id, fallback)
  on conflict (id) do nothing;
  return new;
end;
$$;
