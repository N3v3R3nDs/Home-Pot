-- Home Pot — the Bank
-- Persistent per-player chip balances across game nights. People often leave
-- chips with the host instead of cashing out — this models that.
--
-- Accounts are keyed by (profile_id, guest_name) — one of the two is set.
-- A guest account can later be merged into a registered profile (future work).

create table if not exists public.bank_transactions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  guest_name   text,
  amount       numeric not null,           -- + = credit (into bank), - = debit (out of bank)
  currency     text not null default 'NOK',
  kind         text not null check (kind in (
    'cash_buy_in',         -- buy-in paid out of bank (negative)
    'cash_close',          -- end-of-cash-game leftover left in bank (positive)
    'tournament_buy_in',   -- tournament buy-in paid from bank (negative)
    'tournament_prize',    -- tournament prize left in bank (positive)
    'manual_deposit',      -- host adds money/chips to a player's bank
    'manual_withdrawal',   -- player withdraws from their bank
    'transfer',            -- player-to-player adjustment
    'adjustment'           -- catch-all manual fix
  )),
  ref_table    text,                       -- e.g. 'cash_games', 'tournaments'
  ref_id       uuid,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (profile_id is not null or guest_name is not null)
);

create index if not exists idx_bank_profile on public.bank_transactions(profile_id);
create index if not exists idx_bank_guest on public.bank_transactions(guest_name);
create index if not exists idx_bank_ref on public.bank_transactions(ref_table, ref_id);

-- Convenience view: current balance per account.
-- One row per (profile_id, guest_name) tuple.
create or replace view public.bank_balances as
select
  profile_id,
  guest_name,
  currency,
  sum(amount)         as balance,
  count(*)            as tx_count,
  max(created_at)     as last_activity
from public.bank_transactions
group by profile_id, guest_name, currency
having sum(amount) <> 0 or count(*) > 0;

-- Realtime
alter publication supabase_realtime add table public.bank_transactions;

-- RLS — friend-group trust: any auth user can read AND write
alter table public.bank_transactions enable row level security;

create policy "auth read bank"   on public.bank_transactions for select using (auth.role() = 'authenticated');
create policy "auth write bank"  on public.bank_transactions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Views inherit RLS from the underlying table; no separate policy needed.
grant select on public.bank_balances to anon, authenticated;
