import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SleepDebtStore {
  /** Positive = owe sleep, negative = surplus. Capped at –8h surplus / 30h max debt. */
  debtHours: number;
  /** User's nightly sleep target. Default 8h. */
  targetHours: number;
  /** ISO date string (YYYY-MM-DD) of the last session recorded, to avoid double-counting. */
  lastUpdated: string | null;

  setTarget: (hours: number) => void;
  recordSession: (actualHours: number, date: string) => void;
  clearDebt: () => void;
}

export const useSleepDebtStore = create<SleepDebtStore>()(
  persist(
    (set) => ({
      debtHours: 0,
      targetHours: 8,
      lastUpdated: null,

      setTarget: (hours) => set({ targetHours: hours }),

      recordSession: (actualHours, date) =>
        set((state) => {
          if (state.lastUpdated === date) return state; // same night — don't double-count
          const delta = state.targetHours - actualHours; // positive → incurred debt, negative → paid off
          const newDebt = parseFloat(
            Math.min(Math.max(state.debtHours + delta, -8), 30).toFixed(2)
          );
          return { debtHours: newDebt, lastUpdated: date };
        }),

      clearDebt: () => set({ debtHours: 0, lastUpdated: null }),
    }),
    {
      name: 'sleep-debt-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
