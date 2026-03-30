import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MovementEvent, AudioEvent } from '../utils/hrvProxy';
import { SleepPhase, SleepStage } from '../utils/sleepScore';

export type DataSource = 'phone' | 'watch';

export interface SleepSession {
  id: string;
  date: string;
  startedAt: number;
  endedAt?: number;
  movementEvents: MovementEvent[];
  audioEvents: AudioEvent[];       // mic samples (phone tracking only)
  disruptionCount: number;
  isActive: boolean;
  dataSource: DataSource;
  watchHRV: number | null;
  watchHeartRate: number | null;
  sleepOnsetAt: number | null;        // epoch ms when sleep was detected
  sleepLatencyMinutes: number | null; // minutes from session start to sleep onset
}

interface SleepStore {
  activeSession: SleepSession | null;
  currentPhase: SleepPhase;
  currentStage: SleepStage;        // live Pokémon-style stage for the tracking UI
  dataSource: DataSource;
  pendingWidgetToggle: boolean;    // set by _layout when widget button is tapped
  setDataSource: (source: DataSource) => void;
  setPendingWidgetToggle: (val: boolean) => void;
  startSession: () => void;
  endSession: () => SleepSession | null;
  addMovementEvent: (event: MovementEvent) => void;
  addAudioEvent: (event: AudioEvent) => void;
  incrementDisruption: () => void;
  setPhase: (phase: SleepPhase) => void;
  setStage: (stage: SleepStage) => void;
  setSleepOnset: (ts: number) => void;
  patchWatchData: (data: {
    movementEvents: MovementEvent[];
    disruptionCount: number;
    watchHRV: number | null;
    watchHeartRate: number | null;
  }) => void;
}

export const useSleepStore = create<SleepStore>()(
  persist(
    (set, get) => ({
      activeSession: null,
      currentPhase: 'light',
      currentStage: 'dozing',
      dataSource: 'phone',
      pendingWidgetToggle: false,

      setDataSource: (dataSource) => set({ dataSource }),
      setPendingWidgetToggle: (pendingWidgetToggle) => set({ pendingWidgetToggle }),

      startSession: () => {
        const { dataSource } = get();
        set({
          activeSession: {
            id: `session_${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            startedAt: Date.now(),
            movementEvents: [],
            audioEvents: [],
            disruptionCount: 0,
            isActive: true,
            dataSource,
            watchHRV: null,
            watchHeartRate: null,
            sleepOnsetAt: null,
            sleepLatencyMinutes: null,
          },
          currentPhase: 'light',
          currentStage: 'dozing',
        });
      },

      endSession: () => {
        const s = get().activeSession;
        if (!s) return null;
        const ended = { ...s, endedAt: Date.now(), isActive: false };
        set({ activeSession: null });
        return ended;
      },

      addMovementEvent: (event) => set((state) => ({
        activeSession: state.activeSession
          ? { ...state.activeSession, movementEvents: [...state.activeSession.movementEvents, event] }
          : null,
      })),

      addAudioEvent: (event) => set((state) => ({
        activeSession: state.activeSession
          ? { ...state.activeSession, audioEvents: [...state.activeSession.audioEvents, event] }
          : null,
      })),

      incrementDisruption: () => set((state) => ({
        activeSession: state.activeSession
          ? { ...state.activeSession, disruptionCount: state.activeSession.disruptionCount + 1 }
          : null,
      })),

      setPhase: (currentPhase) => set({ currentPhase }),
      setStage: (currentStage) => set({ currentStage }),

      setSleepOnset: (ts) => set((state) => ({
        activeSession: state.activeSession
          ? { ...state.activeSession, sleepOnsetAt: ts }
          : null,
      })),

      patchWatchData: (data) => set((state) => ({
        activeSession: state.activeSession ? { ...state.activeSession, ...data } : null,
      })),
    }),
    {
      name: 'sleep-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
