/**
 * recoveryTarget.ts
 *
 * TRIMP-inspired dynamic sleep target calculation.
 * Combines base sleep need + age adjustment + exercise load
 * to produce a personalized nightly target.
 */

import type { AgeRange } from '../store/userProfileStore';
import type { WorkoutEntry } from '../store/workoutStore';
import type { ProcessedSession } from '../store/recoveryStore';

/** Age-based base sleep adjustment in hours */
export function ageSleepAdjustment(ageRange: AgeRange | null): number {
  if (!ageRange || ageRange === '26_35' || ageRange === '36_45') return 0;
  if (ageRange === 'under18' || ageRange === '18_25') return 0.5;
  return -0.25; // 46_55, 56plus
}

/**
 * Calculate tonight's recommended sleep target.
 * @param ageRange  from user profile
 * @param todayWorkout  today's logged workout (null = rest day)
 * @returns target hours, clamped 7–10
 */
export function calcSleepTarget(
  ageRange: AgeRange | null,
  todayWorkout: WorkoutEntry | null,
): number {
  const base = 8.0;
  const ageAdj = ageSleepAdjustment(ageRange);
  const loadAdj = todayWorkout ? todayWorkout.load / 300 : 0;
  const target = base + ageAdj + loadAdj;
  return parseFloat(Math.min(Math.max(target, 7), 10).toFixed(2));
}

/**
 * Exercise-adjusted recovery score.
 * 100 = hit the target exactly. Can exceed 100 (up to 110) if you slept over target.
 */
export function calcAdjustedRecoveryScore(
  actualHours: number,
  targetHours: number,
): number {
  return Math.min(Math.round((actualHours / targetHours) * 100), 110);
}

/** Format decimal hours as "Xh Ym" */
export function formatTargetHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h}H` : `${h}H ${m}M`;
}

export interface StrainBalance {
  /** 7-day total exercise load */
  strainLoad: number;
  /** 7-day average recovery score (0–100) */
  recoveryAvg: number;
  /** balance ratio 0–1: high = well-recovered relative to strain */
  balance: number;
  /** descriptive label */
  label: string;
  /** color hint: green / gold / red */
  color: 'green' | 'gold' | 'red';
}

/**
 * Calculate 7-day strain vs recovery balance.
 */
export function calcStrainBalance(
  recentSessions: ProcessedSession[],
  recentWorkouts: WorkoutEntry[],
): StrainBalance {
  const strainLoad = recentWorkouts.reduce((s, w) => s + w.load, 0);
  const recoveryAvg =
    recentSessions.length > 0
      ? Math.round(
          recentSessions.reduce((s, n) => s + n.recovery.recoveryScore, 0) /
            recentSessions.length,
        )
      : 0;

  // Normalise: strain 0–700 (7 heavy days max ≈ 700), recovery 0–100
  // balance = recoveryAvg / (1 + strainNormalized) — keeps in 0-1 range
  const strainNorm = Math.min(strainLoad / 700, 1);
  const balance = strainLoad === 0
    ? recoveryAvg / 100
    : Math.min(recoveryAvg / 100 / (0.5 + strainNorm * 0.8), 1);

  let label: string;
  let color: 'green' | 'gold' | 'red';

  if (balance >= 0.75) {
    label = 'Well balanced — push hard today';
    color = 'green';
  } else if (balance >= 0.45) {
    label = 'Moderate load — train smart';
    color = 'gold';
  } else {
    label = 'High strain — recovery priority';
    color = 'red';
  }

  return { strainLoad, recoveryAvg, balance, label, color };
}
