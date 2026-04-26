-- Home Pot — admin-only rename of any member.
--
-- profiles RLS only permits self-update (id = auth.uid()), so admins cannot
-- correct another member's display_name directly. Adding a security-definer
-- RPC mirrors the delete_member / promote_guest_to_member pattern: caller
-- must be a non-anonymous admin.

create or replace function public.admin_rename_member(
  p_user_id uuid,
  p_new_name text
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_anon boolean;
  caller_admin boolean;
  trimmed text := btrim(coalesce(p_new_name, ''));
begin
  if caller_id is null then raise exception 'Not authenticated'; end if;

  select coalesce(is_anonymous, false) into caller_anon from auth.users where id = caller_id;
  if caller_anon then raise exception 'Quick-join guests cannot rename members'; end if;

  -- Self-rename always allowed (already permitted by self RLS, but supporting
  -- it through this RPC keeps the client code simple). Admin gate for others.
  if p_user_id <> caller_id then
    select coalesce(is_admin, false) into caller_admin from public.profiles where id = caller_id;
    if not caller_admin then
      raise exception 'Only admins can rename another member';
    end if;
  end if;

  if length(trimmed) < 1 then raise exception 'Display name required'; end if;
  if length(trimmed) > 60 then raise exception 'Display name too long'; end if;

  update public.profiles set display_name = trimmed where id = p_user_id;
  if not found then raise exception 'Member not found'; end if;
end;
$$;

grant execute on function public.admin_rename_member(uuid, text) to authenticated;
