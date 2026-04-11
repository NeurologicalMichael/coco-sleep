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

// XP thresholds for each cocoLevel (index = level - 1).
// Level 1→2 requires 50 XP, each subsequent level requires +50 XP more than the previous.
// Cumulative XP to reach level N = 25 * N * (N-1)
const COCO_LEVEL_XP_THRESHOLDS = [
  0,    // L1
  50,   // L2  (+50)
  150,  // L3  (+100)
  300,  // L4  (+150)
  500,  // L5  (+200)
  750,  // L6  (+250)
  1050, // L7  (+300)
  1400, // L8  (+350)
  1800, // L9  (+400)
  2250, // L10 (+450)
  2750, // L11 (+500)
  3300, // L12 (+550)
  3900, // L13 (+600)
  4550, // L14 (+650)
  5250, // L15 (+700)
];

function xpToCocoLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < COCO_LEVEL_XP_THRESHOLDS.length; i++) {
    if (xp >= COCO_LEVEL_XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export function cocoLevelXpProgress(xp: number): { current: number; needed: number; pct: number } {
  const level = xpToCocoLevel(xp);
  const currentFloor = COCO_LEVEL_XP_THRESHOLDS[level - 1] ?? 0;
  const nextThreshold = COCO_LEVEL_XP_THRESHOLDS[level] ?? null;
  if (nextThreshold === null) return { current: xp - currentFloor, needed: 0, pct: 100 };
  const span = nextThreshold - currentFloor;
  const progress = xp - currentFloor;
  return { current: progress, needed: span, pct: Math.round((progress / span) * 100) };
}

interface CocoStore {
  tier: number;
  xp: number;
  cocoXP: number;
  streak: number;
  longestStreak: number;
  totalSessions: number;
  mood: CocoMood;
  hasSeenOnboarding: boolean;
  cocoLevel: number;
  lastTrackedDate: string | null;
  lastCelebratedLevel: number;
  addXP: (amount: number) => { tieredUp: boolean; newTier: number };
  /** Add XP from a sleep score (score/2 XP) and derive new cocoLevel. */
  addSessionXP: (score: number) => { leveledUp: boolean; newLevel: number };
  incrementStreak: () => void;
  setMood: (mood: CocoMood) => void;
  updateFromScore: (score: number) => void;
  setHasSeenOnboarding: () => void;
  /** @deprecated – level now driven by addSessionXP */
  applySessionLevel: (score: number) => void;
  /** Call on app focus — decrements level for each missed day after the first. */
  applyMissedDayDecay: () => void;
  /** Mark that the level-up animation has been shown for this level. */
  markLevelCelebrated: (level: number) => void;
}

export const useCocoStore = create<CocoStore>()(
  persist(
    (set, get) => ({
      tier: 1, xp: 0, cocoXP: 0, streak: 0, longestStreak: 0, totalSessions: 0, mood: 'neutral', hasSeenOnboarding: false,
      cocoLevel: 1, lastTrackedDate: null, lastCelebratedLevel: 0,
      addSessionXP: (score) => {
        const { cocoXP, cocoLevel } = get();
        const gain = score; // XP = full sleep score
        const newXP = cocoXP + gain;
        const newLevel = xpToCocoLevel(newXP);
        set({ cocoXP: newXP, cocoLevel: newLevel, lastTrackedDate: todayStr() });
        return { leveledUp: newLevel > cocoLevel, newLevel };
      },
      addXP: (amount) => {
        const { xp, tier } = get();
        const newXP = xp + amount;
        const newTier = Math.min(Math.floor(newXP / 100) + 1, TIERS.length);
        set({ xp: newXP, tier: newTier });
        return { tieredUp: newTier > tier, newTier };
      },
      incrementStreak: () => {
        const { streak, longestStreak, totalSessions, lastTrackedDate } = get();
        const today = todayStr();
        // Already logged today (session ended today) — don't double-count
        if (lastTrackedDate === today) return;
        // lastTrackedDate === yesterday means previous session ended yesterday morning (last night).
        // A new session ending today = consecutive night → extend streak.
        // Any other date (older or null) = gap → reset to 1.
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const newStreak = lastTrackedDate === yesterday ? streak + 1 : 1;
        set({ streak: newStreak, longestStreak: Math.max(newStreak, longestStreak), totalSessions: totalSessions + 1 });
      },
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
        const { cocoLevel, lastTrackedDate, streak } = get();
        const today = todayStr();
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const updates: { streak?: number; cocoLevel?: number } = {};
        // Streak is only valid if the last session ended TODAY (i.e. they tracked last night).
        // lastTrackedDate = yesterday means their last session ended yesterday morning
        // (two nights ago) — they missed last night. null = never tracked. Both reset.
        const streakValid = lastTrackedDate === today;
        if (!streakValid && streak > 0) {
          updates.streak = 0;
        }
        // Level decay only when we have a real tracked date
        if (lastTrackedDate) {
          const missed = daysBetween(lastTrackedDate, today);
          if (missed > 1) {
            updates.cocoLevel = Math.max(cocoLevel - (missed - 1), 1);
          }
        }
        if (Object.keys(updates).length > 0) set(updates);
      },
      markLevelCelebrated: (level) => set({ lastCelebratedLevel: level }),
    }),
    {
      name: 'coco-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
