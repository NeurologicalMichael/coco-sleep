import { MovementEvent } from './hrvProxy';

export interface SleepScoreInput {
  durationHours:              number;
  movementEvents:             MovementEvent[];
  disruptionCount:            number;
  bedtimeConsistencyScore:    number;
  sleepOnsetAt:               number | null; // epoch ms
  startedAt:                  number;        // epoch ms
  endedAt:                    number;        // epoch ms
  scheduledBedtimeMinutes?:   number;        // minutes since midnight, e.g. 22:30 → 1350
}

export interface SleepScoreResult {
  sleepScore:           number;
  recoveryScore:        number;
  durationScore:        number;
  efficiencyPenalty:    number;
  disruptionPenalty:    number;
  wasoPenalty:          number;
  latencyPenalty:       number;
  consistencyBonus:     number;
  bedtimeBonus:         number;  // +5 early/on-time, -5 late
  sleepEfficiency:      number;  // 0–100 %
  sleepLatencyMinutes:  number;
  wasoMinutes:          number;
}

export type SleepPhase = 'deep' | 'light' | 'rem' | 'awake';

/**
 * 4 scientific sleep stages:
 *   dozing     → N1 (light transitional)
 *   snoozing   → N2 (stable light sleep)
 *   slumbering → N3 (slow-wave / deep)
 *   rem        → REM (dreaming, muscle atonia)
 *   awake      → Awake
 */
export type SleepStage = 'dozing' | 'snoozing' | 'slumbering' | 'rem' | 'awake';

/** Maps stage → phase for scoring */
export function stageToPhase(stage: SleepStage): SleepPhase {
  if (stage === 'slumbering') return 'deep';
  if (stage === 'rem')        return 'rem';
  if (stage === 'awake')      return 'awake';
  return 'light'; // dozing + snoozing
}

/**
 * Classifies sleep stage using movement magnitude + time weighting.
 *
 * Science:
 *  - First half of night: N3 (deep) dominant every ~90-min cycle
 *  - Second half: REM windows lengthen each cycle
 *  - REM = lowest movement (muscle atonia) but may have micro-sounds
 *  - N3  = very still, early in cycles
 *  - N1  = transitional (magnitude 0.05-0.12)
 *  - N2  = stable light (magnitude 0.015-0.05)
 *
 * @param magnitude        Epoch mean composite (accel+gyro)
 * @param audioDb          Optional mic dBFS level
 * @param timeSinceOnsetMs Milliseconds since sleep onset detected
 */
