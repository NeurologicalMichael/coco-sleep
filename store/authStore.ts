import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';

interface AuthStore {
  userId: string | null;
  username: string | null;
  avatarUrl: string | null;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  loadSession: () => Promise<void>;
  signIn: (username: string, workoutDays: number, workoutIntensity: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUsername: (username: string) => Promise<void>;
  setAvatarUrl: (url: string) => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
  userId: null,
  username: null,
  avatarUrl: null,
  isAuthenticated: false,
  isAnonymous: true,

  loadSession: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        set({ userId: session.user.id, isAuthenticated: true, isAnonymous: session.user.is_anonymous ?? true });
        // Load username from profiles table
        const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', session.user.id).maybeSingle();
        if (profile?.username) set({ username: profile.username });
        if (profile?.avatar_url) set({ avatarUrl: profile.avatar_url });
      } else {
        // No session — sign in anonymously
        const { data, error } = await supabase.auth.signInAnonymously();
        if (!error && data.user) {
          set({ userId: data.user.id, isAuthenticated: true, isAnonymous: true });
        }
      }
    } catch {
      // Network unavailable — remain unauthenticated
    }

    // Keep store in sync with auth state changes
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        set({ userId: session.user.id, isAuthenticated: true, isAnonymous: session.user.is_anonymous ?? true });
      } else {
        set({ userId: null, isAuthenticated: false });
      }
    });
  },

  signIn: async (username, _workoutDays, _workoutIntensity) => {
    set({ username });
    try {
      const { userId } = get();
      if (userId) {
        await supabase.from('profiles').upsert({ id: userId, username }, { onConflict: 'id' });
      }
    } catch {
      // Non-blocking
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ userId: null, username: null, isAuthenticated: false });
  },

  setUsername: async (username: string) => {
    set({ username });
    try {
      const { userId } = get();
      if (userId) {
        await supabase.from('profiles').upsert({ id: userId, username }, { onConflict: 'id' });
      }
    } catch {
      // Non-blocking
    }
  },

  setAvatarUrl: async (url: string) => {
    set({ avatarUrl: url });
    try {
      const { userId } = get();
      if (userId) {
        await supabase.from('profiles').upsert({ id: userId, avatar_url: url }, { onConflict: 'id' });
      }
    } catch {
      // Non-blocking
    }
  },
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ userId: state.userId, username: state.username, avatarUrl: state.avatarUrl }),
    }
  )
);
