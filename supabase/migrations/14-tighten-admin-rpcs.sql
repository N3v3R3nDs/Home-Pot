-- Home Pot — additional security hardening pass.
--
-- Three concrete holes to close:
--   1. reset_member_pin checks only "is the caller anonymous?" — every
--      signed-in member can reset every other member's PIN, then sign in as
--      that member. Privilege-escalation. Tighten to admin OR self.
--   2. members view exposes auth.users.email to every authenticated caller,
--      including anonymous spectators on /t/<code>/view and /c/<code>/view.
--      The client never displays email — drop it from the view, keep
--      account_type derivation server-side.
--   3. audit_log insert policy is "any authenticated" — a spectator could
--      spam fake audit entries. Tighten to non-anonymous + non-public.

-- ───────────────────────────── 1. reset_member_pin: admin OR self
create or replace function public.reset_member_pin(p_user_id uuid, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_anon boolean;
  caller_admin boolean;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(is_anonymous, false) into caller_anon from auth.users where id = caller_id;
  if caller_anon then
    raise exception 'Quick-join guests cannot reset PINs';
  end if;

  -- Caller must be admin OR the member whose PIN is being reset.
  if p_user_id <> caller_id then
    select coalesce(is_admin, false) into caller_admin from public.profiles where id = caller_id;
    if not caller_admin then
      raise exception 'Only admins can reset another member''s PIN';
    end if;
  end if;

  if p_new_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

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

-- ───────────────────────────── 2. members view: drop email exposure
drop view if exists public.members;
create view public.members as
select
  p.id,
  p.display_name,
  p.avatar_emoji,
  coalesce(u.is_anonymous, false) as is_anonymous,
  coalesce(p.is_admin, false) as is_admin,
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

-- ───────────────────────────── 3. audit_log: non-anonymous writers only
drop policy if exists "auth write audit" on public.audit_log;
create policy "real write audit" on public.audit_log
  for insert with check (public.is_real_user());

-- And tighten read on audit_log so anonymous spectators don't see who did
-- what. Reads stay open to real users only.
drop policy if exists "auth read audit" on public.audit_log;
create policy "real read audit" on public.audit_log
  for select using (public.is_real_user());