export function classifyStage(
  magnitude: number,
  audioDb?: number,
  timeSinceOnsetMs?: number,
): SleepStage {
  // ── Awake ──────────────────────────────────────────────────────────────────
  if (magnitude > 0.12) return 'awake';

  // Audio-assisted awake/dozing detection
  if (audioDb !== undefined) {
    if (magnitude > 0.05 && audioDb > -20) return 'awake';
    if (magnitude < 0.04 && audioDb > -20) return 'dozing'; // sound but still = N1
  }

  // ── N1 — transitional light sleep ─────────────────────────────────────────
  if (magnitude > 0.05) return 'dozing';

  // ── Time-weighted deep vs REM ──────────────────────────────────────────────
  const CYCLE_MS   = 5_400_000; // 90-min sleep cycle
  const hoursAsleep = timeSinceOnsetMs ? timeSinceOnsetMs / 3_600_000 : 0;
  const cyclePos    = timeSinceOnsetMs ? (timeSinceOnsetMs % CYCLE_MS) / CYCLE_MS : 0;

  if (magnitude < 0.02) {
    // Very still — N3 or REM
    if (!timeSinceOnsetMs) return 'slumbering'; // no time data → assume deep

    // REM windows: late in each cycle (last 30%), more common after 1.5h
    const inRemWindow = cyclePos > 0.65 && hoursAsleep > 1.5;
    // N3 dominant first 4h; REM dominant after
    if (inRemWindow || hoursAsleep > 4.5) return 'rem';
    return 'slumbering'; // N3
  }

  // ── N2 — stable light sleep (magnitude 0.02–0.05) ─────────────────────────
  // In later cycles, late-cycle N2 transitions to REM
  if (timeSinceOnsetMs && hoursAsleep > 2.5 && cyclePos > 0.75) {
    return 'rem'; // transitioning into REM
  }

  return 'snoozing'; // N2
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sleep efficiency = (time asleep / time in bed) × 100.
 * Each awake epoch = 30s deducted from sleep time.
 */
export function calculateSleepEfficiency(
  startedAt: number,
  endedAt: number,
  awakeEpochCount: number,
): number {
  const totalMs = endedAt - startedAt;
  if (totalMs <= 0) return 0;
  const awakeMs = awakeEpochCount * 30_000;
  const sleepMs = Math.max(totalMs - awakeMs, 0);
  return clamp(Math.round((sleepMs / totalMs) * 100), 0, 100);
}

/** Sleep latency in minutes (session start → sleep onset). */
export function calculateSleepLatency(startedAt: number, sleepOnsetAt: number | null): number {
  if (!sleepOnsetAt) return 0;
  return Math.max(Math.round((sleepOnsetAt - startedAt) / 60_000), 0);
}

/**
 * Wake After Sleep Onset (WASO) in minutes.
 * Each awake epoch after onset = 0.5 min.
 */
export function calculateWASO(events: MovementEvent[], sleepOnsetAt: number | null): number {
  if (!sleepOnsetAt) return 0;
  const awakeAfterOnset = events.filter(
    (e) => e.timestamp > sleepOnsetAt && (e.stage === 'awake' || e.phase === 'awake'),
  ).length;
  return Math.round(awakeAfterOnset * 0.5);
}

/**
 * Bedtime adherence bonus/penalty.
 * On time or early → +5. Very late (>1h) → -5.
 */
function bedtimeAdherence(startedAt: number, scheduledBedtimeMinutes?: number): number {
  if (scheduledBedtimeMinutes == null) return 0;
  const d = new Date(startedAt);
  let actual = d.getHours() * 60 + d.getMinutes();
  // Treat early-AM times as "next day" so midnight crossings work
  if (actual < 360) actual += 1440;  // before 6 AM → add 24h
  let sched = scheduledBedtimeMinutes;
  if (sched < 360) sched += 1440;

  const lateMin = actual - sched; // positive = late, negative = early
  if (lateMin <= 0)   return 5;   // on time or early
  if (lateMin <= 15)  return 3;   // up to 15min late
  if (lateMin <= 30)  return 0;   // 30min late — neutral
  if (lateMin <= 60)  return -3;  // up to 1h late
  return -5;                       // >1h late
}

export function calculateSleepScore(input: SleepScoreInput): SleepScoreResult {
  const {
    durationHours, movementEvents, disruptionCount,
    bedtimeConsistencyScore, sleepOnsetAt, startedAt, endedAt,
    scheduledBedtimeMinutes,
  } = input;

  const awakeEpochCount = movementEvents.filter(
    (e) => e.stage === 'awake' || e.phase === 'awake',
  ).length;

  const sleepEfficiency     = calculateSleepEfficiency(startedAt, endedAt, awakeEpochCount);
  const sleepLatencyMinutes = calculateSleepLatency(startedAt, sleepOnsetAt);
  const wasoMinutes         = calculateWASO(movementEvents, sleepOnsetAt);

  // Base: duration — 7h = full marks (75pts), capped. Generous so realistic sleep scores well.
  const durationScore = clamp((durationHours / 7) * 75, 0, 75);

  // Efficiency penalty: up to 10pts (reduced from 15 — phone tracking has inherent noise)
  const efficiencyPenalty = clamp((1 - sleepEfficiency / 100) * 10, 0, 10);

  // Disruption penalty: max 6pts
  const disruptionPenalty = clamp(disruptionCount * 1.0, 0, 6);

  // WASO penalty: 0.15pt per minute (max 6pts)
  const wasoPenalty = clamp(wasoMinutes * 0.15, 0, 6);

  // Latency penalty: >30min costs 3pts
  const latencyPenalty = sleepLatencyMinutes > 30 ? 3 : 0;

  // Consistency bonus (max 10pts)
  const consistencyBonus = clamp(bedtimeConsistencyScore * 10, 0, 10);

  // Bedtime adherence: +5 early/on-time, -5 very late
  const bedtimeBonus = bedtimeAdherence(startedAt, scheduledBedtimeMinutes);

  const sleepScore = clamp(
    Math.round(
      durationScore - efficiencyPenalty - disruptionPenalty - wasoPenalty
      - latencyPenalty + consistencyBonus + bedtimeBonus,
    ),
    0, 100,
  );

  const recoveryScore = sleepScore; // one score, no multiplier

  return {
    sleepScore,
    recoveryScore,
    durationScore:       Math.round(durationScore),
    efficiencyPenalty:   Math.round(efficiencyPenalty),
    disruptionPenalty:   Math.round(disruptionPenalty),
    wasoPenalty:         Math.round(wasoPenalty),
    latencyPenalty,
    consistencyBonus:    Math.round(consistencyBonus),
    bedtimeBonus,
    sleepEfficiency,
    sleepLatencyMinutes,
    wasoMinutes,
  };
}

/** Legacy alias — keeps Apple Watch tracking path unchanged */
export function classifyMovement(magnitude: number): SleepPhase {
  return stageToPhase(classifyStage(magnitude));
}

/**
 * Post-processes raw movement epochs into a smooth, realistic hypnogram.
 *
 * Real sleep cycles: N1 → N2 → N3 → N2 → REM → repeat every ~90 min.
 * Early night = deep-heavy (N3). Late night = REM-heavy.
 * High movement always = awake. Everything else is shaped by cycle position.
 *
 * Steps:
 *  1. Keep awake epochs that have high movement (can't fake being awake).
 *  2. Sliding-window median (5 epochs = 2.5 min) to kill single-epoch noise.
 *  3. Map cycle position + night progress → realistic stage.
 *  4. Enforce minimum 3-epoch (1.5 min) hold per stage to prevent flicker.
 */
export function smoothSleepStages(
  events: MovementEvent[],
  sleepOnsetAt: number | null,
): MovementEvent[] {
  if (events.length < 3) return events;

  const EPOCH_MS   = 30_000;
  const CYCLE_MS   = 5_400_000; // 90 min
  const onset      = sleepOnsetAt ?? events[0].timestamp;

  // ── Step 1: window median magnitude ──────────────────────────────────────
  const WIN = 5;
  const smoothMag = events.map((_, i) => {
    const lo  = Math.max(0, i - Math.floor(WIN / 2));
    const hi  = Math.min(events.length, lo + WIN);
    const win = events.slice(lo, hi).map((e) => e.magnitude).sort((a, b) => a - b);
    return win[Math.floor(win.length / 2)];
  });

  // ── Step 2: assign stage per epoch based on cycle position + night time ──
  const staged: SleepStage[] = events.map((e, i) => {
    const mag = smoothMag[i];

    // Clearly awake
    if (mag > 0.12) return 'awake';

    const msSinceOnset = e.timestamp - onset;
    if (msSinceOnset < 0) return 'dozing'; // before sleep onset → N1

    const hoursIn  = msSinceOnset / 3_600_000;
    const cyclePos = (msSinceOnset % CYCLE_MS) / CYCLE_MS; // 0–1 within cycle

    // ── Within a cycle: ──
    // 0.00–0.08  → N1 (entry, ~7 min)
    // 0.08–0.35  → N2 (core, ~25 min)
    // 0.35–0.60  → N3 (deep — only dominant in first 4 hours)
    // 0.60–0.75  → N2 (returning to light)
    // 0.75–1.00  → REM (lengthens each cycle)

    // Deep sleep fades after 4h; REM expands
    const deepCeiling = Math.max(0, 1 - hoursIn / 4); // 1 → 0 over 4h

    if (cyclePos < 0.08) return 'dozing';  // N1
    if (cyclePos < 0.35) {
      // N2 or N3 depending on depth & time
      if (mag < 0.025 && deepCeiling > 0.4) return 'slumbering'; // deep early
      return 'snoozing';
    }
    if (cyclePos < 0.60) {
      if (mag < 0.03 && deepCeiling > 0.25 && hoursIn < 4) return 'slumbering';
      if (hoursIn > 1.5 && mag < 0.04) return 'rem';
      return 'snoozing';
    }
    if (cyclePos < 0.75) return 'snoozing'; // N2 return
    // Late in cycle → REM if past first cycle
    if (hoursIn > 1.5) return 'rem';
    return 'snoozing';
  });

  // ── Step 3: minimum hold — don't change stage for < 3 epochs ────────────
  const MIN_HOLD = 3;
  const held = [...staged];
  let runStart = 0;
  for (let i = 1; i <= held.length; i++) {
    if (i === held.length || held[i] !== held[runStart]) {
      const runLen = i - runStart;
      if (runLen < MIN_HOLD && runStart > 0) {
        // Short run — inherit from previous
        for (let j = runStart; j < i; j++) held[j] = held[runStart - 1];
      }
      runStart = i;
    }
  }

  return events.map((e, i) => ({
    ...e,
    stage: held[i],
    phase: stageToPhase(held[i]),
  }));
}

/**
 * Generate synthetic movement events for a sleep period when no real sensor
 * data was recorded (e.g. session predates motion tracking or was too short).
 * Events have low magnitude so smoothSleepStages produces realistic sleep cycles.
 */
export function generateEstimatedEvents(
  startedAt: number,
  endedAt: number,
  sleepOnsetAt: number | null,
): MovementEvent[] {
  const EPOCH_MS = 30_000;
  const duration = endedAt - startedAt;
  if (duration < EPOCH_MS) return [];
  const count  = Math.floor(duration / EPOCH_MS);
  const onset  = sleepOnsetAt ?? startedAt + 10 * 60 * 1000; // assume 10min latency
  const events: MovementEvent[] = [];
  for (let i = 0; i < count; i++) {
    const ts  = startedAt + i * EPOCH_MS;
    // Slightly varied low magnitude so smoothSleepStages sees realistic movement
    const mag = 0.015 + (Math.sin(i * 0.7) * 0.005 + Math.cos(i * 1.3) * 0.004);
    events.push({ timestamp: ts, magnitude: Math.max(0.008, mag), phase: 'light' });
  }
  return smoothSleepStages(events, onset);
}

export function calculateBedtimeConsistency(
  tonightBedtimeMinutes: number,
  recentBedtimes: number[],
): number {
  if (recentBedtimes.length === 0) return 0.5;
  const avg = recentBedtimes.reduce((a, b) => a + b, 0) / recentBedtimes.length;
  return clamp(1 - Math.abs(tonightBedtimeMinutes - avg) / 60, 0, 1);
}
