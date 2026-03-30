import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CoachSettings {
  bedtimeReminderEnabled: boolean;
  bedtimeReminderTime: string;
  windDownMinutes: number;
  slackingNudgesEnabled: boolean;
  slackingThreshold: number;
  morningReportEnabled: boolean;
  morningReportTime: string;
  screenTimeEnabled: boolean;
  blockedApps: string[];
  streakWarningEnabled: boolean;
  wakeTime: string;
  alarmEnabled: boolean;
  alarmTime: string;       // "HH:MM"
  alarmDays: number[];     // 0=Sun … 6=Sat
  shareLeagueStats: boolean; // share detailed stats with friends & groups (never global)
}

interface CoachStore {
  settings: CoachSettings;
  notificationsAuthorized: boolean;
  screenTimeAuthorized: boolean;
  selectedAppsCount: number;

  updateSettings: (patch: Partial<CoachSettings>) => void;
  setNotificationsAuthorized: (val: boolean) => void;
  setScreenTimeAuthorized: (val: boolean) => void;
  setSelectedAppsCount: (n: number) => void;
}

const DEFAULTS: CoachSettings = {
  bedtimeReminderEnabled: true,
  bedtimeReminderTime: '22:30',
  windDownMinutes: 30,
  slackingNudgesEnabled: true,
  slackingThreshold: 60,
  morningReportEnabled: true,
  morningReportTime: '07:30',
  screenTimeEnabled: false,
  blockedApps: [],
  streakWarningEnabled: true,
  wakeTime: '07:00',
  alarmEnabled: false,
  alarmTime: '07:00',
  alarmDays: [1, 2, 3, 4, 5],
  shareLeagueStats: true,
};

export const useCoachStore = create<CoachStore>()(
  persist(
    (set) => ({
      settings: DEFAULTS,
      notificationsAuthorized: false,
      screenTimeAuthorized: false,
      selectedAppsCount: 0,

      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      setNotificationsAuthorized: (val) => set({ notificationsAuthorized: val }),
      setScreenTimeAuthorized: (val) => set({ screenTimeAuthorized: val }),
      setSelectedAppsCount: (n) => set({ selectedAppsCount: n }),
    }),
    {
      name: 'coach-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
