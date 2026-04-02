import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AgeRange   = 'under18' | '18_25' | '26_35' | '36_45' | '46_55' | '56plus';
export type Gender     = 'male' | 'female';
export type SleepStruggle =
  | 'cant_fall_asleep' | 'wake_at_night' | 'early_waking'
  | 'unrefreshing'     | 'snoring'       | 'stress_anxiety'
  | 'sleep_too_late';
export type HealthCondition =
  | 'none' | 'anxiety_depression' | 'sleep_apnea'
  | 'chronic_pain' | 'shift_work'  | 'heart';
export type SleepGoal =
  | 'better_recovery' | 'more_energy'  | 'build_muscle'
  | 'lose_weight'     | 'reduce_stress' | 'track_habits';

export interface PlanRecommendation {
  title: string;
  body: string;
  color: string;
}

export interface PersonalPlan {
  sleepTarget: number;
  headline: string;
  recommendations: PlanRecommendation[];
  timeline: string;
}

export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';

interface UserProfileStore {
  ageRange:                 AgeRange | null;
  gender:                   Gender | null;
  sleepStruggles:           SleepStruggle[];
  healthConditions:         HealthCondition[];
  goals:                    SleepGoal[];
  personalPlan:             PersonalPlan | null;
  fitnessLevel:             FitnessLevel | null;
  healthKitPermissionAsked: boolean;
  profilePictureUri:        string | null;

  setProfile: (patch: Partial<Omit<UserProfileStore, 'setProfile'>>) => void;
}

export const useUserProfileStore = create<UserProfileStore>()(
  persist(
    (set) => ({
      ageRange:                 null,
      gender:                   null,
      sleepStruggles:           [],
      healthConditions:         [],
      goals:                    [],
      personalPlan:             null,
      fitnessLevel:             null,
      healthKitPermissionAsked: false,
      profilePictureUri:        null,

      setProfile: (patch) => set((state) => ({ ...state, ...patch })),
    }),
    {
      name: 'user-profile-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
