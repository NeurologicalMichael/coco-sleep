/**
 * soundClipsStore
 *
 * Stores overnight sound clip metadata.
 * Raw audio files (.caf) live on disk; this store tracks paths + user actions.
 * Auto-deletes unsaved clips older than AUTO_DELETE_DAYS days.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const AUTO_DELETE_DAYS = 3;

export type ClipType = 'snoring' | 'talking' | 'loud_event';

export interface SoundClip {
  id: string;
  sessionDate: string;      // YYYY-MM-DD
  timestamp: number;        // ms since epoch (when event was detected)
  filePath: string;         // absolute path to .caf file
  type: ClipType;
  durationSeconds: number;
  saved: boolean;           // user starred/saved — never auto-deleted
  label?: string;           // user-set custom name
}

interface SoundClipsState {
  clips: SoundClip[];
  addClip: (clip: Omit<SoundClip, 'id' | 'saved'>) => void;
  saveClip: (id: string) => void;
  unsaveClip: (id: string) => void;
  renameClip: (id: string, label: string) => void;
  deleteClip: (id: string) => Promise<void>;
  getClipsForDate: (date: string) => SoundClip[];
  deleteOldUnsaved: () => Promise<void>;
  clearAllUnsaved: () => Promise<void>;
}

export const useSoundClipsStore = create<SoundClipsState>()(
  persist(
    (set, get) => ({
      clips: [],

      addClip: (clip) => {
        const id = `${clip.sessionDate}_${clip.timestamp}`;
        // Deduplicate by id
        if (get().clips.some((c) => c.id === id)) return;
        const entry: SoundClip = {
          ...clip,
          id,
          saved: false,
          type: (clip.type as ClipType) ?? 'loud_event',
        };
        set((s) => ({ clips: [entry, ...s.clips] }));
      },

      saveClip: (id) =>
        set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, saved: true } : c) })),

      unsaveClip: (id) =>
        set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, saved: false } : c) })),

      renameClip: (id, label) =>
        set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, label } : c) })),

      deleteClip: async (id) => {
        const clip = get().clips.find((c) => c.id === id);
        if (clip) {
          try { await FileSystem.deleteAsync(clip.filePath, { idempotent: true }); } catch { /* ok */ }
        }
        set((s) => ({ clips: s.clips.filter((c) => c.id !== id) }));
      },

      getClipsForDate: (date) =>
        get().clips.filter((c) => c.sessionDate === date),

      deleteOldUnsaved: async () => {
        const cutoff = Date.now() - AUTO_DELETE_DAYS * 86_400_000;
        const toDelete = get().clips.filter((c) => !c.saved && c.timestamp < cutoff);
        await Promise.all(
          toDelete.map((c) =>
            FileSystem.deleteAsync(c.filePath, { idempotent: true }).catch(() => {})
          )
        );
        set((s) => ({
          clips: s.clips.filter((c) => c.saved || c.timestamp >= cutoff),
        }));
      },

      clearAllUnsaved: async () => {
        const toDelete = get().clips.filter((c) => !c.saved);
        await Promise.all(
          toDelete.map((c) =>
            FileSystem.deleteAsync(c.filePath, { idempotent: true }).catch(() => {})
          )
        );
        set((s) => ({ clips: s.clips.filter((c) => c.saved) }));
      },
    }),
    {
      name: 'sound-clips-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
