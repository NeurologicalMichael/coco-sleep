/**
 * widgetSync.ts
 * Writes Coco state to the shared App Group UserDefaults so the
 * lock screen / home screen widget stays up to date.
 *
 * Requires native build (expo run:ios) with App Group entitlement:
 *   group.com.breibart.coco
 *
 * No-ops gracefully in Expo Go.
 */

import { NativeModules } from 'react-native';

// Expo SharedPreferences / App Group bridge (set up in app.json plugins)
let SharedGroupPreferences: any = null;
try {
  SharedGroupPreferences = require('react-native-shared-group-preferences').default;
} catch {
  // Not available in Expo Go
}

const APP_GROUP = 'group.com.breibart.coco';

export interface WidgetState {
  recoveryScore: number | null;
  streak: number;
  tierName: string;
  mood: string;
  isTracking: boolean;
  bedtimeTime: string; // "HH:MM" e.g. "22:30"
  wakeTime: string;    // "HH:MM" e.g. "07:00"
  cocoLevel: string;   // "bad" | "normal" | "leather" | "gold" | "diamond"
  cocoLevelNum?: number; // numeric level from cocoStore (1, 2, 3 …)
}

export async function syncWidgetState(state: WidgetState): Promise<void> {
  if (!SharedGroupPreferences) return;

  try {
    await SharedGroupPreferences.setItem('recoveryScore', state.recoveryScore ?? 0, APP_GROUP);
    await SharedGroupPreferences.setItem('streak', state.streak, APP_GROUP);
    await SharedGroupPreferences.setItem('tierName', state.tierName, APP_GROUP);
    await SharedGroupPreferences.setItem('mood', state.mood, APP_GROUP);
    await SharedGroupPreferences.setItem('isTracking', state.isTracking ? 1 : 0, APP_GROUP);
    await SharedGroupPreferences.setItem('bedtimeTime', state.bedtimeTime, APP_GROUP);
    await SharedGroupPreferences.setItem('wakeTime', state.wakeTime, APP_GROUP);
    await SharedGroupPreferences.setItem('cocoLevel', state.cocoLevel, APP_GROUP);
    if (state.cocoLevelNum !== undefined) {
      await SharedGroupPreferences.setItem('cocoLevelNum', state.cocoLevelNum, APP_GROUP);
    }

    // Tell WidgetKit to reload timelines
    const { WidgetKit } = NativeModules;
    WidgetKit?.reloadAllTimelines?.();
  } catch (e) {
    // Silently fail in dev
  }
}
