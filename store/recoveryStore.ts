import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_BACKUP_KEY = 'coco-history-backup';
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
  // Allow up to 36h to handle merged same-day sessions or very long naps
  if (!isFinite(s.durationHours) || s.durationHours < MIN_SESSION_HOURS || s.durationHours > 36) return false;
  if (!isFinite(s.recovery.recoveryScore)) return false;
  if (!isFinite(s.scores.sleepScore)) return false;
  return true;
}

/** Write history to a secondary backup key. Called after every successful save. */
async function writeHistoryBackup(history: ProcessedSession[]): Promise<void> {
  try {
    if (history.length > 0) {
      await AsyncStorage.setItem(HISTORY_BACKUP_KEY, JSON.stringify(history));
    }
  } catch {
    // Non-blocking — backup failure should never break the app
  }
}

/** Attempt to restore history from the backup key. Returns [] if nothing found. */
async function readHistoryBackup(): Promise<ProcessedSession[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProcessedSession[];
    return Array.isArray(parsed) ? parsed.filter(isValidSession) : [];
  } catch {
    return [];
  }
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
          let nextHistory: ProcessedSession[];
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
            nextHistory = updated;
          } else {
            nextHistory = [s, ...state.history].slice(0, 90);
          }
          // Write backup asynchronously — never blocks or fails the save
          void writeHistoryBackup(nextHistory);
          return { history: nextHistory };
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
      onRehydrateStorage: () => (state) => {
        // If the main store hydrated with no history, try to recover from backup
        if (state && state.history.length === 0) {
          void readHistoryBackup().then((backup) => {
            if (backup.length > 0) {
              if (__DEV__) console.warn('[RecoveryStore] Main history empty — restoring from backup:', backup.length, 'sessions');
              useRecoveryStore.setState({ history: backup });
            }
          });
        }
      },
    }
  )
);
