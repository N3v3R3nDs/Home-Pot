-- Home Pot — preserve player history when a profile is deleted
--
-- The tournament_players / cash_game_players check constraint requires either
-- a profile_id or a guest_name. When we delete a registered user, the FK
-- ON DELETE SET NULL would null out profile_id and leave guest_name null too,
-- violating the constraint.
--
-- This trigger copies the profile's display_name into guest_name on all of
-- the user's player rows BEFORE deletion, so the row stays valid (and the
-- player remains visible in tournament history under their old name).

create or replace function public.preserve_player_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tournament_players
     set guest_name = old.display_name
   where profile_id = old.id
     and guest_name is null;

  update public.cash_game_players
     set guest_name = old.display_name
   where profile_id = old.id
     and guest_name is null;

  return old;
end;
$$;

drop trigger if exists preserve_player_history_on_profile_delete on public.profiles;
create trigger preserve_player_history_on_profile_delete
  before delete on public.profiles
  for each row execute function public.preserve_player_history();
