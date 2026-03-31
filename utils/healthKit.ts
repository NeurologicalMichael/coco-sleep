/**
 * healthKit.ts
 * Wraps react-native-health to pull Apple Watch sleep + HRV data from HealthKit.
 * When Watch data is available, it replaces the phone accelerometer estimates
 * with real clinical-grade measurements.
 */

// react-native-health requires a custom dev build (not Expo Go).
// We guard the import so the app still runs in Expo Go for development.
let AppleHealthKit: any = null;
try {
  AppleHealthKit = require('react-native-health').default;
} catch {
  // Native module not available (Expo Go / simulator without custom build)
}

import type { HealthKitPermissions, HealthValue } from 'react-native-health';
import { MovementEvent } from './hrvProxy';
import { SleepPhase } from './sleepScore';

export const HEALTHKIT_PERMISSIONS = {
  permissions: {
    read: [
      'HeartRateVariability',
      'HeartRate',
      'SleepAnalysis',
      'RespiratoryRate',
      'Workout',
      'ActiveEnergyBurned',
      'StepCount',
    ],
    write: [] as string[],
  },
};

/** Returns true if HealthKit is available AND was successfully initialised */
export async function requestAndCheckHealthKit(): Promise<boolean> {
  const available = await isHealthKitAvailable();
  if (!available) return false;
  return requestHealthKitPermissions();
}

export interface WatchSleepData {
  /** Real RMSSD HRV in ms from Apple Watch — replaces our proxy */
  hrvRMSSD: number | null;
  /** Avg heart rate during sleep */
  avgHeartRate: number | null;
  /** Reconstructed movement events from sleep stage data */
  movementEvents: MovementEvent[];
  /** Total deep sleep in minutes from HealthKit sleep stages */
  deepSleepMinutes: number;
  /** Disruption count derived from awake periods */
  disruptionCount: number;
  /** Actual sleep duration in hours */
  durationHours: number;
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  if (!AppleHealthKit) return false;
  return new Promise((resolve) => {
    AppleHealthKit.initHealthKit(HEALTHKIT_PERMISSIONS, (err: any) => {
      resolve(!err);
    });
  });
}

export async function isHealthKitAvailable(): Promise<boolean> {
  if (!AppleHealthKit) return false;
  return new Promise((resolve) => {
    AppleHealthKit.isAvailable((err: any, available: boolean) => {
      resolve(!err && available);
    });
  });
}

/**
 * Fetch last night's sleep data from HealthKit (Apple Watch).
 * Pulls HRV, heart rate, and sleep stages for the given time window.
 */
export async function fetchWatchSleepData(
  startTime: Date,
  endTime: Date,
): Promise<WatchSleepData> {
  const options = {
    startDate: startTime.toISOString(),
    endDate: endTime.toISOString(),
  };

  const [hrv, heartRates, sleepSamples] = await Promise.all([
    fetchHRV(options),
    fetchHeartRates(options),
    fetchSleepSamples(options),
  ]);

  // Convert sleep stage samples to synthetic MovementEvent[] for compatibility
  const movementEvents = sleepStagesToMovementEvents(sleepSamples);

  // Count awake periods as disruptions
  const awakeSamples = sleepSamples.filter((s) => s.value === 'INBED' || s.value === 0);
  const disruptionCount = awakeSamples.length;

  // Deep sleep from core/deep stages
  const deepSleepMinutes = sleepSamples
    .filter((s) => s.value === 'ASLEEP' || s.value === 3 || s.value === 4)
    .reduce((sum, s) => {
      const dur = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
      return sum + dur;
    }, 0);

  // Total sleep duration
  const durationHours =
    sleepSamples.reduce((sum, s) => {
      const dur = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 3600000;
      return sum + dur;
    }, 0) || (endTime.getTime() - startTime.getTime()) / 3600000;

  const avgHeartRate =
    heartRates.length > 0
      ? Math.round(heartRates.reduce((s, r) => s + r.value, 0) / heartRates.length)
      : null;

  // Use median HRV reading (more robust than mean)
  const hrvRMSSD =
    hrv.length > 0
      ? parseFloat(
          hrv
            .map((r) => r.value)
            .sort((a, b) => a - b)
            [Math.floor(hrv.length / 2)].toFixed(1),
        )
      : null;

  return {
    hrvRMSSD,
    avgHeartRate,
    movementEvents,
    deepSleepMinutes: Math.round(deepSleepMinutes),
    disruptionCount,
    durationHours: parseFloat(durationHours.toFixed(2)),
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function fetchHRV(options: { startDate: string; endDate: string }): Promise<any[]> {
  if (!AppleHealthKit) return Promise.resolve([]);
  return new Promise((resolve) => {
    AppleHealthKit.getHeartRateVariabilitySamples(options, (err: any, results: any[]) => {
      resolve(err ? [] : results ?? []);
    });
  });
}

function fetchHeartRates(options: { startDate: string; endDate: string }): Promise<any[]> {
  if (!AppleHealthKit) return Promise.resolve([]);
  return new Promise((resolve) => {
    AppleHealthKit.getHeartRateSamples(options, (err: any, results: any[]) => {
      resolve(err ? [] : results ?? []);
    });
  });
}

function fetchSleepSamples(options: { startDate: string; endDate: string }): Promise<any[]> {
  if (!AppleHealthKit) return Promise.resolve([]);
  return new Promise((resolve) => {
    AppleHealthKit.getSleepSamples(options, (err: any, results: any[]) => {
      resolve(err ? [] : results ?? []);
    });
  });
}

/**
 * Convert HealthKit sleep stage samples into MovementEvent[] so the
 * existing recovery engine works without modification.
 * Deep stages → low magnitude (deep phase)
 * Light stages → medium magnitude (light phase)
 * Awake/InBed → high magnitude (awake phase)
 */
function sleepStagesToMovementEvents(samples: any[]): MovementEvent[] {
  const events: MovementEvent[] = [];

  for (const sample of samples) {
    const start = new Date(sample.startDate).getTime();
    const end = new Date(sample.endDate).getTime();
    const durationMs = end - start;
    const eventCount = Math.max(1, Math.floor(durationMs / 10000)); // one event per 10s

    let phase: SleepPhase;
    let magnitude: number;

    const val = sample.value;
    if (val === 'DEEP' || val === 4 || val === 3) {
      phase = 'deep';
      magnitude = 0.005 + Math.random() * 0.005; // very still
    } else if (val === 'CORE' || val === 'ASLEEP' || val === 2) {
      phase = 'light';
      magnitude = 0.02 + Math.random() * 0.03;
    } else {
      phase = 'awake';
      magnitude = 0.1 + Math.random() * 0.05;
    }

    for (let i = 0; i < eventCount; i++) {
      events.push({
        timestamp: start + i * 10000,
        magnitude,
        phase,
      });
    }
  }

  return events;
}

/**
 * Convert real Apple Watch HRV (RMSSD in ms) to a 0-100 score
 * for display consistency with our accelerometer proxy.
 * Typical RMSSD range: 10ms (poor) to 100ms+ (excellent).
 */
export function rmssdToScore(rmssd: number): number {
  // Normalize: 10ms = 0, 100ms = 100
  return Math.min(Math.max(Math.round(((rmssd - 10) / 90) * 100), 0), 100);
}
