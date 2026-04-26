-- Home Pot — admin-only delete member
--
-- The default profiles RLS only allows self-delete (id = auth.uid()), which
-- means a host can't clean up bogus test profiles created during testing.
-- Adding a security-definer RPC so admins (profiles.is_admin = true) can
-- delete *another* member.
--
-- Cascades:
--   profiles.id deletion already cascades into:
--     • tournaments.host_id (CASCADE)        — their hosted games + players go
--     • cash_games.host_id (CASCADE)
--     • tournament_players.profile_id (SET NULL) — game history preserved
--     • cash_game_players.profile_id (SET NULL)
--     • bank_transactions.profile_id (SET NULL when configured)
--   We additionally delete the matching auth.users row so the orphan auth
--   account doesn't sit around. Same atomic operation so we never end up
--   with a profile-without-auth or auth-without-profile mismatch.

create or replace function public.delete_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_admin boolean;
  caller_anon boolean;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Anonymous (quick-join guests) cannot delete members.
  select coalesce(is_anonymous, false) into caller_anon
    from auth.users where id = caller_id;
  if caller_anon then
    raise exception 'Quick-join guests cannot delete members';
  end if;

  -- Caller must be an admin in profiles.
  select coalesce(is_admin, false) into caller_admin
    from public.profiles where id = caller_id;
  if not caller_admin then
    raise exception 'Only admins can delete members';
  end if;

  -- Self-delete via this RPC is disallowed (use the separate self-delete
  -- flow). Prevents an admin from accidentally locking themselves out.
  if p_user_id = caller_id then
    raise exception 'Cannot delete your own account here';
  end if;

  -- Delete in profile-first order: cascades fan out from public.profiles.id
  -- (host_id CASCADE on tournaments / cash_games, profile_id SET NULL on
  -- player rows). After that, drop the auth.users row so we don't leave
  -- an orphan auth account.
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.delete_member(uuid) to authenticated;
