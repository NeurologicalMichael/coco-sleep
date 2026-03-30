/**
 * timeHelpers.ts
 * Safe time string parsing utilities.
 */

/**
 * Safely parse a "HH:MM" time string.
 * Returns { h, m } on success, or null if the string is malformed.
 */
export function parseTimeHM(time: string | null | undefined): { h: number; m: number } | null {
  if (!time || typeof time !== 'string') return null;
  const parts = time.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}
