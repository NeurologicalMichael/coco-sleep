import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Animated, View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, Modal, Alert, Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { syncWidgetState } from '../../utils/widgetSync';
import { useCocoStore } from '../../store/cocoStore';
import { useAuthStore } from '../../store/authStore';
import { useActivityStore } from '../../store/activityStore';
import { useRecoveryStore, ProcessedSession } from '../../store/recoveryStore';
import { getTierForLevel } from '../../constants/tiers';
import { scoreToCocoLevel, COCO_LEVELS, streakToGrowthStage, GROWTH_STAGE_IMAGES } from '../../constants/cocoLevels';
import { useSleepStore, DataSource } from '../../store/sleepStore';
import { useSleepTracking } from '../../hooks/useSleepTracking';
import { useLocationAutoStop } from '../../hooks/useLocationAutoStop';
import { useWatchTracking } from '../../hooks/useWatchTracking';
import { useRecoveryInsights } from '../../hooks/useRecoveryInsights';
import { useCocoEvolution } from '../../hooks/useCocoEvolution';
import { usePedometer } from '../../hooks/usePedometer';
import { ScreenTimeManager } from '../../modules/ScreenTimeManager';
import { useCoachStore } from '../../store/coachStore';
import { useSleepDebtStore } from '../../store/sleepDebtStore';
import { usePurchaseStore } from '../../store/purchaseStore';
import { useWorkoutStore } from '../../store/workoutStore';
import { useUserProfileStore } from '../../store/userProfileStore';
import { calcSleepTarget, calcStrainBalance, formatTargetHours } from '../../utils/recoveryTarget';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { estimateStageDurations, AudioEvent } from '../../utils/hrvProxy';
import { SleepStage, generateEstimatedEvents } from '../../utils/sleepScore';
import { startAudioSampling, stopAudioSampling, audioPermissionStatus, audioTypeLabel, audioTypeIcon, deleteAllClips, listSavedClips, matchClipsToEvents } from '../../utils/audioSampler';
import { Linking } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { startBackgroundKeepAlive, stopBackgroundKeepAlive } from '../../utils/backgroundKeepAlive';
import { scheduleSocialNotifications } from '../../utils/notifications';
import { StageTimeline, MovementGraph, StageBreakdown } from '../../components/SleepCharts';

// ─── Constants ────────────────────────────────────────────────────────────────

const TIER_EMOJI = ['🌱', '🌿', '🌴', '🥥', '🌟', '👑'];
const DAY_NAMES   = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const STAGE_CFG: Record<SleepStage, { label: string; sub: string; color: string }> = {
  slumbering: { label: 'SLUMBERING', sub: 'Deep sleep — peak recovery',      color: Colors.info  },
  snoozing:   { label: 'SNOOZING',   sub: 'Light sleep — recharging',        color: '#A855F7'    },
  dozing:     { label: 'DOZING',     sub: 'N1 — settling in',                color: Colors.gold  },
  rem:        { label: 'REM',        sub: 'Dreaming — memory consolidation', color: '#EC4899'    },
  awake:      { label: 'AWAKE',      sub: 'Movement detected',               color: Colors.red   },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

function scoreColor(score: number): string {
  if (score >= 75) return Colors.green;
  if (score >= 50) return Colors.gold;
  return Colors.red;
}

function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}M`;
  return m === 0 ? `${h}H` : `${h}H ${m}M`;
}

function formatClockTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function formatDur(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h}H` : `${h}H ${m}M`;
}

function nightTabLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function nightFullLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAY_NAMES[d.getDay()]}  ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { activeSession, currentStage, startSession, endSession, dataSource, setDataSource,
    patchWatchData, addAudioEvent, pendingWidgetToggle,
    setPendingWidgetToggle } = useSleepStore();
  const { processSession } = useRecoveryInsights();
  const { processSession: evolve } = useCocoEvolution();
  const { status: watchStatus, checkAndAuthorize, fetchNightData } = useWatchTracking();
  const { streak, tier, mood, cocoLevel, lastCelebratedLevel, applySessionLevel, applyMissedDayDecay, markLevelCelebrated } = useCocoStore();
  const { username, userId } = useAuthStore();
  const { settings: coachSettings } = useCoachStore();
  const { history } = useRecoveryStore();
  const { latestSession } = useRecoveryStore();
  const { steps, stepGoal, waterIntake, waterGoal, addWater, removeWater } = useActivityStore();
  const { debtHours } = useSleepDebtStore();
  const { isPremium } = usePurchaseStore();
  const { getForDate, getRecent } = useWorkoutStore();
  const { ageRange } = useUserProfileStore();

  // ── Recovery Engine calculations ─────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayWorkout = getForDate(todayStr);
  const sleepTarget = calcSleepTarget(ageRange, todayWorkout);
  const recentWorkouts = getRecent(7);
  const recentSessions = history.slice(0, 7);
  const strainBalance = calcStrainBalance(recentSessions, recentWorkouts);
  const adjustedScore = latestSession
    ? Math.min(Math.round((latestSession.durationHours / sleepTarget) * 100), 110)
    : null;

  const currentTier = getTierForLevel(tier);
  const recoveryScore = latestSession?.recovery.recoveryScore ?? null;
  const recScoreColor = recoveryScore !== null ? scoreColor(recoveryScore) : Colors.textPrimary;
  const debtColor = debtHours <= 0 ? Colors.green : debtHours <= 3 ? Colors.gold : Colors.red;
  const debtLabel = debtHours <= 0 ? `+${Math.abs(debtHours).toFixed(1)}h` : `${debtHours.toFixed(1)}h OWED`;
  const stepPct = stepGoal > 0 ? Math.min(steps / stepGoal, 1) : 0;
  const stepColor = stepPct >= 1 ? Colors.green : stepPct >= 0.5 ? Colors.gold : Colors.info;
  const waterPct = waterGoal > 0 ? Math.min(waterIntake / waterGoal, 1) : 0;
  const waterColor = waterPct >= 1 ? Colors.green : waterPct >= 0.5 ? Colors.info : Colors.textSecondary;

  usePedometer();

  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [, forceRender] = useState(0);
  const [liveAudioType, setLiveAudioType] = useState<AudioEvent['type']>('quiet');
  const isTracking = !!activeSession;
  const prevHistoryLen = useRef(history.length);

  // ── Level-up blocking modal ───────────────────────────────────────────────
  const levelUpScale     = useRef(new Animated.Value(1)).current;
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);

  function triggerLevelUpCelebration(level: number) {
    setShowLevelUpModal(true);
    levelUpScale.setValue(0.5);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.spring(levelUpScale, { toValue: 1.45, useNativeDriver: true, speed: 16, bounciness: 18 }),
      Animated.spring(levelUpScale, { toValue: 1,    useNativeDriver: true, speed: 10, bounciness: 10 }),
    ]).start(() => {
      setTimeout(() => {
        setShowLevelUpModal(false);
        markLevelCelebrated(level);
        levelUpScale.setValue(1);
      }, 2200);
    });
  }

  // Fire on focus — force re-render and apply missed day decay
  useFocusEffect(useCallback(() => {
    forceRender((n) => n + 1);
    applyMissedDayDecay();
  }, [applyMissedDayDecay]));

  useEffect(() => {
    if (!pendingWidgetToggle) return;
    setPendingWidgetToggle(false);
    if (isTracking) void handleStop();
    else void handleWidgetStart();
  }, [pendingWidgetToggle]);

  useEffect(() => {
    if (history.length > prevHistoryLen.current && history.length > 0) {
      setSelectedTab(history[0].id);
    } else if (selectedTab === null && history.length > 0) {
      setSelectedTab(history[0].id);
    }
    prevHistoryLen.current = history.length;
  }, [history.length]);

  // ── Pulse animation (tracking ring) ─────────────────────────────────────────
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseAnim  = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (isTracking) {
      pulseAnim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1,   duration: 1000, useNativeDriver: true }),
        ])
      );
      pulseAnim.current.start();
    } else {
      pulseAnim.current?.stop();
      pulseScale.setValue(1);
    }
    return () => { pulseAnim.current?.stop(); };
  }, [isTracking]);
  const pulseStyle = {
    transform: [{ scale: pulseScale }],
    opacity: pulseScale.interpolate({ inputRange: [1, 1.6], outputRange: [1, 0.4] }),
  };

  // ── Coco idle animation (float + breathe + sway, scales with level) ──────────
  const cocoFloatY     = useRef(new Animated.Value(0)).current;
  const cocoBreath     = useRef(new Animated.Value(1)).current;
  const cocoSwayX      = useRef(new Animated.Value(0)).current;
  const cocoIdleAnim   = useRef<Animated.CompositeAnimation | null>(null);
  const cocoSleepBreath = useRef(new Animated.Value(1)).current;
  const cocoSleepFloat  = useRef(new Animated.Value(0)).current;
  const cocoSleepAnim   = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Amplitude scales with cocoLevel
    const floatAmp  = cocoLevel < 3 ? 5  : cocoLevel < 6 ? 7  : cocoLevel < 9 ? 9  : 11;
    const breathAmp = cocoLevel < 3 ? 1.022 : cocoLevel < 6 ? 1.032 : cocoLevel < 9 ? 1.042 : 1.052;
    const swayAmp   = cocoLevel < 6 ? 0  : cocoLevel < 9 ? 2.5 : 4;
    const period    = cocoLevel < 3 ? 3200 : cocoLevel < 6 ? 2800 : cocoLevel < 9 ? 2400 : 2100;

    cocoIdleAnim.current?.stop();
    cocoSleepAnim.current?.stop();

    if (!isTracking) {
      // Idle: float + breathe + optional sway, all in sync
      const floatLoop = Animated.loop(Animated.sequence([
        Animated.timing(cocoFloatY, { toValue: -floatAmp, duration: period / 2, useNativeDriver: true }),
        Animated.timing(cocoFloatY, { toValue: 0,         duration: period / 2, useNativeDriver: true }),
      ]));
      const breathLoop = Animated.loop(Animated.sequence([
        Animated.timing(cocoBreath, { toValue: breathAmp, duration: period / 2, useNativeDriver: true }),
        Animated.timing(cocoBreath, { toValue: 1,         duration: period / 2, useNativeDriver: true }),
      ]));
      const animations: Animated.CompositeAnimation[] = [floatLoop, breathLoop];
      if (swayAmp > 0) {
        animations.push(Animated.loop(Animated.sequence([
          Animated.timing(cocoSwayX, { toValue: swayAmp,  duration: (period * 0.7) / 2, useNativeDriver: true }),
          Animated.timing(cocoSwayX, { toValue: -swayAmp, duration: (period * 0.7) / 2, useNativeDriver: true }),
          Animated.timing(cocoSwayX, { toValue: 0,        duration: (period * 0.3) / 2, useNativeDriver: true }),
        ])));
      }
      cocoIdleAnim.current = Animated.parallel(animations);
      cocoIdleAnim.current.start();
    } else {
      // Sleep mode: slower, dreamier float + gentle breath
      cocoFloatY.setValue(0); cocoBreath.setValue(1); cocoSwayX.setValue(0);
      cocoSleepAnim.current = Animated.parallel([
        Animated.loop(Animated.sequence([
          Animated.timing(cocoSleepFloat, { toValue: -6, duration: 2800, useNativeDriver: true }),
          Animated.timing(cocoSleepFloat, { toValue: 0,  duration: 2800, useNativeDriver: true }),
        ])),
        Animated.loop(Animated.sequence([
          Animated.timing(cocoSleepBreath, { toValue: 1.025, duration: 2800, useNativeDriver: true }),
          Animated.timing(cocoSleepBreath, { toValue: 1,     duration: 2800, useNativeDriver: true }),
        ])),
      ]);
      cocoSleepAnim.current.start();
    }

    return () => { cocoIdleAnim.current?.stop(); cocoSleepAnim.current?.stop(); };
  }, [isTracking, cocoLevel]);

  const cocoIdleStyle = {
    transform: [
      { translateY: cocoFloatY },
      { translateX: cocoSwayX },
      { scale: cocoBreath },
    ],
  };
  const cocoSleepStyle = {
    transform: [
      { translateY: cocoSleepFloat },
      { scale: cocoSleepBreath },
    ],
  };

  useSleepTracking(isTracking && dataSource === 'phone', undefined);
  useLocationAutoStop(isTracking, () => void handleStop(true));

  async function handleSelectSource(source: DataSource) {
    if (source === 'watch') {
      if (Platform.OS !== 'ios') { Alert.alert('Apple Watch is iOS only.'); return; }
      const granted = await checkAndAuthorize();
      if (!granted) {
        Alert.alert('Permission Required', 'Enable Health access in Settings → Privacy → Health → Coco.');
        return;
      }
    }
    setDataSource(source);
  }

  async function handleWidgetStart() {
    startSession();
    void startBackgroundKeepAlive();
    if (dataSource === 'phone') {
      void deleteAllClips();
      if (audioPermissionStatus() === 'denied') {
        Alert.alert('Microphone Access Required', 'Coco needs mic access to detect snoring and sleep sounds.\n\nGo to Settings → Privacy → Microphone → Coco and enable it.', [
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          { text: 'Continue Without Mic', style: 'cancel' },
        ]);
      } else {
        try {
          const micOn = await startAudioSampling((event) => { setLiveAudioType(event.type); addAudioEvent(event); });
          if (!micOn) Alert.alert('Microphone Off', 'Coco needs mic access to detect sounds. Enable it in Settings → Privacy → Microphone → Coco.');
        } catch { /* audio sampling failed — tracking continues via motion */ }
      }
    }
    if (coachSettings.screenTimeEnabled && ScreenTimeManager.isAvailable) {
      void ScreenTimeManager.startSleepBlock([], 480);
    }
    void syncWidgetState({
      recoveryScore: null, streak, tierName: getTierForLevel(tier).name, mood,
      isTracking: true, bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime, cocoLevel: 'normal',
    });
  }

  async function handleStartTracking() {
    setShowSetupModal(false);
    startSession();
    void startBackgroundKeepAlive();
    if (dataSource === 'phone') {
      void deleteAllClips();
      if (audioPermissionStatus() === 'denied') {
        Alert.alert('Microphone Access Required', 'Coco needs mic access to detect snoring and sleep sounds.\n\nGo to Settings → Privacy → Microphone → Coco and enable it.', [
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          { text: 'Continue Without Mic', style: 'cancel' },
        ]);
      } else {
        try {
          const micOn = await startAudioSampling((event) => { setLiveAudioType(event.type); addAudioEvent(event); });
          if (!micOn) Alert.alert('Microphone Off', 'Coco needs mic access to detect sounds. Enable it in Settings → Privacy → Microphone → Coco.');
        } catch { /* audio sampling failed — tracking continues via motion */ }
      }
    }
    if (coachSettings.screenTimeEnabled && ScreenTimeManager.isAvailable) {
      void ScreenTimeManager.startSleepBlock([], 480);
    }
    void syncWidgetState({
      recoveryScore: null, streak, tierName: getTierForLevel(tier).name, mood,
      isTracking: true, bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime, cocoLevel: 'normal',
    });
  }

  function discardSession() {
    void syncWidgetState({
      recoveryScore: 0, streak, tierName: getTierForLevel(tier).name, mood, isTracking: false,
      bedtimeTime: coachSettings.bedtimeReminderTime, wakeTime: coachSettings.wakeTime, cocoLevel: 'normal',
    });
    stopBackgroundKeepAlive();
    void stopAudioSampling();
    setLiveAudioType('quiet');
    endSession();
  }

  async function handleStop(autoEnded = false) {
    const MIN_SESSION_MS = 10 * 60 * 1000;
    const durationMs = Date.now() - (activeSession?.startedAt ?? Date.now());
    if (!autoEnded && durationMs < MIN_SESSION_MS) {
      const remaining = Math.ceil((MIN_SESSION_MS - durationMs) / 60000);
      Alert.alert(
        'TOO SHORT TO SAVE',
        `Sessions under 10 minutes don't produce meaningful sleep data — ${remaining} minute${remaining === 1 ? '' : 's'} to go.\n\nDiscard this session instead?`,
        [
          { text: 'Keep Tracking', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: discardSession },
        ]
      );
      return;
    }
    void syncWidgetState({
      recoveryScore: 0, streak, tierName: getTierForLevel(tier).name, mood, isTracking: false,
      bedtimeTime: coachSettings.bedtimeReminderTime, wakeTime: coachSettings.wakeTime, cocoLevel: 'normal',
    });
    stopBackgroundKeepAlive();
    await stopAudioSampling();
    setLiveAudioType('quiet');
    const startedAt = activeSession?.startedAt ?? Date.now();
    const raw = endSession();
    if (!raw) return;
    if (dataSource === 'watch') {
      const watchData = await fetchNightData(startedAt, Date.now());
      if (watchData) {
        patchWatchData({
          movementEvents: watchData.movementEvents, disruptionCount: watchData.disruptionCount,
          watchHRV: watchData.hrvRMSSD, watchHeartRate: watchData.avgHeartRate,
        });
        raw.movementEvents = watchData.movementEvents;
        raw.disruptionCount = watchData.disruptionCount;
        raw.watchHRV = watchData.hrvRMSSD;
        raw.watchHeartRate = watchData.avgHeartRate;
      }
    }
    // Attach saved clip URIs to audio events for morning playback
    if (raw.audioEvents.length > 0) {
      raw.audioEvents = await matchClipsToEvents(raw.audioEvents);
    }
    const processed = processSession(raw);
    const prevLevel = cocoLevel;
    applySessionLevel(processed.recovery.recoveryScore);
    // Show level-up celebration immediately if level went up
    const newLevel = processed.recovery.recoveryScore > 60 ? prevLevel + 1 : prevLevel;
    if (newLevel > prevLevel) triggerLevelUpCelebration(newLevel);
    // Social notification (fire & forget — throttled, no-ops if no friends)
    if (userId) void scheduleSocialNotifications(userId, processed.recovery.recoveryScore, streak);
    const evolution  = evolve(processed.recovery.recoveryScore);
    const growth = streakToGrowthStage(streak + 1);
    if (evolution.tieredUp) Alert.alert('COCO EVOLVED', `Coco reached ${evolution.tierName}.\nKeep the streak going to unlock ${growth.name}.`);
    void syncWidgetState({
      recoveryScore: processed.recovery.recoveryScore, streak,
      tierName: getTierForLevel(evolution.newTier ?? tier).name, mood, isTracking: false,
      bedtimeTime: coachSettings.bedtimeReminderTime, wakeTime: coachSettings.wakeTime,
      cocoLevel: scoreToCocoLevel(processed.recovery.recoveryScore),
    });
  }

  // Coco growth image — used in both hero and level-up modal
  const cocoGrowth   = streakToGrowthStage(streak);
  const cocoGrowthPct = cocoGrowth.nextAt !== null
    ? Math.round(((streak - cocoGrowth.minStreak) / (cocoGrowth.nextAt - cocoGrowth.minStreak)) * 100)
    : 100;
  const cocoSubImg = GROWTH_STAGE_IMAGES[cocoGrowth.stage][cocoGrowthPct >= 67 ? 2 : cocoGrowthPct >= 34 ? 1 : 0];

  const watchConnected = watchStatus === 'authorized';
  const totalNights  = history.length;
  const avgRecovery  = totalNights > 0
    ? Math.round(history.reduce((s, n) => s + n.recovery.recoveryScore, 0) / totalNights) : 0;
  const selectedSession = history.find((s) => s.id === selectedTab) ?? null;

  // ── Active tracking fullscreen ─────────────────────────────────────────────
  if (isTracking) {
    const stageCfg = STAGE_CFG[currentStage];
    const stageColor = stageCfg.color;
    const now = Date.now();
    const startedAt = activeSession?.startedAt ?? now;
    const onsetAt   = activeSession?.sleepOnsetAt ?? null;
    const elapsedMs = now - startedAt;
    const durations = activeSession?.movementEvents.length
      ? estimateStageDurations(activeSession.movementEvents)
      : { dozing: 0, snoozing: 0, slumbering: 0, rem: 0, awake: 0 };
    const totalTrackedMin = Object.values(durations).reduce((a, b) => a + b, 0) || 1;

    return (
      <View style={styles.container}>
        <View style={styles.trackingScreen}>
          <View style={styles.trackingTopBar}>
            <View style={[styles.trackingSourcePill, { borderColor: dataSource === 'watch' ? Colors.info : stageColor }]}>
              <Text style={[styles.trackingSourceText, { color: dataSource === 'watch' ? Colors.info : stageColor }]}>
                {dataSource === 'watch' ? 'APPLE WATCH' : 'PHONE'}
              </Text>
            </View>
          </View>

          <Text style={[styles.stageName, { color: stageColor }]}>{stageCfg.label}</Text>
          <Text style={styles.stageSub}>{stageCfg.sub}</Text>

          {/* Coco sleeping — gentle float + breathe */}
          <Animated.View style={[styles.cocoSleepWrap, cocoSleepStyle]}>
            <Image source={cocoSubImg} style={styles.cocoSleepImg} resizeMode="contain" />
          </Animated.View>

          <View style={styles.pulseContainer}>
            <Animated.View style={[styles.pulseRing, { borderColor: stageColor }, pulseStyle]} />
            <View style={[styles.pulseDot, { backgroundColor: stageColor }]} />
          </View>

          {onsetAt ? (
            <View style={styles.onsetRow}>
              <Text style={styles.onsetLabel}>FELL ASLEEP AT</Text>
              <Text style={[styles.onsetTime, { color: stageColor }]}>{formatClockTime(onsetAt)}</Text>
            </View>
          ) : (
            <View style={styles.onsetRow}>
              <Text style={styles.onsetLabel}>DETECTING SLEEP ONSET...</Text>
            </View>
          )}

          <Text style={styles.elapsedTime}>{formatElapsed(elapsedMs)}</Text>
          <Text style={styles.elapsedLabel}>TOTAL TRACKED</Text>

          {activeSession && activeSession.movementEvents.length > 0 && (
            <View style={styles.stageBarWrap}>
              <View style={styles.stageBarTrack}>
                {(['slumbering', 'rem', 'snoozing', 'dozing', 'awake'] as SleepStage[]).map((s) => {
                  const pct = (durations[s] / totalTrackedMin) * 100;
                  if (pct < 1) return null;
                  return <View key={s} style={[styles.stageBarSegment, { width: `${pct}%`, backgroundColor: STAGE_CFG[s].color }]} />;
                })}
              </View>
              <View style={styles.stageLegendRow}>
                {(['slumbering', 'rem', 'snoozing', 'dozing', 'awake'] as SleepStage[]).map((s) => {
                  const min = durations[s];
                  if (min === 0) return null;
                  return (
                    <View key={s} style={styles.stageLegendItem}>
                      <View style={[styles.stageLegendDot, { backgroundColor: STAGE_CFG[s].color }]} />
                      <Text style={styles.stageLegendText}>{STAGE_CFG[s].label} {min}M</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {dataSource === 'phone' && (
            <View style={styles.audioIndicator}>
              <Text style={styles.audioIndicatorIcon}>{audioTypeIcon(liveAudioType)}</Text>
              <View>
                <Text style={[styles.audioIndicatorLabel,
                  liveAudioType === 'quiet'      ? { color: Colors.textMuted } :
                  liveAudioType === 'snoring'    ? { color: Colors.gold }      :
                  liveAudioType === 'talking'    ? { color: Colors.info }      : { color: Colors.red }
                ]}>
                  {audioTypeLabel(liveAudioType)}
                </Text>
                <Text style={styles.audioIndicatorSub}>MOTION MONITORING</Text>
              </View>
            </View>
          )}

          <View style={styles.stopBtnFixed}>
            <TouchableOpacity onPress={() => void handleStop()} activeOpacity={0.8}>
              <View style={styles.stopBtnOuter}>
                <View style={[styles.stopBtnInner, { backgroundColor: stageColor }]}>
                  <Text style={styles.stopBtnText}>■  WAKE UP — STOP TRACKING</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Combined home + sleep log (single scroll) ────────────────────────────
  const visibleHistory = isPremium ? history : history.slice(0, 7);

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Coco Growth Card ─────────────────────────────────────────── */}
        {(() => {
          return (
            <View style={styles.growthHero}>
              {/* Coco hero image — animated idle */}
              <View style={styles.growthHeroWrap}>
                <Animated.View style={cocoIdleStyle}>
                  <Image source={cocoSubImg} style={styles.growthHeroImg} resizeMode="contain" />
                </Animated.View>
              </View>

              {/* Level — grand metallic gold */}
              <Text style={styles.growthLevelNum}>
                LVL {cocoLevel}
              </Text>

              {/* Stage name */}
              <Text style={[styles.growthStageName, { color: cocoGrowth.color }]}>{cocoGrowth.name}</Text>

              {/* Streak — golden glow, brighter with more days */}
              {(() => {
                const t = Math.min(streak / 14, 1);
                const r = 1.0;
                const g = 1.0 - 0.22 * t;
                const b = 1.0 - 0.74 * t;
                const streakHex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
                const glowRadius = 4 + 20 * t;
                return (
                  <View style={styles.growthStreakBadge}>
                    <Text style={[styles.growthStreakNum, { color: streakHex, textShadowColor: streakHex, textShadowRadius: glowRadius }]}>{streak}</Text>
                    <Text style={[styles.growthStreakLabel, { color: streakHex, opacity: 0.8 }]}>DAY STREAK</Text>
                  </View>
                );
              })()}
            </View>
          );
        })()}

        {/* ── RECOVERY ENGINE ──────────────────────────────────────────────── */}
        <Text style={styles.sectionEyebrow}>// RECOVERY ENGINE</Text>
        <View style={styles.recoveryEngineCard}>
          <DiagonalStripes color={Colors.red} opacity={0.03} />

          {/* Top row: last night score + tonight target */}
          <View style={styles.reTopRow}>
            <View style={styles.reScoreBlock}>
              <Text style={styles.reBlockLabel}>LAST NIGHT</Text>
              {adjustedScore !== null ? (
                <>
                  <Text style={[styles.reScoreNum, { color: scoreColor(Math.min(adjustedScore, 100)) }]}>
                    {Math.min(adjustedScore, 100)}%
                  </Text>
                  <Text style={[styles.reScoreTag, {
                    color: adjustedScore >= 90 ? Colors.green : adjustedScore >= 70 ? Colors.gold : Colors.red
                  }]}>
                    {adjustedScore >= 90 ? 'FULLY RECOVERED' : adjustedScore >= 70 ? 'GOOD RECOVERY' : 'UNDER RECOVERED'}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.reScoreNum, { color: Colors.textMuted }]}>—</Text>
                  <Text style={styles.reScoreTag}>NO DATA YET</Text>
                </>
              )}
            </View>

            <View style={styles.reDivider} />

            <View style={styles.reTargetBlock}>
              <Text style={styles.reBlockLabel}>TONIGHT'S TARGET</Text>
              <Text style={styles.reTargetNum}>{formatTargetHours(sleepTarget)}</Text>
              <Text style={styles.reTargetSub}>
                {todayWorkout && todayWorkout.type !== 'rest'
                  ? `+${formatTargetHours(todayWorkout.load / 300)} workout`
                  : 'base target'}
              </Text>
            </View>
          </View>

          {/* Strain / Recovery balance bar */}
          <View style={styles.reBalanceRow}>
            <View style={styles.reBalanceTrack}>
              <View style={[
                styles.reBalanceFill,
                {
                  width: `${Math.round(strainBalance.balance * 100)}%` as any,
                  backgroundColor:
                    strainBalance.color === 'green' ? Colors.green :
                    strainBalance.color === 'gold' ? Colors.gold : Colors.red,
                }
              ]} />
            </View>
            <Text style={[
              styles.reBalanceLabel,
              {
                color: strainBalance.color === 'green' ? Colors.green :
                  strainBalance.color === 'gold' ? Colors.gold : Colors.red,
              }
            ]}>
              {strainBalance.label}
            </Text>
            <Text style={styles.reBalanceSub}>7-DAY STRAIN / RECOVERY</Text>
          </View>

          {recoveryScore !== null && (
            <Text style={styles.reForecast}>{latestSession?.recovery.performanceForecast}</Text>
          )}

          <TouchableOpacity onPress={() => router.push('/(tabs)/report')} style={styles.reStatLink}>
            <Text style={styles.reportLink}>VIEW STATISTICS →</Text>
          </TouchableOpacity>
        </View>

        {/* Workout Logger */}
        <WorkoutLogger />

        {recoveryScore === null && (
          <View style={styles.noDataCard}>
            <DiagonalStripes opacity={0.04} />
            <View style={styles.noDataInner}>
              <Text style={styles.noDataText}>NO SLEEP DATA YET.</Text>
              <Text style={styles.noDataSub}>Track tonight to see your recovery score.</Text>
            </View>
          </View>
        )}

        {/* Streak + Debt */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: Colors.gold }]}>
            <Text style={styles.statLabel}>STREAK</Text>
            <Text style={[styles.statValue, { color: Colors.gold }]}>{streak} {streak === 1 ? 'NIGHT' : 'NIGHTS'}</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: debtColor }]}>
            <Text style={styles.statLabel}>SLEEP DEBT</Text>
            <Text style={[styles.statValue, { color: debtColor }]}>{debtLabel}</Text>
          </View>
        </View>

        {/* Activity */}
        <Text style={styles.sectionEyebrow}>// TODAY'S ACTIVITY</Text>
        <View style={styles.activityRow}>
          <View style={[styles.activityCard, { borderLeftColor: stepColor }]}>
            <View style={styles.activityCardInner}>
              <Text style={styles.activityIcon}>👟</Text>
              <Text style={[styles.activityNum, { color: stepColor }]}>{steps.toLocaleString()}</Text>
              <Text style={styles.activityLabel}>STEPS</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${stepPct * 100}%`, backgroundColor: stepColor }]} />
              </View>
              <Text style={styles.activityGoal}>GOAL: {stepGoal.toLocaleString()}</Text>
            </View>
          </View>
          <View style={[styles.activityCard, { borderLeftColor: waterColor }]}>
            <View style={styles.activityCardInner}>
              <Text style={styles.activityIcon}>💧</Text>
              <Text style={[styles.activityNum, { color: waterColor }]}>{waterIntake}</Text>
              <Text style={styles.activityLabel}>GLASSES</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${waterPct * 100}%`, backgroundColor: waterColor }]} />
              </View>
              <View style={styles.waterBtns}>
                <TouchableOpacity onPress={removeWater} style={styles.waterBtn}>
                  <Text style={styles.waterBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.waterGoalLabel}>/ {waterGoal}</Text>
                <TouchableOpacity onPress={() => addWater()} style={styles.waterBtn}>
                  <Text style={styles.waterBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Bottom padding for CTA */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* TRACK TONIGHT CTA */}
      <View style={styles.ctaBar}>
        <TouchableOpacity onPress={() => setShowSetupModal(true)} activeOpacity={0.85}>
          <View style={styles.ctaBtnOuter}>
            <DiagonalStripes color={Colors.red} opacity={0.12} />
            <View style={styles.ctaBtnInner}>
              <Text style={styles.ctaBtnText}>TRACK TONIGHT</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Setup modal */}
      <Modal visible={showSetupModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSetupModal(false)}>
        <SetupModal
          dataSource={dataSource}
          watchConnected={watchConnected}
          onSelectSource={handleSelectSource}
          onStart={handleStartTracking}
          onClose={() => setShowSetupModal(false)}
        />
      </Modal>

      {/* ── Level-up blocking modal — user can't interact until animation finishes ── */}
      <Modal visible={showLevelUpModal} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.levelUpOverlay}>
          <Animated.View style={{ transform: [{ scale: levelUpScale }], alignItems: 'center' }}>
            <Image source={cocoSubImg} style={styles.levelUpModalImg} resizeMode="contain" />
          </Animated.View>
          <Animated.Text style={[styles.levelUpModalLevel, { transform: [{ scale: levelUpScale }] }]}>
            LVL {cocoLevel}
          </Animated.Text>
          <Text style={styles.levelUpModalFlash}>LEVEL UP</Text>
          <Text style={styles.levelUpModalSub}>Keep tracking to keep growing.</Text>
        </View>
      </Modal>
    </View>
  );
}

