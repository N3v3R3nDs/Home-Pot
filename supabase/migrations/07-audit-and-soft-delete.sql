-- Home Pot — audit log + soft delete

-- ─────────────────────────────────────────── audit log
-- Append-only record of who did what. Driven by triggers on the tables that
-- actually matter (deletes, finishes, PIN resets, bank transactions).

create table if not exists public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,                    -- snapshot of display_name at action time
  action      text not null,           -- e.g. 'tournament.deleted'
  ref_table   text,
  ref_id      uuid,
  details     jsonb,                   -- arbitrary structured info
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_created on public.audit_log(created_at desc);
create index if not exists idx_audit_actor on public.audit_log(actor_id);

alter publication supabase_realtime add table public.audit_log;

alter table public.audit_log enable row level security;
create policy "auth read audit"   on public.audit_log for select using (auth.role() = 'authenticated');
create policy "auth write audit"  on public.audit_log for insert with check (auth.role() = 'authenticated');

-- Helper: insert an audit row using current auth.uid + profile name
create or replace function public.log_audit(
  p_action text,
  p_ref_table text default null,
  p_ref_id uuid default null,
  p_details jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_name text;
begin
  if caller is not null then
    select display_name into caller_name from public.profiles where id = caller;
  end if;
  insert into public.audit_log (actor_id, actor_name, action, ref_table, ref_id, details)
  values (caller, caller_name, p_action, p_ref_table, p_ref_id, p_details);
end;
$$;
grant execute on function public.log_audit(text, text, uuid, jsonb) to authenticated;

-- Auto-audit triggers for the high-impact events
create or replace function public.audit_tournament_changes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_audit('tournament.deleted', 'tournaments', old.id, jsonb_build_object('name', old.name));
    return old;
  elsif tg_op = 'UPDATE' and old.state <> 'finished' and new.state = 'finished' then
    perform public.log_audit('tournament.finished', 'tournaments', new.id, jsonb_build_object('name', new.name));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_tournaments on public.tournaments;
create trigger trg_audit_tournaments
  after update or delete on public.tournaments
  for each row execute function public.audit_tournament_changes();

create or replace function public.audit_cash_game_changes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_audit('cash_game.deleted', 'cash_games', old.id, jsonb_build_object('name', old.name));
    return old;
  elsif tg_op = 'UPDATE' and old.state <> 'finished' and new.state = 'finished' then
    perform public.log_audit('cash_game.finished', 'cash_games', new.id, jsonb_build_object('name', new.name));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_cash_games on public.cash_games;
create trigger trg_audit_cash_games
  after update or delete on public.cash_games
  for each row execute function public.audit_cash_game_changes();

create or replace function public.audit_bank_inserts()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.kind in ('manual_deposit', 'manual_withdrawal') then
    perform public.log_audit(
      'bank.' || new.kind,
      'bank_transactions',
      new.id,
      jsonb_build_object('amount', new.amount, 'guest_name', new.guest_name, 'profile_id', new.profile_id, 'note', new.note)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_bank on public.bank_transactions;
create trigger trg_audit_bank
  after insert on public.bank_transactions
  for each row execute function public.audit_bank_inserts();

-- ─────────────────────────────────────────── soft delete
-- A `deleted_at` column on tournaments + cash_games. Existing delete policies
-- are kept (so the audit trigger still fires), but the app now sets deleted_at
-- instead of issuing DELETE. Filter on `deleted_at IS NULL` in queries.

alter table public.tournaments add column if not exists deleted_at timestamptz;
alter table public.cash_games  add column if not exists deleted_at timestamptz;
create index if not exists idx_tournaments_not_deleted on public.tournaments(created_at) where deleted_at is null;
create index if not exists idx_cash_games_not_deleted  on public.cash_games(created_at)  where deleted_at is null;
