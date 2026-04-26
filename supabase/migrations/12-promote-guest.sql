-- Home Pot — promote a past guest into a real PIN-based member.
--
-- "Guests" are tournament_players / cash_game_players rows where guest_name
-- is set and profile_id is null — people who showed up but haven't signed
-- up themselves. After a real game with friends like that, the host wants
-- them to appear in the Members directory so future stats / bank balances
-- attach to them properly across nights.
--
-- This RPC creates an auth.users row + profile, re-points every existing
-- guest row that matches (case-insensitive) to the new profile_id, then
-- returns the new profile id. The friend can then sign in with their
-- display_name + the PIN the admin set.

create or replace function public.promote_guest_to_member(
  p_guest_name text,
  p_display_name text,
  p_pin text
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_admin boolean;
  caller_anon boolean;
  new_user_id uuid := gen_random_uuid();
  email_base text := regexp_replace(lower(p_display_name), '[^a-z0-9]+', '-', 'g');
  email_alias text;
  attempt int := 0;
  retouch int;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(is_anonymous, false) into caller_anon from auth.users where id = caller_id;
  if caller_anon then
    raise exception 'Quick-join guests cannot promote members';
  end if;

  select coalesce(is_admin, false) into caller_admin from public.profiles where id = caller_id;
  if not caller_admin then
    raise exception 'Only admins can promote guests to members';
  end if;

  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  if length(coalesce(p_display_name, '')) < 1 then
    raise exception 'Display name required';
  end if;

  if length(coalesce(p_guest_name, '')) < 1 then
    raise exception 'Guest name required';
  end if;

  -- Pick a unique email alias under the home-pot.local domain. Same scheme
  -- as the existing PIN sign-up flow (see AuthScreen client logic).
  email_alias := email_base || '@home-pot.local';
  while exists(select 1 from auth.users where email = email_alias) loop
    attempt := attempt + 1;
    email_alias := email_base || '-' || attempt::text || '@home-pot.local';
    if attempt > 50 then
      raise exception 'Could not find a free email alias for %', p_display_name;
    end if;
  end loop;

  -- Insert auth user. The on_auth_user_created trigger will create the
  -- matching profile from raw_user_meta_data.display_name.
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at
  ) values (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    email_alias,
    crypt('pin-' || p_pin, gen_salt('bf')),
    now(),
    jsonb_build_object('display_name', p_display_name),
    now(),
    now()
  );

  -- Defensive: the trigger should have created the profile. Ensure name +
  -- emoji are right, then re-point all guest references.
  update public.profiles
  set display_name = p_display_name
  where id = new_user_id and display_name <> p_display_name;

  update public.tournament_players
  set profile_id = new_user_id, guest_name = null
  where lower(guest_name) = lower(p_guest_name) and profile_id is null;
  get diagnostics retouch = row_count;

  update public.cash_game_players
  set profile_id = new_user_id, guest_name = null
  where lower(guest_name) = lower(p_guest_name) and profile_id is null;

  -- Bank ledger uses profile_id when available; existing guest_name rows
  -- stay unchanged so historic statements remain stable. Future bank txs
  -- attached to this person via profile_id will roll up correctly.

  return new_user_id;
end;
$$;

grant execute on function public.promote_guest_to_member(text, text, text) to authenticated;