// ─── Clip Row ─────────────────────────────────────────────────────────────────

function ClipRow({ event }: { event: AudioEvent }) {
  const player = useAudioPlayer(event.clipUri ? { uri: event.clipUri } : null as any);
  const [playing, setPlaying] = useState(false);

  async function toggle() {
    if (!event.clipUri) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.seekTo(0);
      player.play();
      setPlaying(true);
    }
  }

  const typeColor =
    event.type === 'snoring'    ? Colors.gold :
    event.type === 'talking'    ? Colors.info :
    event.type === 'loud_event' ? Colors.red  : Colors.textMuted;

  return (
    <View style={styles.clipRow}>
      <Text style={styles.clipIcon}>{audioTypeIcon(event.type)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.clipType, { color: typeColor }]}>{audioTypeLabel(event.type)}</Text>
        <Text style={styles.clipTime}>{formatClockTime(event.timestamp)}</Text>
      </View>
      {event.clipUri && (
        <TouchableOpacity onPress={toggle} style={[styles.clipPlayBtn, playing && { borderColor: typeColor }]}>
          <Text style={[styles.clipPlayText, { color: typeColor }]}>{playing ? '■' : '▶'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Night Panel ──────────────────────────────────────────────────────────────

function NightPanel({ session, isPremium }: { session: ProcessedSession; isPremium: boolean }) {
  const score    = session.recovery.recoveryScore;
  const color    = scoreColor(score);
  const cocoInfo = COCO_LEVELS[scoreToCocoLevel(score)];
  const visibleInsights = session.recovery.insights.filter((i) => !i.isPremium || isPremium);

  return (
    <View>
      {/* Header */}
      <View style={styles.nightHeader}>
        <Text style={styles.nightDate}>{nightFullLabel(session.date)}</Text>
        <View style={[styles.srcBadge, { borderColor: session.dataSource === 'watch' ? Colors.info : Colors.textMuted }]}>
          <Text style={[styles.srcBadgeText, { color: session.dataSource === 'watch' ? Colors.info : Colors.textMuted }]}>
            {session.dataSource === 'watch' ? 'WATCH' : 'PHONE'}
          </Text>
        </View>
      </View>

      {/* Coco grade */}
      <View style={[styles.cocoHero, { borderColor: cocoInfo.color }]}>
        <DiagonalStripes color={cocoInfo.color} opacity={0.05} />
        <View style={styles.cocoHeroInner}>
          {cocoInfo.image && <Image source={cocoInfo.image} style={styles.cocoHeroImg} resizeMode="contain" />}
          <View style={{ flex: 1 }}>
            <Text style={[styles.cocoGradeLabel, { color: cocoInfo.color }]}>{cocoInfo.label} COCO</Text>
            <Text style={styles.cocoGradeSub}>RECOVERY GRADE</Text>
          </View>
        </View>
      </View>

      {/* Score bar */}
      <View style={styles.scoreBarTrack}>
        <View style={[styles.scoreBarFill, { width: `${score}%`, backgroundColor: color }]} />
      </View>

      {/* Stats grid */}
      <View style={styles.nightStatsGrid}>
        {[
          { label: 'DURATION',   value: formatDur(session.durationHours) },
          { label: 'EFFICIENCY', value: `${session.scores.sleepEfficiency}%` },
          { label: 'SCORE',      value: `${score}` },
          { label: 'LATENCY',    value: session.scores.sleepLatencyMinutes > 0 ? `${session.scores.sleepLatencyMinutes}M` : '—' },
          { label: 'WASO',       value: session.scores.wasoMinutes > 0 ? `${session.scores.wasoMinutes}M` : '—' },
          { label: 'HRV PROXY',  value: `${Math.round(session.recovery.hrvProxy)}` },
        ].map((s) => (
          <View key={s.label} style={styles.nightStat}>
            <Text style={styles.nightStatNum}>{s.value}</Text>
            <Text style={styles.nightStatLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Charts — always shown */}
      {(() => {
        const endedAt   = new Date(session.date).getTime();
        const startedAt = endedAt - session.durationHours * 3_600_000;
        const chartEvents = (session.movementEvents?.length ?? 0) > 0
          ? session.movementEvents!
          : generateEstimatedEvents(startedAt, endedAt, null);
        if (chartEvents.length === 0) {
          return (
            <View style={styles.noDataCard}>
              <View style={styles.noDataInner}>
                <Text style={styles.noDataText}>NO STAGE DATA</Text>
                <Text style={styles.noDataSub}>Session too short to analyze stages</Text>
              </View>
            </View>
          );
        }
        return (
          <>
            <StageTimeline events={chartEvents} audioEvents={session.audioEvents} />
            <MovementGraph events={chartEvents} />
          </>
        );
      })()}

      {/* Sleep sounds — always shown */}
      {(() => {
        const events = session.audioEvents ?? [];
        const nonQuiet = events.filter((e) => e.type !== 'quiet');
        const counts = {} as Record<AudioEvent['type'], number>;
        for (const e of nonQuiet) counts[e.type] = (counts[e.type] ?? 0) + 1;
        return (
          <View style={styles.soundsCard}>
            <View style={styles.soundsInner}>
              <Text style={styles.soundsTitle}>SLEEP SOUNDS</Text>
              {nonQuiet.length === 0 ? (
                <Text style={styles.soundsEmpty}>No sounds detected</Text>
              ) : (
                <View style={styles.soundsRow}>
                  {(['snoring', 'talking', 'loud_event'] as AudioEvent['type'][])
                    .filter((t) => counts[t] > 0)
                    .map((t) => (
                      <View key={t} style={styles.soundChip}>
                        <Text style={styles.soundChipIcon}>{audioTypeIcon(t)}</Text>
                        <Text style={styles.soundChipLabel}>{audioTypeLabel(t)}</Text>
                        <Text style={styles.soundChipCount}>{counts[t]}×</Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          </View>
        );
      })()}

      {/* Audio clips */}
      {(() => {
        const clips = (session.audioEvents ?? []).filter((e) => e.clipUri && e.type !== 'quiet');
        if (clips.length === 0) return null;
        return (
          <View style={styles.soundsCard}>
            <View style={styles.soundsInner}>
              <Text style={styles.soundsTitle}>RECORDED CLIPS</Text>
              {clips.map((e, i) => <ClipRow key={i} event={e} />)}
            </View>
          </View>
        );
      })()}

    </View>
  );
}

// ─── Setup Modal ──────────────────────────────────────────────────────────────

function SetupModal({ dataSource, watchConnected, onSelectSource, onStart, onClose }: {
  dataSource: DataSource; watchConnected: boolean;
  onSelectSource: (s: DataSource) => void;
  onStart: () => void; onClose: () => void;
}) {
  return (
    <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
      <View style={{ marginBottom: 28 }}>
        <Text style={styles.eyebrow}>// SLEEP SETUP</Text>
        <Text style={styles.title}>TONIGHT</Text>
        <View style={styles.titleBar} />
      </View>

      <Text style={styles.sectionLabel}>TRACKING SOURCE</Text>
      <View style={styles.sourceRow}>
        {(['phone', 'watch'] as DataSource[]).map((src) => {
          const active = dataSource === src;
          return (
            <TouchableOpacity key={src} style={[styles.sourceBtn, active && styles.sourceBtnActive]} onPress={() => onSelectSource(src)}>
              <Text style={styles.sourceIcon}>{src === 'phone' ? 'PHN' : 'WCH'}</Text>
              <Text style={[styles.sourceName, active && styles.sourceNameActive]}>{src === 'phone' ? 'PHONE' : 'APPLE WATCH'}</Text>
              <Text style={styles.sourceDesc}>{src === 'phone' ? 'Accelerometer\non mattress' : 'Real HRV +\nsleep stages'}</Text>
              {src === 'watch' && active && watchConnected && (
                <View style={styles.connectedBadge}><Text style={styles.connectedText}>CONNECTED</Text></View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {dataSource === 'watch' && (
        <View style={styles.watchInfo}>
          <DiagonalStripes color={Colors.info} opacity={0.06} />
          <View style={{ padding: 14 }}>
            <Text style={styles.watchInfoTitle}>APPLE WATCH MODE</Text>
            <Text style={styles.watchInfoBody}>Your Watch tracks sleep natively. When you stop, Coco reads real HRV, heart rate, and sleep stages from HealthKit.</Text>
          </View>
        </View>
      )}


      <TouchableOpacity onPress={onStart} style={{ marginTop: 8 }}>
        <View style={styles.startBtnOuter}>
          <View style={styles.startBtnInner}>
            <Text style={styles.startBtnText}>{dataSource === 'watch' ? 'START WITH WATCH' : 'START TRACKING'}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>CANCEL</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 24, paddingTop: 56, paddingBottom: 8 },

  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 4 },
  title: { fontSize: 46, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 48 },
  titleBar: { height: 3, width: 52, backgroundColor: Colors.red, marginTop: 6, marginBottom: 20 },

  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  tierEmoji: { fontSize: 48, lineHeight: 58 },
  tierName: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },

  // Growth hero — seamless on black
  growthHero: {
    alignItems: 'center', marginBottom: 28, marginTop: 4,
  },
  growthHeroWrap: {
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  growthHeroImg: { width: 190, height: 190 },
  growthLevelNum: {
    fontSize: 52, fontWeight: '900', fontStyle: 'italic', letterSpacing: 4,
    color: '#F5C842',
    textShadowColor: '#FFE066', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
    marginBottom: 2, marginTop: -4,
  },
  // Level-up blocking modal
  levelUpOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.97)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  levelUpModalImg: { width: 260, height: 260 },
  levelUpModalLevel: {
    fontSize: 72, fontWeight: '900', fontStyle: 'italic', letterSpacing: 6,
    color: '#F5C842',
    textShadowColor: '#FFE066', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  levelUpModalFlash: {
    fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: 5,
    color: '#FFE066', marginTop: 4,
    textShadowColor: '#F5C842', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  levelUpModalSub: {
    fontSize: 11, fontWeight: '700', letterSpacing: 2,
    color: Colors.textMuted, marginTop: 8,
  },
  growthStreakBadge: {
    alignItems: 'center', marginTop: 16,
  },
  growthStreakLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 3, textShadowOffset: { width: 0, height: 0 } },
  growthStreakNum: { fontSize: 72, fontWeight: '900', fontStyle: 'italic', lineHeight: 76, textShadowOffset: { width: 0, height: 0 } },
  growthStageRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  growthStageName: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, marginBottom: 2 },
  growthStageDesc: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic', marginBottom: 6 },
  growthBarTrack: { height: 3, backgroundColor: Colors.border, marginBottom: 6, overflow: 'hidden', width: '80%' },
  growthBarFill: { height: 3 },
  growthProgress: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, marginBottom: 0, textAlign: 'center' },
  growthMessage: { fontSize: 12, fontStyle: 'italic', color: Colors.textSecondary, lineHeight: 17, textAlign: 'center', marginBottom: 4, paddingHorizontal: 20 },

  scoreCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 5, marginBottom: 14, overflow: 'hidden',
  },
  scoreCardInner: { padding: 18 },
  scoreLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textMuted, marginBottom: 4 },
  scoreValue: { fontSize: 64, fontWeight: '900', fontStyle: 'italic', lineHeight: 68 },
  scoreAccent: { height: 3, width: 40, marginTop: 4, marginBottom: 8 },
  scoreSub: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  reportLink: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.red },

  // Recovery Engine card
  recoveryEngineCard: {
    backgroundColor: '#111', borderLeftWidth: 4, borderLeftColor: Colors.red,
    overflow: 'hidden', marginBottom: 12,
  },
  reTopRow: {
    flexDirection: 'row', alignItems: 'stretch', padding: 16, paddingBottom: 12, gap: 0,
  },
  reScoreBlock: { flex: 1, paddingRight: 16 },
  reDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4, marginHorizontal: 8 },
  reTargetBlock: { flex: 1, paddingLeft: 8 },
  reBlockLabel: {
    fontSize: 8, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, color: Colors.textMuted, marginBottom: 4,
  },
  reScoreNum: {
    fontSize: 42, fontWeight: '900', fontStyle: 'italic', lineHeight: 46,
  },
  reScoreTag: {
    fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, marginTop: 2,
  },
  reTargetNum: {
    fontSize: 32, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 36,
  },
  reTargetSub: {
    fontSize: 9, color: Colors.textMuted, marginTop: 3,
  },
  reBalanceRow: { paddingHorizontal: 16, paddingBottom: 14 },
  reBalanceTrack: {
    height: 4, backgroundColor: Colors.border, overflow: 'hidden', marginBottom: 6,
  },
  reBalanceFill: { height: 4 },
  reBalanceLabel: {
    fontSize: 10, fontWeight: '800', fontStyle: 'italic', marginBottom: 2,
  },
  reBalanceSub: {
    fontSize: 8, fontWeight: '700', letterSpacing: 2, color: Colors.textMuted,
  },
  reForecast: {
    fontSize: 12, color: Colors.textSecondary, lineHeight: 18,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  reStatLink: { paddingHorizontal: 16, paddingBottom: 14 },

  noDataCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 5, borderLeftColor: Colors.textMuted,
    marginBottom: 14, overflow: 'hidden',
  },
  noDataInner: { padding: 24, alignItems: 'center' },
  noDataText: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 8 },
  noDataSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, padding: 14,
  },
  statLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '900', fontStyle: 'italic' },

  sectionEyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textMuted, marginBottom: 10 },
  activityRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  activityCard: {
    flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, overflow: 'hidden',
  },
  activityCardInner: { padding: 14 },
  activityIcon: { fontSize: 20, marginBottom: 6 },
  activityNum: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', lineHeight: 30 },
  activityLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginBottom: 8 },
  barTrack: { height: 3, backgroundColor: Colors.border, marginBottom: 8, overflow: 'hidden' },
  barFill: { height: 3 },
  activityGoal: { fontSize: 9, color: Colors.textMuted, fontWeight: '600' },
  waterBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waterBtn: { width: 28, height: 28, backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  waterBtnText: { fontSize: 18, fontWeight: '900', color: Colors.textPrimary, lineHeight: 22 },
  waterGoalLabel: { fontSize: 11, fontWeight: '900', color: Colors.textMuted },

  // Sleep log section header
  sleepLogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  avgBadge: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted, letterSpacing: 1 },

  // Night picker chips (inline horizontal scroll)
  nightPickerRow: { gap: 8, paddingBottom: 14 },
  nightChip: {
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, minWidth: 64,
  },
  nightChipActive: { borderColor: Colors.red, backgroundColor: 'rgba(255,45,45,0.08)' },
  nightChipImg: { width: 28, height: 28, marginBottom: 4 },
  nightChipDate: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted },
  nightChipScore: { fontSize: 13, fontWeight: '900', marginTop: 2 },
  nightChipLocked: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.gold, borderRadius: 8, minWidth: 52, justifyContent: 'center' },
  nightChipLockedLabel: { fontSize: 11, fontWeight: '900', color: Colors.gold },
  nightChipLockedSub: { fontSize: 8, fontWeight: '900', color: Colors.gold, marginTop: 2 },

  emptyState: { alignItems: 'center', paddingTop: 40, paddingBottom: 24 },
  emptyGlyph: { fontSize: 40, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted, marginBottom: 12 },
  emptyTitle: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textSecondary, marginBottom: 6 },
  emptySub: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },

  // Night panel
  nightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  nightDate: { fontSize: 16, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 1 },
  trainingBadge: { marginTop: 5, alignSelf: 'flex-start', backgroundColor: Colors.bgCard, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Colors.border },
  trainingBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  srcBadge: { borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 4 },
  srcBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },

  cocoHero: { borderWidth: 2, borderLeftWidth: 5, marginBottom: 8, backgroundColor: Colors.bgCard, overflow: 'hidden' },
  cocoHeroInner: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  cocoHeroImg: { width: 64, height: 64 },
  cocoGradeLabel: { fontSize: 18, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  cocoGradeSub: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 3 },
  recPill: { borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 5 },
  recPillText: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },

  scoreBarTrack: { height: 4, backgroundColor: Colors.border, marginBottom: 12, overflow: 'hidden' },
  scoreBarFill: { height: '100%' },

  nightStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14, gap: 1, backgroundColor: Colors.border },
  nightStat: { width: '33.33%', backgroundColor: Colors.bgCard, padding: 12, alignItems: 'center' },
  nightStatNum: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  nightStatLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted, marginTop: 3 },

  soundsCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: Colors.info, marginBottom: 12 },
  soundsInner: { padding: 12 },
  soundsTitle: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.info, marginBottom: 8 },
  soundsEmpty: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  soundsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  soundChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 8, paddingVertical: 5 },
  soundChipIcon: { fontSize: 12 },
  soundChipLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.textSecondary },
  soundChipCount: { fontSize: 9, fontWeight: '900', color: Colors.textMuted },

  insightCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, marginBottom: 8, overflow: 'hidden' },
  insightInner: { padding: 14 },
  insightTitle: { fontSize: 8, fontWeight: '900', letterSpacing: 2, marginBottom: 5 },
  insightBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },

  // CTA
  ctaBar: { paddingHorizontal: 16, paddingBottom: 12, paddingTop: 10, backgroundColor: Colors.bgDeep, borderTopWidth: 1, borderTopColor: Colors.border },
  ctaBtnOuter: { overflow: 'hidden' },
  ctaBtnInner: { backgroundColor: Colors.red, paddingVertical: 16, alignItems: 'center', transform: [{ skewX: '-1.5deg' }] },
  ctaBtnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff', transform: [{ skewX: '1.5deg' }] },

  // Tracking
  cocoSleepWrap: { marginBottom: 8, alignItems: 'center' },
  cocoSleepImg: { width: 100, height: 100, opacity: 0.85 },
  trackingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 120 },
  trackingTopBar: { position: 'absolute', top: 56, alignItems: 'center' },
  trackingSourcePill: { borderWidth: 2, paddingHorizontal: 20, paddingVertical: 6 },
  trackingSourceText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },
  stageName: { fontSize: 34, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, textAlign: 'center', marginBottom: 6 },
  stageSub: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginBottom: 28, letterSpacing: 1 },
  pulseContainer: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  pulseRing: { position: 'absolute', width: 80, height: 80, borderRadius: 0, borderWidth: 2 },
  pulseDot: { width: 14, height: 14 },
  onsetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  onsetLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  onsetTime: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  elapsedTime: { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 52, marginTop: 8 },
  elapsedLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 3, color: Colors.textMuted, marginBottom: 28 },
  stageBarWrap: { width: '100%', marginBottom: 28 },
  stageBarTrack: { height: 6, flexDirection: 'row', backgroundColor: Colors.border, marginBottom: 10, overflow: 'hidden' },
  stageBarSegment: { height: '100%' },
  stageLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  stageLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stageLegendDot: { width: 6, height: 6 },
  stageLegendText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: Colors.textMuted },
  audioIndicator: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 20, width: '100%', borderLeftWidth: 3 },
  audioIndicatorIcon: { fontSize: 20 },
  audioIndicatorLabel: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  audioIndicatorSub: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 2 },
  stopBtnFixed: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingBottom: 36, paddingTop: 12, backgroundColor: Colors.bgDeep, borderTopWidth: 1, borderTopColor: Colors.border },
  stopBtnOuter: { transform: [{ skewX: '-1.5deg' }] },
  stopBtnInner: { paddingVertical: 20, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  stopBtnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },

  // Setup modal
  modal: { flex: 1, backgroundColor: Colors.bgDeep },
  modalContent: { padding: 24, paddingBottom: 48 },
  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary, marginBottom: 12, textTransform: 'uppercase' },
  sourceRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sourceBtn: { flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.textMuted, padding: 16, alignItems: 'center', gap: 4 },
  sourceBtnActive: { borderColor: Colors.red, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  sourceIcon: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted, marginBottom: 4 },
  sourceName: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textSecondary },
  sourceNameActive: { color: Colors.red },
  sourceDesc: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', lineHeight: 15 },
  connectedBadge: { marginTop: 6, backgroundColor: Colors.info, paddingHorizontal: 8, paddingVertical: 3 },
  connectedText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  watchInfo: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: Colors.info, marginBottom: 4, overflow: 'hidden' },
  watchInfoTitle: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.info, marginBottom: 6 },
  watchInfoBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  trainingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  chip: { width: '22%', aspectRatio: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', gap: 4 },
  chipActive: { borderColor: Colors.red, borderLeftWidth: 3, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  chipEmoji: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted },
  chipLabel: { fontSize: 8, fontWeight: '900', color: Colors.textSecondary },
  chipLabelActive: { color: Colors.red },
  startBtnOuter: { transform: [{ skewX: '-1.5deg' }] },
  startBtnInner: { backgroundColor: Colors.red, padding: 18, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  startBtnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },
  cancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 11, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },

  // Clip row
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  clipIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  clipType: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  clipTime: { fontSize: 9, color: Colors.textMuted, marginTop: 2 },
  clipPlayBtn: { width: 32, height: 32, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  clipPlayText: { fontSize: 11, fontWeight: '900' },
});
