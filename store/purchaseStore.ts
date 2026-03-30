import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PurchaseStore {
  isPremium:   boolean;
  isTrialing:  boolean;
  trialEndsAt: string | null; // ISO string — serialises cleanly to AsyncStorage
  setPremium:  (val: boolean, isTrialing?: boolean, trialEndsAt?: string | null) => void;
  reset:       () => void;
}

export const usePurchaseStore = create<PurchaseStore>()(
  persist(
    (set) => ({
      isPremium:   true,
      isTrialing:  false,
      trialEndsAt: null,

      setPremium: (val, isTrialing = false, trialEndsAt = null) =>
        set({ isPremium: val, isTrialing, trialEndsAt }),

      reset: () => set({ isPremium: false, isTrialing: false, trialEndsAt: null }),
    }),
    {
      name: 'purchase-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
