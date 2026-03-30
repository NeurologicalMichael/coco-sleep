/**
 * useSleepTracking — scientific phone-based sleep tracking
 *
 * Sensor fusion:  Accelerometer + Gyroscope via expo-sensors
 * Epoch length:   30 seconds (~150 samples at 200ms)
 * Smoothing:      Exponential Moving Average (EMA) per sample
 * Classification: Based on epoch mean composite magnitude
 *
 * Composite magnitude per sample:
 *   accelMag  = |√(x²+y²+z²) – 1.0|   (gravity stripped)
 *   gyroMag   =  √(rx²+ry²+rz²)        (rotation rate rad/s)
 *   composite = accelMag×0.7 + gyroMag×0.3
 *
 * Sleep onset: 5 consecutive quiet epochs (2.5 min) required.
 */

import { useEffect, useRef, useCallback } from 'react';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { useSleepStore } from '../store/sleepStore';
import { classifyStage, stageToPhase } from '../utils/sleepScore';
import { MovementEvent } from '../utils/hrvProxy';
import { feedMotionSample } from '../utils/audioSampler';

const SENSOR_MS        = 200;    // sensor poll interval ms
const EPOCH_MS         = 30_000; // classify every 30 seconds
const EMA_ALPHA        = 0.4;    // EMA weight (higher = more reactive to new samples)
const DISRUPTION_MAG   = 0.12;   // composite magnitude threshold for disruption
const ONSET_COUNT      = 5;      // consecutive quiet epochs to declare sleep onset
// (Auto-cancel is now handled by useLocationAutoStop — GPS displacement is more reliable than motion epochs)
const AUTO_CANCEL_EPOCHS = 999; // effectively disabled

interface Sample {
  accelMag:  number;
  gyroMag:   number;
  composite: number;
}

export function useSleepTracking(active: boolean, onAutoCancel?: () => void) {
  const {
    addMovementEvent, incrementDisruption,
    setPhase, setStage, setSleepOnset,
  } = useSleepStore();

  const accelSub   = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const gyroSub    = useRef<ReturnType<typeof Gyroscope.addListener> | null>(null);
  const epochTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestAccel  = useRef({ x: 0, y: 0, z: 0 });
  const latestGyro   = useRef({ x: 0, y: 0, z: 0 });
  const epochSamples = useRef<Sample[]>([]);
  const emaValue     = useRef(0);
  const quietCount        = useRef(0);
  const onsetDone         = useRef(false);
  const sustainedAwake    = useRef(0);   // consecutive high-movement epochs
  const autoCancelFired   = useRef(false);
  const onAutoCancelRef   = useRef(onAutoCancel);

  // ── Epoch stats ────────────────────────────────────────────────────────────

  function computeEpochStats(samples: Sample[]): { mean: number; peak: number; stdDev: number } {
    if (samples.length === 0) return { mean: 0, peak: 0, stdDev: 0 };
    const values = samples.map((s) => s.composite);
    const mean   = values.reduce((a, b) => a + b, 0) / values.length;
    const peak   = Math.max(...values);
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length,
    );
    return { mean, peak, stdDev };
  }

  // ── Start / stop ───────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    accelSub.current?.remove();
    gyroSub.current?.remove();
    accelSub.current  = null;
    gyroSub.current   = null;
    if (epochTimer.current) {
      clearInterval(epochTimer.current);
      epochTimer.current = null;
    }
    epochSamples.current = [];
    emaValue.current     = 0;
    quietCount.current   = 0;
    onsetDone.current    = false;
    sustainedAwake.current  = 0;
    autoCancelFired.current = false;
  }, []);

  const start = useCallback(() => {
    Accelerometer.setUpdateInterval(SENSOR_MS);
    Gyroscope.setUpdateInterval(SENSOR_MS);

    // Sample on each accelerometer tick; gyro is sampled separately but used together
    accelSub.current = Accelerometer.addListener((d) => {
      latestAccel.current = d;
      const { x, y, z }    = d;
      const { x: rx, y: ry, z: rz } = latestGyro.current;

      const accelMag  = Math.abs(Math.sqrt(x * x + y * y + z * z) - 1.0);
      const gyroMag   = Math.sqrt(rx * rx + ry * ry + rz * rz);
      const raw       = accelMag * 0.7 + gyroMag * 0.3;

      // Apply EMA to smooth out noise spikes
      emaValue.current = emaValue.current * (1 - EMA_ALPHA) + raw * EMA_ALPHA;

      epochSamples.current.push({ accelMag, gyroMag, composite: emaValue.current });
      feedMotionSample(emaValue.current);
    });

    gyroSub.current = Gyroscope.addListener((d) => {
      latestGyro.current = d;
    });

    // Epoch processor — fires every 30s
    epochTimer.current = setInterval(() => {
      const samples = epochSamples.current.slice();
      epochSamples.current = [];

      if (samples.length === 0) return;

      const { mean, peak, stdDev } = computeEpochStats(samples);
      const gyroMeanMag = samples.reduce((s, v) => s + v.gyroMag, 0) / samples.length;

      // Pass time-since-onset so classifier can weight Deep vs REM correctly
      const onsetAt = useSleepStore.getState().activeSession?.sleepOnsetAt ?? null;
      const timeSinceOnsetMs = onsetAt ? Date.now() - onsetAt : undefined;

      const stage = classifyStage(mean, undefined, timeSinceOnsetMs);
      const phase = stageToPhase(stage);

      setStage(stage);
      setPhase(phase);

      const movEvent: MovementEvent = {
        timestamp:     Date.now(),
        magnitude:     mean,
        phase,
        stage,
        peakMagnitude: peak,
        stdDev,
        gyroMagnitude: gyroMeanMag,
      };
      addMovementEvent(movEvent);

      if (mean > DISRUPTION_MAG) {
        incrementDisruption();
        quietCount.current = 0;
        sustainedAwake.current++;
        // Auto-cancel if high movement persists across AUTO_CANCEL_EPOCHS epochs (~3 min)
        if (
          !autoCancelFired.current &&
          onsetDone.current &&   // only after sleep was actually detected
          sustainedAwake.current >= AUTO_CANCEL_EPOCHS &&
          onAutoCancelRef.current
        ) {
          autoCancelFired.current = true;
          onAutoCancelRef.current();
        }
      } else if (stage !== 'awake') {
        sustainedAwake.current = 0;
        quietCount.current++;
        if (!onsetDone.current && quietCount.current >= ONSET_COUNT) {
          onsetDone.current = true;
          setSleepOnset(Date.now() - ONSET_COUNT * EPOCH_MS);
        }
      } else {
        quietCount.current = 0;
        sustainedAwake.current = 0;
      }
    }, EPOCH_MS) as unknown as ReturnType<typeof setInterval>;
  }, [addMovementEvent, incrementDisruption, setPhase, setStage, setSleepOnset]);

  // Keep callback ref in sync so the epoch closure always calls the latest version
  useEffect(() => { onAutoCancelRef.current = onAutoCancel; }, [onAutoCancel]);

  useEffect(() => {
    if (active) { start(); } else { stop(); }
    return () => { stop(); };
  }, [active, start, stop]);
}
