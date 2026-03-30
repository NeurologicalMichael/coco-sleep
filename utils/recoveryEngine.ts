import { MovementEvent, calculateHRVProxy, estimateDeepSleepMinutes } from './hrvProxy';

export interface RecoveryEngineInput {
  sleepScore:          number;
  recoveryScore:       number;
  durationHours:       number;
  movementEvents:      MovementEvent[];
  disruptionCount:     number;
  sleepEfficiency:     number;  // 0–100 %
  sleepLatencyMinutes: number;
  wasoMinutes:         number;
}

export interface RecoveryInsight {
  id:        string;
  category:  'performance' | 'hrv' | 'cortisol' | 'muscle' | 'recommendation' | 'efficiency';
  title:     string;
  body:      string;
  severity:  'good' | 'neutral' | 'warning' | 'critical';
  isPremium: boolean;
}

export interface RecoveryEngineOutput {
  recoveryScore:        number;
  performanceForecast:  string;
  hrvProxy:             number;
  cortisolFlag:         boolean;
  muscleRecoveryStatus: string;
  insights:             RecoveryInsight[];
}

export function generateRecoveryReport(input: RecoveryEngineInput): RecoveryEngineOutput {
  const {
    sleepScore, recoveryScore, durationHours, movementEvents,
    sleepEfficiency, sleepLatencyMinutes, wasoMinutes,
  } = input;

  const hrvProxy         = calculateHRVProxy(movementEvents);
  const deepSleepMinutes = estimateDeepSleepMinutes(movementEvents);

  // Cortisol elevated with short sleep OR high WASO
  const cortisolFlag = durationHours < 6 || wasoMinutes > 30;

  const performanceForecast =
    recoveryScore >= 85 ? `Full recovery. Expect peak output today.`
    : recoveryScore >= 70 ? `Good recovery. Train hard.`
    : recoveryScore >= 55
      ? `Slept ${durationHours.toFixed(1)}hrs. Expect ${Math.round((1 - recoveryScore / 100) * 15 + 5)}% lower output.`
    : recoveryScore >= 40 ? `Poor recovery. Train smart, not hard.`
    : `Critical sleep deficit. Rest day recommended.`;

  const muscleRecoveryStatus =
    deepSleepMinutes < 90
      ? `Only ${deepSleepMinutes}min deep sleep. Muscle repair may be incomplete.`
    : wasoMinutes > 30
      ? `${deepSleepMinutes}min deep sleep, but ${wasoMinutes}min WASO disrupted consolidation.`
    : recoveryScore >= 75
      ? `Muscles adequately recovered.`
    : `Partial recovery. Avoid max-effort sessions today.`;

  const latencyNote = sleepLatencyMinutes > 30
    ? ` Took ${sleepLatencyMinutes}min to fall asleep.`
    : '';

  const insights: RecoveryInsight[] = [
    {
      id: 'performance', category: 'performance', title: 'Performance Forecast',
      body: performanceForecast + latencyNote,
      severity: recoveryScore >= 70 ? 'good' : recoveryScore >= 50 ? 'warning' : 'critical',
      isPremium: false,
    },
    {
      id: 'efficiency', category: 'efficiency',
      title: sleepEfficiency >= 85
        ? 'Sleep Quality: Excellent'
        : sleepEfficiency >= 70
        ? 'Sleep Quality: Fragmented'
        : 'Sleep Quality: Poor',
      body: sleepEfficiency >= 85
        ? `Sleep efficiency ${sleepEfficiency}%. Excellent consolidation — sleep architecture intact.`
        : sleepEfficiency >= 70
        ? `Sleep efficiency ${sleepEfficiency}%. Some fragmentation detected.${wasoMinutes > 0 ? ` ${wasoMinutes}min awake after falling asleep.` : ''}`
        : `Sleep efficiency ${sleepEfficiency}%. Highly fragmented — restorative deep sleep significantly reduced.${wasoMinutes > 0 ? ` ${wasoMinutes}min WASO.` : ''}`,
      severity: sleepEfficiency >= 85 ? 'good' : sleepEfficiency >= 70 ? 'warning' : 'critical',
      isPremium: false,
    },
    {
      id: 'hrv', category: 'hrv', title: 'HRV Proxy',
      body: hrvProxy >= 75
        ? `HRV proxy: ${hrvProxy}. Nervous system well recovered.`
        : hrvProxy >= 50
        ? `HRV proxy: ${hrvProxy}. Moderate recovery. Avoid max CNS efforts.`
        : `HRV proxy: ${hrvProxy}. High stress state. High intensity will extend recovery.`,
      severity: hrvProxy >= 75 ? 'good' : hrvProxy >= 50 ? 'neutral' : 'warning',
      isPremium: true,
    },
    {
      id: 'cortisol', category: 'cortisol',
      title: cortisolFlag ? 'Cortisol Elevated' : 'Cortisol Normal',
      body: cortisolFlag
        ? durationHours < 6
          ? `Only ${durationHours.toFixed(1)}hrs sleep. Cortisol elevated — slows muscle repair and increases fat retention.`
          : `${wasoMinutes}min awake after sleep onset. Fragmented sleep elevates cortisol even with adequate total duration.`
        : `Sleep duration and continuity support normal cortisol levels and hormonal balance.`,
      severity: cortisolFlag
        ? (durationHours < 5 || wasoMinutes > 60 ? 'critical' : 'warning')
        : 'good',
      isPremium: true,
    },
    {
      id: 'muscle', category: 'muscle', title: 'Muscle Recovery',
      body: muscleRecoveryStatus,
      severity: deepSleepMinutes >= 90 && recoveryScore >= 70 && wasoMinutes < 30
        ? 'good'
        : deepSleepMinutes < 60
        ? 'warning'
        : 'neutral',
      isPremium: true,
    },
  ];

  return {
    recoveryScore, performanceForecast, hrvProxy, cortisolFlag,
    muscleRecoveryStatus, insights,
  };
}
