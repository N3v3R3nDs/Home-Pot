import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_INVENTORY, type ChipInventory } from '@/lib/chipSet';
import { setMuted } from '@/lib/sounds';
import { applyTheme, type ThemeId } from '@/lib/themes';

type Lang = 'en' | 'no';

interface SettingsState {
  currency: string;
  inventory: ChipInventory;
  soundEnabled: boolean;
  theme: ThemeId;
  language: Lang;
  largeText: boolean;
  setCurrency: (c: string) => void;
  setInventory: (inv: ChipInventory) => void;
  toggleSound: () => void;
  setTheme: (t: ThemeId) => void;
  setLanguage: (l: Lang) => void;
  toggleLargeText: () => void;
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
