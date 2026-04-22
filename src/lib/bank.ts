/**
 * Bank account helpers — every player can hold a chip balance with the host
 * across nights. Accounts are keyed by either profile_id (registered friend)
 * or guest_name (recurring guest). Balance is a derived sum of transactions.
 */
import { supabase } from './supabase';

export type BankKind =
  | 'cash_buy_in'
  | 'cash_close'
  | 'tournament_buy_in'
  | 'tournament_prize'
  | 'manual_deposit'
  | 'manual_withdrawal'
  | 'transfer'
  | 'adjustment';

export interface BankTransaction {
  id: string;
  profile_id: string | null;
  guest_name: string | null;
  amount: number;
  currency: string;
  kind: BankKind;
  ref_table: string | null;
  ref_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BankBalance {
  profile_id: string | null;
  guest_name: string | null;
  currency: string;
  balance: number;
  tx_count: number;
  last_activity: string;
}

export function bankAccountKey(p: { profile_id?: string | null; guest_name?: string | null }): string {
  if (p.profile_id) return `p:${p.profile_id}`;
  if (p.guest_name) return `g:${p.guest_name}`;
  return 'unknown';
}

/** Atomic helper: insert a single bank transaction. */
export async function recordBankTx(tx: {
  profile_id?: string | null;
  guest_name?: string | null;
  amount: number;
  currency: string;
  kind: BankKind;
  ref_table?: string;
  ref_id?: string;
  note?: string;
  created_by?: string;
}) {
  const { error } = await supabase.from('bank_transactions').insert({
    profile_id: tx.profile_id ?? null,
    guest_name: tx.guest_name ?? null,
    amount: tx.amount,
    currency: tx.currency,
    kind: tx.kind,
    ref_table: tx.ref_table ?? null,
    ref_id: tx.ref_id ?? null,
    note: tx.note ?? null,
    created_by: tx.created_by ?? null,
  });
  if (error) throw error;
}
