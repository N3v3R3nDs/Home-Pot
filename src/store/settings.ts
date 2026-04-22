import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_INVENTORY, type ChipInventory } from '@/lib/chipSet';
import { setMuted } from '@/lib/sounds';
import { applyTheme, type ThemeId } from '@/lib/themes';

interface SettingsState {
  currency: string;
  inventory: ChipInventory;
  soundEnabled: boolean;
  theme: ThemeId;
  setCurrency: (c: string) => void;
  setInventory: (inv: ChipInventory) => void;
  toggleSound: () => void;
  setTheme: (t: ThemeId) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      currency: 'NOK',
      inventory: DEFAULT_INVENTORY,
      soundEnabled: true,
      theme: 'felt-green' as ThemeId,
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
    }),
    {
      name: 'home-pot-settings',
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme);
      },
    },
  ),
);
