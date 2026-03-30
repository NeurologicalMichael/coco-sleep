import { SleepPhase, SleepStage } from './sleepScore';

export interface MovementEvent {
  timestamp:      number;
  magnitude:      number;      // epoch mean composite magnitude
  phase:          SleepPhase;
  stage?:         SleepStage;
  audioDb?:       number;      // dBFS audio level (future mic support)
  peakMagnitude?: number;      // epoch peak composite magnitude
  stdDev?:        number;      // epoch std dev of composite magnitudes
  gyroMagnitude?: number;      // epoch mean gyroscope magnitude (rad/s)
}

export interface AudioEvent {
  timestamp: number;
  db:        number;           // dBFS mean over epoch (negative — 0 = loudest)
  type:      'snoring' | 'talking' | 'quiet' | 'loud_event';
  peakDb?:   number;           // highest dBFS in epoch
  peaks?:    number;           // rhythmic peak count (snoring indicator)
  clipUri?:  string;           // local file path to saved audio clip
}

function isDeepSleep(e: MovementEvent): boolean {
  return e.stage === 'slumbering' || (!e.stage && e.phase === 'deep');
}

/**
 * HRV proxy 0–100.
 * Prefers stdDev of composite magnitude during deep sleep (epoch-based tracking).
 * Lower stdDev = more settled nervous system = higher HRV proxy.
 * Falls back to variance of epoch means for legacy events.
 */
export function calculateHRVProxy(events: MovementEvent[]): number {
  const deepEvents = events.filter(isDeepSleep);
  if (deepEvents.length < 5) return 50;

  const withStdDev = deepEvents.filter((e) => e.stdDev !== undefined);
  if (withStdDev.length >= 3) {
    const avgStdDev = withStdDev.reduce((s, e) => s + e.stdDev!, 0) / withStdDev.length;
    // stdDev 0 → score 100; stdDev ≥0.05 → score 0
    return Math.min(Math.max(Math.round((1 - Math.min(avgStdDev / 0.05, 1)) * 100), 0), 100);
  }

  // Legacy fallback: variance of epoch means
  const magnitudes = deepEvents.map((e) => e.magnitude);
  const mean       = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const variance   = magnitudes.reduce((sum, m) => sum + Math.pow(m - mean, 2), 0) / magnitudes.length;
  return Math.min(Math.max(Math.round((1 - Math.min(variance / 0.001, 1)) * 100), 0), 100);
}

/** Each MovementEvent = 30s epoch. Deep sleep minutes = deep epoch count × 0.5. */
export function estimateDeepSleepMinutes(events: MovementEvent[]): number {
  return Math.round(events.filter(isDeepSleep).length * 0.5);
}

/** Per-stage durations in minutes. Each event = 30s epoch. */
export function estimateStageDurations(events: MovementEvent[]): {
  dozing: number; snoozing: number; slumbering: number; rem: number; awake: number;
} {
  const counts = { dozing: 0, snoozing: 0, slumbering: 0, rem: 0, awake: 0 };
  for (const e of events) {
    const s: SleepStage = e.stage
      ?? (e.phase === 'deep' ? 'slumbering' : e.phase === 'rem' ? 'rem' : e.phase === 'light' ? 'snoozing' : 'awake');
    if (s in counts) counts[s as keyof typeof counts]++;
  }
  return {
    dozing:     Math.round(counts.dozing     * 0.5),
    snoozing:   Math.round(counts.snoozing   * 0.5),
    slumbering: Math.round(counts.slumbering * 0.5),
    rem:        Math.round(counts.rem        * 0.5),
    awake:      Math.round(counts.awake      * 0.5),
  };
}
