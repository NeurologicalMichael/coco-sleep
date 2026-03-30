import { Platform } from 'react-native';

let Native: any = null;
try {
  if (Platform.OS === 'ios') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Native = require('expo-modules-core').requireNativeModule('ScreenTimeManager');
  }
} catch {
  // Not available in Expo Go or simulator without entitlement
}

const isAvailable = Platform.OS === 'ios' && !!Native;

export const ScreenTimeManager = {
  isAvailable,

  requestAuthorization: async (): Promise<boolean> => {
    if (!isAvailable) return false;
    return Native.requestAuthorization();
  },

  getAuthorizationStatus: (): 'approved' | 'denied' | 'notDetermined' => {
    if (!isAvailable) return 'notDetermined';
    return Native.getAuthorizationStatus();
  },

  /** Opens the native FamilyActivityPicker sheet. Returns count of selected apps/categories. */
  presentAppPicker: async (): Promise<number> => {
    if (!isAvailable) return 0;
    return Native.presentAppPicker();
  },

  /** Returns the count of currently saved app + category selections. */
  getSelectedAppsCount: (): number => {
    if (!isAvailable) return 0;
    return Native.getSelectedAppsCount();
  },

  startSleepBlock: async (bundleIds: string[], durationMinutes: number): Promise<boolean> => {
    if (!isAvailable) return false;
    return Native.startSleepBlock(bundleIds, durationMinutes);
  },

  stopSleepBlock: (): boolean => {
    if (!isAvailable) return false;
    return Native.stopSleepBlock();
  },

  scheduleNightlyBlock: async (
    startHour: number,
    startMinute: number,
    endHour: number,
    endMinute: number,
  ): Promise<boolean> => {
    if (!isAvailable) return false;
    return Native.scheduleNightlyBlock(startHour, startMinute, endHour, endMinute);
  },

  cancelNightlyBlock: (): boolean => {
    if (!isAvailable) return false;
    return Native.cancelNightlyBlock();
  },
};
