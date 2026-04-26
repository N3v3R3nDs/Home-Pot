import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_INVENTORY, type ChipInventory } from '@/lib/chipSet';
import { setMuted } from '@/lib/sounds';
import { applyTheme, type ThemeId } from '@/lib/themes';

type Lang = 'en' | 'no';

export type DefaultTournamentType = 'rebuy' | 'freezeout' | 'reentry' | 'bounty';
export interface TournamentDefaults {
  buyIn: number;
  bountyAmount: number;
  rebuyAmount: number;
  addonAmount: number;
  rebuysUntilLevel: number;
  rakePercent: number;
  dealerTipPercent: number;
  tournamentType: DefaultTournamentType;
}

export const DEFAULT_TOURNAMENT_DEFAULTS: TournamentDefaults = {
  buyIn: 200,
  bountyAmount: 0,
  rebuyAmount: 200,
  addonAmount: 200,
  rebuysUntilLevel: 6,
  rakePercent: 0,
  dealerTipPercent: 0,
  tournamentType: 'rebuy',
};

interface SettingsState {
  currency: string;
  inventory: ChipInventory;
  soundEnabled: boolean;
  theme: ThemeId;
  language: Lang;
  largeText: boolean;
  tournamentDefaults: TournamentDefaults;
  setCurrency: (c: string) => void;
  setInventory: (inv: ChipInventory) => void;
  toggleSound: () => void;
  setTheme: (t: ThemeId) => void;
  setLanguage: (l: Lang) => void;
  toggleLargeText: () => void;
  setTournamentDefaults: (d: TournamentDefaults) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      currency: 'NOK',
      inventory: DEFAULT_INVENTORY,
      soundEnabled: true,
      theme: 'felt-green' as ThemeId,
      language: 'no' as Lang,
      largeText: false,
      tournamentDefaults: DEFAULT_TOURNAMENT_DEFAULTS,
      setCurrency: (c) => set({ currency: c }),
      setInventory: (inv) => set({ inventory: inv }),
      toggleSound: () => {
        const next = !get().soundEnabled;
        set({ soundEnabled: next });
        setMuted(!next);
      },
      setTheme: (t) => {
        set({ theme: t });
        applyTheme(t);
      },
      setLanguage: (l) => set({ language: l }),
      setTournamentDefaults: (d) => set({ tournamentDefaults: d }),
      toggleLargeText: () => {
        const next = !get().largeText;
        set({ largeText: next });
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('large-text', next);
        }
      },
    }),
    {
      name: 'home-pot-settings',
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme);
        if (state?.largeText && typeof document !== 'undefined') {
          document.documentElement.classList.add('large-text');
        }
      },
    },
  ),
);
