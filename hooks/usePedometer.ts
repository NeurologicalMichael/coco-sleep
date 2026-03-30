/**
 * usePedometer.ts
 * Reads today's step count from the device pedometer and keeps the
 * activityStore in sync. Falls back gracefully if unavailable.
 */

import { useEffect, useRef } from 'react';
import { Pedometer } from 'expo-sensors';
import { useActivityStore } from '../store/activityStore';

export function usePedometer() {
  const { setSteps, checkDailyReset } = useActivityStore();
  const subRef = useRef<{ remove: () => void } | null>(null);
  const baseStepsRef = useRef(0);

  useEffect(() => {
    checkDailyReset();

    let mounted = true;

    (async () => {
      try {
        const available = await Pedometer.isAvailableAsync();
        if (!available) return;

        const { status } = await Pedometer.requestPermissionsAsync();
        if (status !== 'granted' || !mounted) return;

        // Get authoritative step count since midnight
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const { steps: todaySteps } = await Pedometer.getStepCountAsync(start, new Date());
        if (!mounted) return;
        baseStepsRef.current = todaySteps;
        setSteps(todaySteps);

        // watchStepCount gives cumulative steps since subscription started — not a per-call delta
        subRef.current = Pedometer.watchStepCount(({ steps: stepsFromStart }) => {
          if (!mounted) return;
          setSteps(baseStepsRef.current + stepsFromStart);
        });
      } catch (e) {
        // Pedometer unavailable on simulator — silently skip
      }
    })();

    return () => {
      mounted = false;
      subRef.current?.remove();
    };
  }, []);
}
