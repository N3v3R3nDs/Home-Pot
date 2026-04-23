/**
 * Hand-written DB types for Home Pot. Mirrors supabase/migrations/00-init.sql.
 * Regenerate with `supabase gen types typescript` once the schema stabilises.
 */

export interface BlindLevel {
  level: number;
  sb: number;
  bb: number;
  ante?: number;
  durationMin: number;
  /** If true, a break starts when this level ends. */
  breakAfter?: boolean;
  /** Length of the break in minutes (if breakAfter). */
  breakMin?: number;
}

export interface PayoutSlot {
  place: number;
  percent: number;
}

export interface ChipDistribution {
  /** Per-player starting stack as denomination → count map. */
  [denomination: string]: number;
}

export type TournamentState = 'setup' | 'running' | 'paused' | 'finished';
export type TournamentType = 'rebuy' | 'freezeout' | 'reentry' | 'bounty';
export type CashGameState = 'running' | 'finished';

export interface Profile {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  host_id: string;
  name: string;
  currency: string;
  started_at: string;
  ended_at: string | null;
}

export interface SessionParticipant {
  id: string;
  session_id: string;
  profile_id: string | null;
  guest_name: string | null;
  added_at: string;
}

export interface Tournament {
  id: string;
  session_id: string | null;
  host_id: string;
  name: string;
  buy_in: number;
  rebuy_amount: number | null;
  addon_amount: number | null;
  starting_stack: number;
  rebuy_stack: number | null;
  addon_stack: number | null;
  bounty_amount: number;
  rebuys_until_level: number;
  blind_structure: BlindLevel[];
  payout_structure: PayoutSlot[];
  chip_distribution: ChipDistribution | null;
  state: TournamentState;
  current_level: number;
  level_started_at: string | null;
  paused_at: string | null;
  pause_elapsed_ms: number;
  currency: string;
  join_code: string | null;
  rake_percent: number;
  dealer_tip_percent: number;
  tournament_type: TournamentType;
  season_id: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface TournamentTemplate {
  id: string;
  owner_id: string;
  name: string;
  buy_in: number;
  rebuy_amount: number | null;
  addon_amount: number | null;
  starting_stack: number;
  rebuy_stack: number | null;
  addon_stack: number | null;
  bounty_amount: number;
  rebuys_until_level: number;
  blind_structure: BlindLevel[];
  payout_structure: PayoutSlot[];
  rake_percent: number;
  dealer_tip_percent: number;
  currency: string;
  created_at: string;
}

export interface Season {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  created_at: string;
}

export interface TournamentPlayer {
  id: string;
  tournament_id: string;
  profile_id: string | null;
  guest_name: string | null;
  buy_ins: number;
  rebuys: number;
  addons: number;
  bounties_won: number;
  finishing_position: number | null;
  eliminated_by: string | null;
  eliminated_at: string | null;
  prize: number;
  late_reg: boolean;
  entry_level: number | null;
  created_at: string;
}

export interface CashGame {
  id: string;
  session_id: string | null;
  host_id: string;
  name: string;
  small_blind: number | null;
  big_blind: number | null;
  currency: string;
  state: CashGameState;
  join_code: string | null;
  season_id: string | null;
  deleted_at: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface CashGamePlayer {
  id: string;
  cash_game_id: string;
  profile_id: string | null;
  guest_name: string | null;
  cash_out: number | null;
  created_at: string;
}

export interface CashBuyIn {
  id: string;
  cash_game_player_id: string;
  amount: number;
  created_at: string;
}

// Minimal Database shape used by the typed Supabase client.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string; display_name: string }; Update: Partial<Profile> };
      sessions: { Row: Session; Insert: Partial<Session> & { host_id: string; name: string }; Update: Partial<Session> };
      session_participants: { Row: SessionParticipant; Insert: Partial<SessionParticipant> & { session_id: string }; Update: Partial<SessionParticipant> };
      tournaments: { Row: Tournament; Insert: Partial<Tournament> & { host_id: string; name: string; buy_in: number; starting_stack: number; blind_structure: BlindLevel[]; payout_structure: PayoutSlot[] }; Update: Partial<Tournament> };
      tournament_players: { Row: TournamentPlayer; Insert: Partial<TournamentPlayer> & { tournament_id: string }; Update: Partial<TournamentPlayer> };
      cash_games: { Row: CashGame; Insert: Partial<CashGame> & { host_id: string; name: string }; Update: Partial<CashGame> };
      cash_game_players: { Row: CashGamePlayer; Insert: Partial<CashGamePlayer> & { cash_game_id: string }; Update: Partial<CashGamePlayer> };
      cash_buy_ins: { Row: CashBuyIn; Insert: Partial<CashBuyIn> & { cash_game_player_id: string; amount: number }; Update: Partial<CashBuyIn> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
