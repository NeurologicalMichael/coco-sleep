import { useCallback } from 'react';
import { SleepSession } from '../store/sleepStore';
import { useRecoveryStore, ProcessedSession } from '../store/recoveryStore';
import { calculateSleepScore, calculateBedtimeConsistency, smoothSleepStages } from '../utils/sleepScore';
import { generateRecoveryReport } from '../utils/recoveryEngine';
import { rmssdToScore } from '../utils/healthKit';
import { useCoachStore } from '../store/coachStore';

function parseBedtimeMinutes(timeStr: string): number | undefined {
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return undefined;
  return h * 60 + m;
}

export function useRecoveryInsights() {
  const { setLatestSession, addToHistory, history } = useRecoveryStore();
  const { settings: coachSettings } = useCoachStore();

  const processSession = useCallback((session: SleepSession): ProcessedSession => {
    const endedAt       = session.endedAt ?? Date.now();
    const durationHours = (endedAt - session.startedAt) / 3_600_000;

    // Smooth raw epoch stages into realistic N1→N2→N3→REM sleep cycles
    const smoothedEvents = smoothSleepStages(session.movementEvents, session.sleepOnsetAt);

    const recentBedtimes = history.slice(0, 7).map((s) => {
      const d = new Date(s.date);
      return d.getHours() * 60 + d.getMinutes();
    });
    const start       = new Date(session.startedAt);
    const consistency = calculateBedtimeConsistency(
      start.getHours() * 60 + start.getMinutes(),
      recentBedtimes,
    );

    const scores = calculateSleepScore({
      durationHours,
      movementEvents:           smoothedEvents,
      disruptionCount:          session.disruptionCount,
      bedtimeConsistencyScore:  consistency,
      sleepOnsetAt:             session.sleepOnsetAt,
      startedAt:                session.startedAt,
      endedAt,
      scheduledBedtimeMinutes:  parseBedtimeMinutes(coachSettings.bedtimeReminderTime),
    });

    const recovery = generateRecoveryReport({
      sleepScore:          scores.sleepScore,
      recoveryScore:       scores.recoveryScore,
      durationHours,
      movementEvents:      smoothedEvents,
      disruptionCount:     session.disruptionCount,
      sleepEfficiency:     scores.sleepEfficiency,
      sleepLatencyMinutes: scores.sleepLatencyMinutes,
      wasoMinutes:         scores.wasoMinutes,
    });

    // If Apple Watch provided real HRV, override the proxy with real data
    if (session.watchHRV !== null) {
      const realHRVScore = rmssdToScore(session.watchHRV);
      recovery.hrvProxy  = realHRVScore;

      const hrvInsight = recovery.insights.find((i) => i.id === 'hrv');
      if (hrvInsight) {
        hrvInsight.title    = 'HRV (Apple Watch)';
        hrvInsight.body     = realHRVScore >= 75
          ? `HRV: ${session.watchHRV}ms RMSSD. Excellent parasympathetic recovery.`
          : realHRVScore >= 50
          ? `HRV: ${session.watchHRV}ms RMSSD. Moderate recovery. Avoid max CNS efforts.`
          : `HRV: ${session.watchHRV}ms RMSSD. Elevated stress state. Prioritize recovery today.`;
        hrvInsight.severity = realHRVScore >= 75 ? 'good' : realHRVScore >= 50 ? 'neutral' : 'warning';
      }
    }

    const processed: ProcessedSession = {
      id: session.id,
      date: session.date,
      durationHours,
      scores,
      recovery,
      dataSource:     session.dataSource,
      watchHRV:       session.watchHRV,
      watchHeartRate: session.watchHeartRate,
      audioEvents:    session.audioEvents,
      movementEvents: smoothedEvents,  // smoothed into realistic N1/N2/N3/REM cycles
    };

    setLatestSession(processed);
    addToHistory(processed);
    return processed;
  }, [history, setLatestSession, addToHistory, coachSettings.bedtimeReminderTime]);

  return { processSession };
}
