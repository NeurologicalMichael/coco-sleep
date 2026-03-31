import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WorkoutType = 'strength' | 'cardio' | 'hiit' | 'rest';

export interface WorkoutEntry {
  id: string;
  date: string;          // YYYY-MM-DD
  durationMinutes: number;
  intensity: number;     // 1–10
  type: WorkoutType;
  load: number;          // TRIMP-inspired: duration × intensityFactor
}

/** TRIMP intensity factor mapping */
export function intensityFactor(intensity: number): number {
  if (intensity <= 3) return 1.0;   // light
  if (intensity <= 6) return 1.5;   // moderate
  if (intensity <= 8) return 2.0;   // hard
  return 2.5;                        // very hard
}

export function calcLoad(durationMinutes: number, intensity: number): number {
  return Math.round(durationMinutes * intensityFactor(intensity));
}

interface WorkoutStore {
  entries: WorkoutEntry[];
  logWorkout: (date: string, type: WorkoutType, durationMinutes: number, intensity: number) => void;
  getForDate: (date: string) => WorkoutEntry | null;
  getRecent: (days: number) => WorkoutEntry[];
  clearForDate: (date: string) => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const useWorkoutStore = create<WorkoutStore>()(
  persist(
    (set, get) => ({
      entries: [],

      logWorkout: (date, type, durationMinutes, intensity) => {
        const load = calcLoad(durationMinutes, intensity);
        const entry: WorkoutEntry = {
          id: `workout_${date}_${Date.now()}`,
          date,
          durationMinutes,
          intensity,
          type,
          load,
        };
        set((state) => {
          // Replace existing entry for same date
          const filtered = state.entries.filter((e) => e.date !== date);
          return { entries: [entry, ...filtered].slice(0, 90) };
        });
      },

      getForDate: (date) => {
        return get().entries.find((e) => e.date === date) ?? null;
      },

      getRecent: (days) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return get().entries.filter((e) => e.date >= cutoffStr);
      },

      clearForDate: (date) => {
        set((state) => ({ entries: state.entries.filter((e) => e.date !== date) }));
      },
    }),
    {
      name: 'workout-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
