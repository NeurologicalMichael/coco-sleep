import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (__DEV__ && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.warn('[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — check your .env file.');
}

const keychainOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key, keychainOptions);
    } catch {
      // Item was stored with WHEN_UNLOCKED; delete it so next write uses AFTER_FIRST_UNLOCK
      try { await SecureStore.deleteItemAsync(key); } catch {}
      return null;
    }
  },
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, keychainOptions),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
