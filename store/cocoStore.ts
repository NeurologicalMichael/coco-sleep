import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TIERS } from '../constants/tiers';

export type CocoMood = 'happy' | 'neutral' | 'tired' | 'dead';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

interface CocoStore {
  tier: number;
  xp: number;
  streak: number;
  longestStreak: number;
  totalSessions: number;
  mood: CocoMood;
  hasSeenOnboarding: boolean;
  cocoLevel: number;
  lastTrackedDate: string | null;
  lastCelebratedLevel: number;
  addXP: (amount: number) => { tieredUp: boolean; newTier: number };
  incrementStreak: () => void;
  setMood: (mood: CocoMood) => void;
  updateFromScore: (score: number) => void;
  setHasSeenOnboarding: () => void;
  /** Call after a session ends with the sleep score. Increments level if score > 60. */
  applySessionLevel: (score: number) => void;
  /** Call on app focus — decrements level for each missed day after the first. */
  applyMissedDayDecay: () => void;
  /** Mark that the level-up animation has been shown for this level. */
  markLevelCelebrated: (level: number) => void;
}

export const useCocoStore = create<CocoStore>()(
  persist(
    (set, get) => ({
      tier: 1, xp: 0, streak: 0, longestStreak: 0, totalSessions: 0, mood: 'neutral', hasSeenOnboarding: false,
      cocoLevel: 1, lastTrackedDate: null, lastCelebratedLevel: 0,
      addXP: (amount) => {
        const { xp, tier } = get();
        const newXP = xp + amount;
        const newTier = Math.min(Math.floor(newXP / 100) + 1, TIERS.length);
        set({ xp: newXP, tier: newTier });
        return { tieredUp: newTier > tier, newTier };
      },
      incrementStreak: () => set((s) => ({ streak: s.streak + 1, longestStreak: Math.max(s.streak + 1, s.longestStreak), totalSessions: s.totalSessions + 1 })),
      setMood: (mood) => set({ mood }),
      updateFromScore: (score) => set({ mood: score >= 80 ? 'happy' : score >= 60 ? 'neutral' : score >= 40 ? 'tired' : 'dead' }),
      setHasSeenOnboarding: () => set({ hasSeenOnboarding: true }),
      applySessionLevel: (score) => {
        const { cocoLevel, lastTrackedDate } = get();
        const today = todayStr();
        // Don't double-count if already tracked today
        if (lastTrackedDate === today) return;
        const newLevel = score > 60 ? cocoLevel + 1 : cocoLevel;
        set({ cocoLevel: Math.max(newLevel, 1), lastTrackedDate: today });
      },
      applyMissedDayDecay: () => {
        const { cocoLevel, lastTrackedDate } = get();
        if (!lastTrackedDate) return;
        const today = todayStr();
        const missed = daysBetween(lastTrackedDate, today);
        // First missed day = grace, then -1 per additional missed day
        if (missed > 1) {
          set({ cocoLevel: Math.max(cocoLevel - (missed - 1), 1) });
        }
      },
      markLevelCelebrated: (level) => set({ lastCelebratedLevel: level }),
    }),
    {
      name: 'coco-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
