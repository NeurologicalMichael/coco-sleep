import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecoveryEngineOutput } from '../utils/recoveryEngine';
import { SleepScoreResult } from '../utils/sleepScore';
import { AudioEvent, MovementEvent } from '../utils/hrvProxy';
import { useAuthStore } from './authStore';
import { useCocoStore } from './cocoStore';
import { uploadScore, UploadScoreDetails } from '../lib/leaderboard';
import { useSleepDebtStore } from './sleepDebtStore';
import { useCoachStore } from './coachStore';

export interface ProcessedSession {
  id: string;
  date: string;
  durationHours: number;
  scores: SleepScoreResult;
  recovery: RecoveryEngineOutput;
  dataSource?: 'phone' | 'watch';
  watchHeartRate?: number | null;
  watchHRV?: number | null;
  audioEvents?: AudioEvent[];
  movementEvents?: MovementEvent[];  // retained for charting
}

const MIN_SESSION_HOURS = 10 / 60; // 10 minutes

/** Validate a session before storing — guards against corrupt/edge-case data. */
function isValidSession(s: ProcessedSession): boolean {
  if (!s.id || !s.date) return false;
  if (!isFinite(s.durationHours) || s.durationHours < MIN_SESSION_HOURS || s.durationHours > 24) return false;
  if (!isFinite(s.recovery.recoveryScore)) return false;
  if (!isFinite(s.scores.sleepScore)) return false;
  return true;
}

interface RecoveryStore {
  latestSession: ProcessedSession | null;
  history: ProcessedSession[];
  setLatestSession: (s: ProcessedSession) => void;
  addToHistory: (s: ProcessedSession) => void;
  purgeShortSessions: () => void;
}

export const useRecoveryStore = create<RecoveryStore>()(
  persist(
    (set) => ({
      latestSession: null,
      history: [],
      setLatestSession: (s) => {
        if (!isValidSession(s)) {
          if (__DEV__) console.warn('[RecoveryStore] Rejected invalid session:', s.id, s.durationHours);
          return;
        }
        set({ latestSession: s });
        const { userId, isAuthenticated } = useAuthStore.getState();
        const { streak } = useCocoStore.getState();
        const { settings } = useCoachStore.getState();
        if (isAuthenticated && userId) {
          const details: UploadScoreDetails | undefined = settings.shareLeagueStats ? {
            sleepDurationMins: s.durationHours * 60,
            efficiencyPct:     s.scores.sleepScore,   // sleep quality score 0-100
            hrvScore:          s.recovery.hrvProxy,
          } : undefined;
          uploadScore(userId, s.date, s.recovery.recoveryScore, streak, details).catch((err) => {
            if (__DEV__) console.warn('[RecoveryStore] Score upload failed:', err);
          });
        }
        useSleepDebtStore.getState().recordSession(s.durationHours, s.date);
      },
      addToHistory: (s) => {
        if (!isValidSession(s)) return;
        set((state) => {
          const existingIdx = state.history.findIndex((h) => h.date === s.date);
          if (existingIdx >= 0) {
            // Same date — merge into one combined entry instead of adding a new tab
            const prev = state.history[existingIdx];
            const totalDur = prev.durationHours + s.durationHours;
            const w1 = prev.durationHours / totalDur;
            const w2 = s.durationHours / totalDur;
            const merged: ProcessedSession = {
              ...prev,
              durationHours: totalDur,
              movementEvents: [...(prev.movementEvents ?? []), ...(s.movementEvents ?? [])],
              audioEvents:    [...(prev.audioEvents    ?? []), ...(s.audioEvents    ?? [])],
              scores: {
                ...prev.scores,
                sleepScore: Math.round(prev.scores.sleepScore * w1 + s.scores.sleepScore * w2),
              },
              recovery: {
                ...prev.recovery,
                recoveryScore: Math.round(prev.recovery.recoveryScore * w1 + s.recovery.recoveryScore * w2),
                hrvProxy:      Math.round((prev.recovery.hrvProxy ?? 0) * w1 + (s.recovery.hrvProxy ?? 0) * w2),
              },
            };
            const updated = [...state.history];
            updated[existingIdx] = merged;
            return { history: updated };
          }
          return { history: [s, ...state.history].slice(0, 90) };
        });
      },
      purgeShortSessions: () => {
        set((state) => ({
          history: state.history.filter((s) => s.durationHours >= MIN_SESSION_HOURS),
          latestSession:
            state.latestSession && state.latestSession.durationHours < MIN_SESSION_HOURS
              ? null
              : state.latestSession,
        }));
      },
    }),
    {
      name: 'recovery-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
