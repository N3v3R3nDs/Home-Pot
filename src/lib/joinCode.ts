import { supabase } from './supabase';

/**
 * 4-letter codes from a reduced alphabet (no I/O/0/1) — easy to read across
 * the room and dictate over a phone. ~330k possible codes; collision retry on
 * insert is the responsibility of the caller.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateJoinCode(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export type Resolved =
  | { kind: 'tournament'; id: string }
  | { kind: 'cash_game'; id: string }
  | null;

/** Look up which kind of game a code refers to. Tournaments take priority. */
export async function resolveJoinCode(rawCode: string): Promise<Resolved> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;
  const { data: t } = await supabase
    .from('tournaments').select('id').eq('join_code', code).maybeSingle();
  if (t?.id) return { kind: 'tournament', id: t.id as string };
  const { data: c } = await supabase
    .from('cash_games').select('id').eq('join_code', code).maybeSingle();
  if (c?.id) return { kind: 'cash_game', id: c.id as string };
  return null;
}
