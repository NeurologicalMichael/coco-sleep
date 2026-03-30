/**
 * useLocationAutoStop
 *
 * Watches for significant location displacement during a sleep session.
 * If the device moves more than DISPLACEMENT_METERS from where tracking
 * started, the session is auto-ended (user got up and left the room).
 *
 * Uses coarse accuracy to avoid waking the CPU too often.
 */

import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';

const DISPLACEMENT_METERS = 20;

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useLocationAutoStop(
  active: boolean,
  onDisplaced: () => void,
) {
  const originRef    = useRef<{ lat: number; lon: number } | null>(null);
  const subRef       = useRef<Location.LocationSubscription | null>(null);
  const firedRef     = useRef(false);
  const callbackRef  = useRef(onDisplaced);

  useEffect(() => { callbackRef.current = onDisplaced; }, [onDisplaced]);

  useEffect(() => {
    if (!active) {
      subRef.current?.remove();
      subRef.current  = null;
      originRef.current = null;
      firedRef.current  = false;
      return;
    }

    let cancelled = false;

    async function start() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      // Snap starting location
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (cancelled) return;
      originRef.current = { lat: initial.coords.latitude, lon: initial.coords.longitude };

      // Watch for movement — low accuracy = less battery, good enough for 20m
      subRef.current = await Location.watchPositionAsync(
        {
          accuracy:          Location.Accuracy.Balanced,
          distanceInterval:  10,   // callback only when moved ≥10m (pre-filter)
          timeInterval:      30_000,
        },
        (loc) => {
          if (firedRef.current || !originRef.current) return;
          const dist = haversineMeters(
            originRef.current.lat, originRef.current.lon,
            loc.coords.latitude,   loc.coords.longitude,
          );
          if (dist >= DISPLACEMENT_METERS) {
            firedRef.current = true;
            callbackRef.current();
          }
        },
      );
    }

    void start();

    return () => {
      cancelled = true;
      subRef.current?.remove();
      subRef.current    = null;
      originRef.current = null;
      firedRef.current  = false;
    };
  }, [active]);
}
