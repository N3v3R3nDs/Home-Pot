-- Home Pot — member directory + safe PIN reset
--
-- Lets the host see all members and reset any member's PIN if they forget it.
-- Reset preserves the auth.users row (same user_id) — all stats, bank
-- balance, tournament history, and FK references remain untouched.

-- ───────────────────────────────────────────────── members directory view
-- Joins profiles + auth.users with only safe fields so the client can list
-- members and tell apart PIN/email/anonymous accounts. RLS via grants.
create or replace view public.members as
select
  p.id,
  p.display_name,
  p.avatar_emoji,
  u.email,
  coalesce(u.is_anonymous, false) as is_anonymous,
  case
    when coalesce(u.is_anonymous, false) then 'anonymous'
    when u.email like '%@home-pot.local' then 'pin'
    when u.email is not null then 'email'
    else 'unknown'
  end as account_type,
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id;

grant select on public.members to authenticated;

-- ──────────────────────────────────────────────────── reset_member_pin
-- Updates the bcrypt password of a target member so they can sign back in
-- with name + new PIN. Does NOT touch the user row itself. Same auth.users.id,
-- same email, same `created_at` — only the encrypted_password changes.
create or replace function public.reset_member_pin(p_user_id uuid, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_anon boolean;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Anonymous (quick-join) users cannot reset others' PINs.
  select coalesce(is_anonymous, false) into caller_anon
    from auth.users where id = caller_id;
  if caller_anon then
    raise exception 'Quick-join guests cannot reset PINs';
  end if;

  if p_new_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  -- Update bcrypt hash. The same scheme GoTrue uses, so login will work
  -- immediately. Note: we prefix "pin-" to match the client's pinToPassword().
  update auth.users
  set encrypted_password = crypt('pin-' || p_new_pin, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

grant execute on function public.reset_member_pin(uuid, text) to authenticated;

-- pgcrypto is needed for crypt() / gen_salt()
create extension if not exists pgcrypto;
