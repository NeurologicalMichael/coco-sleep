/**
 * activityStore.ts
 * Daily step count (via pedometer) and water intake tracking.
 * Both reset automatically at midnight.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

interface ActivityStore {
  steps:         number;
  stepGoal:      number;
  lastStepDate:  string;

  waterIntake:   number;   // glasses
  waterGoal:     number;   // glasses
  lastWaterDate: string;

  setSteps:     (n: number) => void;
  addStepDelta: (n: number) => void;
  setStepGoal:  (n: number) => void;

  addWater:    (glasses?: number) => void;
  removeWater: () => void;
  setWaterGoal:(n: number) => void;

  checkDailyReset: () => void;
}

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => ({
      steps:         0,
      stepGoal:      10_000,
      lastStepDate:  todayStr(),

      waterIntake:   0,
      waterGoal:     8,
      lastWaterDate: todayStr(),

      // ── Steps ────────────────────────────────────────────────────────────
      setSteps: (n) => set({ steps: n, lastStepDate: todayStr() }),

      addStepDelta: (n) => {
        const t = todayStr();
        if (get().lastStepDate !== t) {
          set({ steps: n, lastStepDate: t });
        } else {
          set((s) => ({ steps: s.steps + n }));
        }
      },

      setStepGoal: (n) => set({ stepGoal: n }),

      // ── Water ────────────────────────────────────────────────────────────
      addWater: (glasses = 1) => {
        const t = todayStr();
        if (get().lastWaterDate !== t) {
          set({ waterIntake: glasses, lastWaterDate: t });
        } else {
          set((s) => ({ waterIntake: Math.min(s.waterIntake + glasses, s.waterGoal + 5) }));
        }
      },

      removeWater: () =>
        set((s) => ({ waterIntake: Math.max(s.waterIntake - 1, 0) })),

      setWaterGoal: (n) => set({ waterGoal: n }),

      // ── Daily reset ───────────────────────────────────────────────────────
      checkDailyReset: () => {
        const t = todayStr();
        const { lastStepDate, lastWaterDate } = get();
        if (lastStepDate  !== t) set({ steps:       0, lastStepDate:  t });
        if (lastWaterDate !== t) set({ waterIntake: 0, lastWaterDate: t });
      },
    }),
    {
      name:    'coco-activity',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
