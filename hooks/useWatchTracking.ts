/**
 * useWatchTracking
 * Fetches completed sleep data from Apple Watch via HealthKit
 * after the user wakes up. Unlike phone tracking (which polls live),
 * Watch data is read retroactively since the Watch processes sleep natively.
 */

import { useState, useCallback } from 'react';
import {
  fetchWatchSleepData,
  requestHealthKitPermissions,
  isHealthKitAvailable,
  rmssdToScore,
  WatchSleepData,
} from '../utils/healthKit';

export type WatchStatus = 'idle' | 'checking' | 'authorized' | 'unavailable' | 'error';

export function useWatchTracking() {
  const [status, setStatus] = useState<WatchStatus>('idle');
  const [watchData, setWatchData] = useState<WatchSleepData | null>(null);

  const checkAndAuthorize = useCallback(async (): Promise<boolean> => {
    setStatus('checking');
    const available = await isHealthKitAvailable();
    if (!available) {
      setStatus('unavailable');
      return false;
    }
    const granted = await requestHealthKitPermissions();
    setStatus(granted ? 'authorized' : 'error');
    return granted;
  }, []);

  /**
   * Called when user wakes up. Fetches last night's Watch sleep data.
   * startTime = when they tapped "Start Tracking", endTime = now.
   */
  const fetchNightData = useCallback(
    async (startTime: number, endTime: number): Promise<WatchSleepData | null> => {
      try {
        const data = await fetchWatchSleepData(new Date(startTime), new Date(endTime));
        setWatchData(data);
        return data;
      } catch (e) {
        console.warn('HealthKit fetch failed:', e);
        return null;
      }
    },
    [],
  );

  /**
   * Convert Watch HRV RMSSD to the same 0-100 scale used by our proxy.
   * Returns null if no Watch HRV data is available.
   */
  const getHRVScore = useCallback((): number | null => {
    if (!watchData?.hrvRMSSD) return null;
    return rmssdToScore(watchData.hrvRMSSD);
  }, [watchData]);

  return { status, watchData, checkAndAuthorize, fetchNightData, getHRVScore };
}
