import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SeasonState {
  /** ID of the season currently filtering Stats. null = "all time". */
  activeSeasonId: string | null;
  setActiveSeasonId: (id: string | null) => void;
}

export const useSeason = create<SeasonState>()(
  persist(
    (set) => ({
      activeSeasonId: null,
      setActiveSeasonId: (id) => set({ activeSeasonId: id }),
    }),
    { name: 'home-pot-season' },
  ),
);
