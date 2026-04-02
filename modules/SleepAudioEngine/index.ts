import { Platform } from 'react-native';
import { requireNativeModule, EventEmitter } from 'expo-modules-core';

export interface NativeSoundEvent {
  type: 'quiet' | 'snoring' | 'talking' | 'loud_event';
  db: number;
  peakDb: number;
  timestamp: number; // ms since epoch
}

export interface NativeClipEvent {
  path: string;      // absolute file path (.caf)
  timestamp: number; // ms of triggering event
  type: string;      // 'snoring' | 'talking' | 'loud_event'
  duration: number;  // seconds
}

let Native: any = null;
let emitter: EventEmitter | null = null;

if (Platform.OS === 'ios') {
  try {
    Native = requireNativeModule('SleepAudioEngine');
    emitter = new EventEmitter(Native);
  } catch {
    // not available
  }
}

export const SleepAudioEngine = {
  isAvailable: Platform.OS === 'ios' && !!Native,

  permissionStatus: (): 'granted' | 'denied' | 'undetermined' => {
    if (!Native) return 'undetermined';
    return Native.permissionStatus();
  },

  requestPermission: async (): Promise<boolean> => {
    if (!Native) return false;
    return Native.requestPermission();
  },

  start: async (): Promise<boolean> => {
    if (!Native) return false;
    return Native.start();
  },

  stop: async (): Promise<void> => {
    if (!Native) return;
    return Native.stop();
  },

  isRunning: (): boolean => {
    if (!Native) return false;
    return Native.isRunning();
  },

  addSoundEventListener: (
    cb: (event: NativeSoundEvent) => void,
  ): (() => void) => {
    if (!emitter) return () => {};
    const sub = emitter.addListener('onSoundEvent', cb);
    return () => sub.remove();
  },

  addClipSavedListener: (
    cb: (event: NativeClipEvent) => void,
  ): (() => void) => {
    if (!emitter) return () => {};
    const sub = emitter.addListener('onClipSaved', cb);
    return () => sub.remove();
  },
};
