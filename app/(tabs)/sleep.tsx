import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Animated, View, Text, Image, StyleSheet, TouchableOpacity, ScrollView,
  Modal, Alert, Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { syncWidgetState } from '../../utils/widgetSync';
import { useCocoStore } from '../../store/cocoStore';
import { useRecoveryStore, ProcessedSession } from '../../store/recoveryStore';
import { getTierForLevel } from '../../constants/tiers';
import { scoreToCocoLevel, COCO_LEVELS, streakToGrowthStage, GROWTH_STAGE_IMAGES } from '../../constants/cocoLevels';
import { useSleepStore, DataSource } from '../../store/sleepStore';
import { useWatchTracking } from '../../hooks/useWatchTracking';
import { useRecoveryInsights } from '../../hooks/useRecoveryInsights';
import { useCocoEvolution } from '../../hooks/useCocoEvolution';
import { ScreenTimeManager } from '../../modules/ScreenTimeManager';
import { useCoachStore } from '../../store/coachStore';
import { estimateStageDurations, AudioEvent } from '../../utils/hrvProxy';
import { SleepStage, generateEstimatedEvents } from '../../utils/sleepScore';
import { startAudioSampling, stopAudioSampling, audioTypeLabel, audioTypeIcon } from '../../utils/audioSampler';
import { startBackgroundKeepAlive, stopBackgroundKeepAlive } from '../../utils/backgroundKeepAlive';
import { StageTimeline, MovementGraph, StageBreakdown } from '../../components/SleepCharts';
import { usePurchaseStore } from '../../store/purchaseStore';
import { SleepSoundsPlayer } from '../../components/SleepSoundsPlayer';

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGE_CFG: Record<SleepStage, { label: string; sub: string; color: string }> = {
  slumbering: { label: 'SLUMBERING', sub: 'Deep sleep — peak recovery',      color: Colors.info  },
  snoozing:   { label: 'SNOOZING',   sub: 'Light sleep — recharging',        color: '#A855F7'    },
  dozing:     { label: 'DOZING',     sub: 'N1 — settling in',                color: Colors.gold  },
  rem:        { label: 'REM',        sub: 'Dreaming — memory consolidation', color: '#EC4899'    },
  awake:      { label: 'AWAKE',      sub: 'Movement detected',               color: Colors.red   },
};

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function nightTabLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function nightFullLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAY_NAMES[d.getDay()]}  ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function scoreColor(score: number): string {
  if (score >= 75) return Colors.green;
  if (score >= 50) return Colors.gold;
  return Colors.red;
}

function formatDur(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h}H` : `${h}H ${m}M`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SleepScreen() {
  const { activeSession, currentStage, startSession, endSession, dataSource, setDataSource, patchWatchData, addAudioEvent, pendingWidgetToggle, setPendingWidgetToggle } = useSleepStore();
  const { processSession } = useRecoveryInsights();
  const { processSession: evolve } = useCocoEvolution();
  const { status: watchStatus, checkAndAuthorize, fetchNightData } = useWatchTracking();
  const { streak, tier, mood, cocoLevel, cocoXP } = useCocoStore();
  const { settings: coachSettings } = useCoachStore();
  const { history } = useRecoveryStore();
  const { isPremium } = usePurchaseStore();

  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<string>('overview');
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [, forceRender] = useState(0);
  const [liveAudioType, setLiveAudioType] = useState<AudioEvent['type']>('quiet');
  const isTracking = !!activeSession;
  const prevHistoryLen = useRef(history.length);

  useFocusEffect(useCallback(() => { forceRender((n) => n + 1); }, []));

  // Widget button toggle — fires when user taps 🌙 SLEEP / WAKE UP on the home screen widget
  useEffect(() => {
    if (!pendingWidgetToggle) return;
    setPendingWidgetToggle(false);
    if (isTracking) {
      void handleStop();
    } else {
      // Start with last used training day, default 'rest' — no setup modal needed
      void handleWidgetStart();
    }
  }, [pendingWidgetToggle]);

  // Auto-switch to the newest night tab after a session ends
  useEffect(() => {
    if (history.length > prevHistoryLen.current && history.length > 0) {
      setSelectedTab(history[0].id);
    }
    prevHistoryLen.current = history.length;
  }, [history.length]);

  // Pulse animation for active tracking
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (isTracking) {
      pulseAnim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1000, useNativeDriver: true }),
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
      try {
        const micOn = await startAudioSampling((event) => {
          setLiveAudioType(event.type);
          addAudioEvent(event);
        });
        if (!micOn) Alert.alert('Microphone Off', 'Coco needs mic access to detect sounds. Enable it in Settings → Privacy → Microphone → Coco.');
      } catch { /* audio sampling failed — tracking continues via motion */ }
    }
    if (coachSettings.screenTimeEnabled && ScreenTimeManager.isAvailable) {
      void ScreenTimeManager.startSleepBlock([], 480);
    }
    void syncWidgetState({
      recoveryScore: null, streak,
      tierName: getTierForLevel(tier).name, mood, isTracking: true,
      bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime,
      cocoLevel: 'normal',
    });
  }

  async function handleStartTracking() {
    setShowSetupModal(false);
    startSession();
    void startBackgroundKeepAlive();

    // Start audio sampling (phone mode only — Watch has own sleep stages)
    if (dataSource === 'phone') {
      try {
        const micOn = await startAudioSampling((event) => {
          setLiveAudioType(event.type);
          addAudioEvent(event);
        });
        if (!micOn) Alert.alert('Microphone Off', 'Coco needs mic access to detect sounds. Enable it in Settings → Privacy → Microphone → Coco.');
      } catch { /* audio sampling failed — tracking continues via motion */ }
    }

    // Immediately enforce app blocking if Screen Time is enabled
    if (coachSettings.screenTimeEnabled && ScreenTimeManager.isAvailable) {
      void ScreenTimeManager.startSleepBlock([], 480);
    }

    void syncWidgetState({
      recoveryScore: null, streak,
      tierName: getTierForLevel(tier).name, mood, isTracking: true,
      bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime,
      cocoLevel: 'normal',
    });
  }

  function discardSession() {
    void syncWidgetState({
      recoveryScore: 0, streak, tierName: getTierForLevel(tier).name, mood, isTracking: false,
      bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime,
      cocoLevel: 'normal',
    });
    stopBackgroundKeepAlive();
    void stopAudioSampling();
    setLiveAudioType('quiet');
    endSession(); // clear without saving
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

    // Flip widget button to SLEEP immediately — don't wait for session processing
    void syncWidgetState({
      recoveryScore: 0, streak, tierName: getTierForLevel(tier).name, mood, isTracking: false,
      bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime,
      cocoLevel: 'normal',
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
          movementEvents: watchData.movementEvents,
          disruptionCount: watchData.disruptionCount,
          watchHRV: watchData.hrvRMSSD,
          watchHeartRate: watchData.avgHeartRate,
        });
        raw.movementEvents = watchData.movementEvents;
        raw.disruptionCount = watchData.disruptionCount;
        raw.watchHRV = watchData.hrvRMSSD;
        raw.watchHeartRate = watchData.avgHeartRate;
      }
    }

    const processed = processSession(raw);
    const evolution = evolve(processed.recovery.recoveryScore);
    if (evolution.tieredUp) Alert.alert('COCO EVOLVED!', `Coco is now a ${evolution.tierName}!`);

    void syncWidgetState({
      recoveryScore: processed.recovery.recoveryScore,
      streak,
      tierName: getTierForLevel(evolution.newTier ?? tier).name,
      mood,
      isTracking: false,
      bedtimeTime: coachSettings.bedtimeReminderTime,
      wakeTime: coachSettings.wakeTime,
      cocoLevel: scoreToCocoLevel(processed.recovery.recoveryScore),
    });

    if (autoEnded) {
      Alert.alert(
        'Session Auto-Ended',
        'Coco detected you got up. Your session has been saved.',
        [{ text: 'OK' }]
      );
    }
    // Stay on Sleep tab — new night auto-selected via useEffect above
  }

  // ── Summary stats ──────────────────────────────────────────────────────────

  const totalNights = history.length;
  const avgRecovery = totalNights > 0
    ? Math.round(history.reduce((s, n) => s + n.recovery.recoveryScore, 0) / totalNights)
    : 0;
  const avgDuration = totalNights > 0
    ? history.reduce((s, n) => s + n.durationHours, 0) / totalNights
    : 0;
  const tierInfo = getTierForLevel(tier);
  const watchConnected = watchStatus === 'authorized';
  const selectedSession = history.find((s) => s.id === selectedTab) ?? null;

  // ── Active tracking fullscreen ─────────────────────────────────────────────

  if (isTracking) {
    const stageCfg = STAGE_CFG[currentStage];
    const stageColor = stageCfg.color;
    const now = Date.now();
    const startedAt = activeSession?.startedAt ?? now;
    const onsetAt = activeSession?.sleepOnsetAt ?? null;
    const elapsedMs = now - startedAt;
    const durations = activeSession?.movementEvents.length
      ? estimateStageDurations(activeSession.movementEvents)
      : { dozing: 0, snoozing: 0, slumbering: 0, rem: 0, awake: 0 };
    const totalTrackedMin = Object.values(durations).reduce((a, b) => a + b, 0) || 1;

    return (
      <View style={styles.container}>
        <View style={styles.trackingScreen}>

          {/* Top bar */}
          <View style={styles.trackingTopBar}>
            <View style={[styles.trackingSourcePill, { borderColor: dataSource === 'watch' ? Colors.info : stageColor }]}>
              <Text style={[styles.trackingSourceText, { color: dataSource === 'watch' ? Colors.info : stageColor }]}>
                {dataSource === 'watch' ? 'APPLE WATCH' : 'PHONE'}
              </Text>
            </View>
          </View>

          {/* Stage name */}
          <Text style={[styles.stageName, { color: stageColor }]}>{stageCfg.label}</Text>
          <Text style={styles.stageSub}>{stageCfg.sub}</Text>

          {/* Pulsing ring — colored by stage */}
          <View style={styles.pulseContainer}>
            <Animated.View style={[styles.pulseRing, { borderColor: stageColor }, pulseStyle]} />
            <View style={[styles.pulseDot, { backgroundColor: stageColor }]} />
          </View>

          {/* Sleep onset */}
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

          {/* Elapsed */}
          <Text style={styles.elapsedTime}>{formatElapsed(elapsedMs)}</Text>
          <Text style={styles.elapsedLabel}>TOTAL TRACKED</Text>

          {/* Stage breakdown bar */}
          {activeSession && activeSession.movementEvents.length > 0 && (
            <View style={styles.stageBarWrap}>
              <View style={styles.stageBarTrack}>
                {(['slumbering', 'rem', 'snoozing', 'dozing', 'awake'] as SleepStage[]).map((s) => {
                  const pct = (durations[s] / totalTrackedMin) * 100;
                  if (pct < 1) return null;
                  return (
                    <View
                      key={s}
                      style={[styles.stageBarSegment, { width: `${pct}%`, backgroundColor: STAGE_CFG[s].color }]}
                    />
                  );
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

          {/* Live audio indicator (phone mode only) */}
          {dataSource === 'phone' && (
            <View style={styles.audioIndicator}>
              <Text style={styles.audioIndicatorIcon}>{audioTypeIcon(liveAudioType)}</Text>
              <View>
                <Text style={[styles.audioIndicatorLabel,
                  liveAudioType === 'quiet' ? { color: Colors.textMuted } :
                  liveAudioType === 'snoring' ? { color: Colors.gold } :
                  liveAudioType === 'talking' ? { color: Colors.info } : { color: Colors.red }
                ]}>
                  {audioTypeLabel(liveAudioType)}
                </Text>
                <Text style={styles.audioIndicatorSub}>MOTION MONITORING</Text>
              </View>
            </View>
          )}

          {/* Stop button — pinned to bottom, always visible */}
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

  // ── Sleep Log (idle) ───────────────────────────────────────────────────────

  // Growth stage image — same sub-image logic as _layout.tsx
  const cocoGrowth = streakToGrowthStage(streak);
  const cocoGrowthPct = cocoGrowth.nextAt !== null
    ? Math.round(((streak - cocoGrowth.minStreak) / (cocoGrowth.nextAt - cocoGrowth.minStreak)) * 100)
    : 100;
  const cocoSubImg = GROWTH_STAGE_IMAGES[cocoGrowth.stage][cocoGrowthPct >= 67 ? 2 : cocoGrowthPct >= 34 ? 1 : 0];

  return (
    <View style={styles.container}>
      {/* Hero: Level, coconut image, streak */}
      <View style={styles.heroSection}>
        <Text style={styles.heroLevel}>LEVEL {cocoLevel}</Text>
        <Image source={cocoSubImg} style={styles.heroImage} resizeMode="contain" />
        <Text style={styles.heroStageName}>{cocoGrowth.name}</Text>
        <Text style={styles.heroStreakNum}>{streak}</Text>
        <Text style={styles.heroStreakLabel}>DAY STREAK</Text>
      </View>

      {/* Horizontal tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'overview' && styles.tabActive]}
          onPress={() => setSelectedTab('overview')}
        >
          <Text style={[styles.tabLabel, selectedTab === 'overview' && styles.tabLabelActive]}>OVERVIEW</Text>
          {totalNights > 0 && (
            <Text style={[styles.tabScore, { color: selectedTab === 'overview' ? scoreColor(avgRecovery) : Colors.textMuted }]}>
              {avgRecovery} AVG
            </Text>
          )}
        </TouchableOpacity>

        {(isPremium ? history : history.slice(0, 7)).map((session) => {
          const active = selectedTab === session.id;
          const sc = session.recovery.recoveryScore;
          const lvl = scoreToCocoLevel(sc);
          const cocoInfo = COCO_LEVELS[lvl];
          return (
            <TouchableOpacity
              key={session.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setSelectedTab(session.id)}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {nightTabLabel(session.date)}
              </Text>
              {cocoInfo.image && (
                <Image source={cocoInfo.image} style={styles.tabCocoImg} resizeMode="contain" />
              )}
              <Text style={[styles.tabScore, { color: active ? scoreColor(sc) : Colors.textMuted }]}>
                {sc}
              </Text>
            </TouchableOpacity>
          );
        })}
        {!isPremium && history.length > 7 && (
          <TouchableOpacity
            style={[styles.tab, styles.tabLocked]}
            onPress={() => router.push('/paywall')}
          >
            <Text style={styles.tabLockedLabel}>+{history.length - 7} MORE</Text>
            <Text style={styles.tabLockedSub}>PRO →</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Tab content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tabContent}>
        {selectedTab === 'overview' ? (
          <>
            <OverviewPanel
              avgRecovery={avgRecovery}
              avgDuration={avgDuration}
              totalNights={totalNights}
              streak={streak}
              tierInfo={tierInfo}
            />
            <SleepSoundsPlayer />
          </>
        ) : selectedSession ? (
          <NightPanel session={selectedSession} />
        ) : null}
      </ScrollView>

      {/* Track Tonight sticky CTA */}
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
      <Modal
        visible={showSetupModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSetupModal(false)}
      >
        <SetupModal
          dataSource={dataSource}
          watchConnected={watchConnected}
          onSelectSource={handleSelectSource}
          onStart={handleStartTracking}
          onClose={() => setShowSetupModal(false)}
        />
      </Modal>
    </View>
  );
}

// ─── Overview Panel ───────────────────────────────────────────────────────────

function OverviewPanel({
  avgRecovery, avgDuration, totalNights, streak, tierInfo,
}: {
  avgRecovery: number;
  avgDuration: number;
  totalNights: number;
  streak: number;
  tierInfo: any;
}) {
  if (totalNights === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyGlyph}>ZZZ</Text>
        <Text style={styles.emptyTitle}>NO NIGHTS LOGGED</Text>
        <Text style={styles.emptySub}>
          Track your first night tonight.{'\n'}Coco will be watching.
        </Text>
      </View>
    );
  }

  const color = scoreColor(avgRecovery);
  const cocoLvl = scoreToCocoLevel(avgRecovery);
  const cocoInfo = COCO_LEVELS[cocoLvl];

  return (
    <View>
      {/* Tier card */}
      <View style={styles.tierCard}>
        <DiagonalStripes opacity={0.04} />
        <View style={styles.tierCardInner}>
          <View style={[styles.tierDot, { backgroundColor: tierInfo.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tierName}>{tierInfo.name.toUpperCase()}</Text>
            <Text style={styles.tierSub}>COCO TIER</Text>
          </View>
          <View style={[styles.cocoLvlBadge, { borderColor: cocoInfo.color }]}>
            <Text style={[styles.cocoLvlText, { color: cocoInfo.color }]}>{cocoInfo.label} COCO</Text>
          </View>
        </View>
      </View>

      {/* Avg recovery big number */}
      <View style={[styles.avgCard, { borderLeftColor: color }]}>
        <DiagonalStripes color={color} opacity={0.05} />
        <View style={styles.avgCardInner}>
          <Text style={styles.avgLabel}>AVG SLEEP SCORE</Text>
          <View style={styles.avgScoreRow}>
            <Text style={[styles.avgNum, { color }]}>{avgRecovery}</Text>
            <Text style={styles.avgDenom}>/100</Text>
          </View>
          {/* Score bar */}
          <View style={styles.scoreBarTrack}>
            <View style={[styles.scoreBarFill, { width: `${avgRecovery}%`, backgroundColor: color }]} />
          </View>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <StatCell label="AVG DURATION" value={formatDur(avgDuration)} />
        <StatCell label="NIGHTS LOGGED" value={`${totalNights}`} />
        <StatCell label="CURRENT STREAK" value={`${streak}D`} />
      </View>
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Night Panel ──────────────────────────────────────────────────────────────

function NightPanel({ session }: { session: ProcessedSession }) {
  const score = session.recovery.recoveryScore;
  const sleepScore = session.scores.sleepScore;
  const color = scoreColor(score);
  const cocoLvl = scoreToCocoLevel(score);
  const cocoInfo = COCO_LEVELS[cocoLvl];
  const { isPremium } = usePurchaseStore();
  const visibleInsights = session.recovery.insights.filter((i) => !i.isPremium || isPremium);

  return (
    <View>
      {/* Night header */}
      <View style={styles.nightHeader}>
        <Text style={styles.nightDate}>{nightFullLabel(session.date)}</Text>
        <View style={[styles.srcBadge, { borderColor: session.dataSource === 'watch' ? Colors.info : Colors.textMuted }]}>
          <Text style={[styles.srcBadgeText, { color: session.dataSource === 'watch' ? Colors.info : Colors.textMuted }]}>
            {session.dataSource === 'watch' ? 'WATCH' : 'PHONE'}
          </Text>
        </View>
      </View>

      {/* Coco grade hero */}
      <View style={[styles.cocoGradeHero, { borderColor: cocoInfo.color }]}>
        <DiagonalStripes color={cocoInfo.color} opacity={0.05} />
        <View style={styles.cocoGradeHeroInner}>
          {cocoInfo.image && (
            <Image source={cocoInfo.image} style={styles.cocoGradeHeroImg} resizeMode="contain" />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.cocoGradeLabel, { color: cocoInfo.color }]}>{cocoInfo.label} COCO</Text>
            <Text style={styles.cocoGradeSub}>LAST NIGHT'S GRADE</Text>
          </View>
        </View>
      </View>

      {/* Score progress bar */}
      <View style={styles.scoreBarTrack}>
        <View style={[styles.scoreBarFill, { width: `${score}%`, backgroundColor: color }]} />
      </View>

      {/* Stats grid — all key metrics */}
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

      {/* ── Charts ── always shown */}
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
            <StageBreakdown events={chartEvents} />
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
            <DiagonalStripes opacity={0.03} />
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

      {/* Insights */}
      {visibleInsights.map((insight) => {
        const ic =
          insight.severity === 'good' ? Colors.green :
          insight.severity === 'warning' ? Colors.gold :
          insight.severity === 'critical' ? Colors.red : Colors.textMuted;
        return (
          <View key={insight.id} style={[styles.insightCard, { borderLeftColor: ic }]}>
            <DiagonalStripes opacity={0.03} />
            <View style={styles.insightInner}>
              <Text style={[styles.insightTitle, { color: ic }]}>{insight.title.toUpperCase()}</Text>
              <Text style={styles.insightBody}>{insight.body}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Setup Modal ──────────────────────────────────────────────────────────────

function SetupModal({
  dataSource, watchConnected,
  onSelectSource, onStart, onClose,
}: {
  dataSource: DataSource;
  watchConnected: boolean;
  onSelectSource: (src: DataSource) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  return (
    <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
      <View style={styles.modalHeader}>
        <Text style={styles.eyebrow}>// SLEEP SETUP</Text>
        <Text style={styles.logTitle}>TONIGHT</Text>
        <View style={styles.titleBar} />
      </View>

      <Text style={styles.sectionLabel}>TRACKING SOURCE</Text>
      <View style={styles.sourceRow}>
        {(['phone', 'watch'] as DataSource[]).map((src) => {
          const active = dataSource === src;
          return (
            <TouchableOpacity
              key={src}
              style={[styles.sourceBtn, active && styles.sourceBtnActive]}
              onPress={() => onSelectSource(src)}
            >
              <Text style={styles.sourceIcon}>{src === 'phone' ? 'PHN' : 'WCH'}</Text>
              <Text style={[styles.sourceName, active && styles.sourceNameActive]}>
                {src === 'phone' ? 'PHONE' : 'APPLE WATCH'}
              </Text>
              <Text style={styles.sourceDesc}>
                {src === 'phone' ? 'Accelerometer\non mattress' : 'Real HRV +\nsleep stages'}
              </Text>
              {src === 'watch' && active && watchConnected && (
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedText}>CONNECTED</Text>
                </View>
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
            <Text style={styles.watchInfoBody}>
              Your Watch tracks sleep natively. When you stop, Coco reads real HRV, heart rate, and sleep stages from HealthKit.
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity onPress={onStart} style={{ marginTop: 8 }}>
        <View style={styles.startBtnOuter}>
          <View style={styles.startBtnInner}>
            <Text style={styles.startBtnText}>
              {dataSource === 'watch' ? 'START WITH WATCH' : 'START TRACKING'}
            </Text>
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
  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 4 },

  // ── Hero section ─────────────────────────────────────────────────────────────
  heroSection: {
    alignItems: 'center', paddingTop: 52, paddingBottom: 16,
    backgroundColor: Colors.bgDeep,
  },
  heroLevel: {
    fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3,
    color: Colors.gold, marginBottom: 8,
  },
  heroImage: { width: 160, height: 160 },
  heroStageName: {
    fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 4,
    color: Colors.gold, opacity: 0.7, marginTop: 6, marginBottom: 2,
  },
  heroStreakNum: {
    fontSize: 64, fontWeight: '900', fontStyle: 'italic',
    color: Colors.gold, lineHeight: 68,
    textShadowColor: '#FFE066', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  heroStreakLabel: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 4,
    color: Colors.textMuted, marginTop: 2,
  },

  // ── Log header (kept for modal reuse) ───────────────────────────────────────
  logTitle: { fontSize: 46, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 48 },
  titleBar: { height: 3, width: 52, backgroundColor: Colors.red, marginTop: 6 },

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  tabBar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBarContent: { paddingHorizontal: 20, paddingVertical: 2, gap: 4 },
  tab: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 3, borderBottomColor: 'transparent',
    alignItems: 'center', minWidth: 72,
  },
  tabActive: { borderBottomColor: Colors.red },
  tabLabel: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.textMuted },
  tabLabelActive: { color: Colors.textPrimary },
  tabScore: { fontSize: 12, fontWeight: '900', marginTop: 2 },
  tabCocoImg: { width: 28, height: 28, marginTop: 4 },
  tabLocked: { borderColor: Colors.gold, borderLeftColor: Colors.gold },
  tabLockedLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: Colors.gold },
  tabLockedSub: { fontSize: 8, fontWeight: '900', color: Colors.gold, marginTop: 2 },

  // ── Tab content ─────────────────────────────────────────────────────────────
  tabContent: { padding: 20, paddingBottom: 120 },

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptyState: { alignItems: 'center', paddingTop: 48, paddingBottom: 24 },
  emptyGlyph: { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textSecondary, marginBottom: 8 },
  emptySub: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },

  // ── Overview ────────────────────────────────────────────────────────────────
  tierCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.red, marginBottom: 16, overflow: 'hidden',
  },
  tierCardInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  tierDot: { width: 10, height: 10 },
  tierName: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 1 },
  tierSub: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 2 },
  cocoLvlBadge: { borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  cocoLvlText: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },

  avgCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, marginBottom: 16, overflow: 'hidden',
  },
  avgCardInner: { padding: 20 },
  avgLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textMuted, marginBottom: 8 },
  avgScoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 14 },
  avgNum: { fontSize: 72, fontWeight: '900', fontStyle: 'italic', lineHeight: 76 },
  avgDenom: { fontSize: 18, fontWeight: '700', color: Colors.textMuted, marginBottom: 10 },

  scoreBarTrack: {
    height: 4, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 16,
    overflow: 'hidden',
  },
  scoreBarFill: { height: '100%' },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  statCell: {
    flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderTopWidth: 3, borderTopColor: Colors.red, padding: 14, alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  statLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted, marginTop: 4, textAlign: 'center' },

  // ── Night panel ──────────────────────────────────────────────────────────────
  nightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  nightDate: { fontSize: 18, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 1 },
  trainingBadge: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: Colors.bgCard, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  trainingBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  srcBadge: { borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 5 },
  srcBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },

  cocoGradeHero: {
    borderWidth: 2, borderLeftWidth: 5, marginBottom: 10,
    backgroundColor: Colors.bgCard, overflow: 'hidden',
  },
  cocoGradeHeroInner: {
    flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14,
  },
  cocoGradeHeroImg: { width: 80, height: 80 },
  cocoGradeLabel: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  cocoGradeSub: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 3 },
  recPill: { borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 6 },
  recPillText: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },

  nightScoreCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 5, marginBottom: 4, overflow: 'hidden',
  },
  nightScoreInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20 },
  nightScoreLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 3, color: Colors.textMuted, marginBottom: 6 },
  nightScoreNum: { fontSize: 68, fontWeight: '900', fontStyle: 'italic', lineHeight: 72 },
  nightRecBlock: { alignItems: 'flex-end', paddingTop: 4 },
  cocoGradeImg: { width: 52, height: 52, marginBottom: 10 },
  nightRecEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginBottom: 6 },
  nightRecLabel: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, textAlign: 'right' },

  nightStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, marginTop: 4, gap: 1, backgroundColor: Colors.border },
  nightStat: { width: '33.33%', backgroundColor: Colors.bgCard, padding: 14, alignItems: 'center' },
  nightStatNum: { fontSize: 16, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  nightStatLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted, marginTop: 3 },

  insightCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, marginBottom: 10, overflow: 'hidden',
  },
  insightInner: { padding: 16 },
  insightTitle: { fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 6 },
  insightBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },

  // ── CTA bar ──────────────────────────────────────────────────────────────────
  ctaBar: {
    paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12,
    backgroundColor: Colors.bgDeep,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  ctaBtnOuter: { overflow: 'hidden' },
  ctaBtnInner: {
    backgroundColor: Colors.red, paddingVertical: 18,
    alignItems: 'center', transform: [{ skewX: '-1.5deg' }],
  },
  ctaBtnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff', transform: [{ skewX: '1.5deg' }] },

  // ── Tracking fullscreen ───────────────────────────────────────────────────────
  trackingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 120 },
  trackingTopBar: { position: 'absolute', top: 56, alignItems: 'center' },
  trackingSourcePill: { borderWidth: 2, paddingHorizontal: 20, paddingVertical: 6 },
  trackingSourceText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },

  stageName: { fontSize: 36, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, textAlign: 'center', marginBottom: 6 },
  stageSub: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginBottom: 28, letterSpacing: 1 },

  pulseContainer: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  pulseRing: { position: 'absolute', width: 80, height: 80, borderRadius: 0, borderWidth: 2 },
  pulseDot: { width: 14, height: 14 },

  onsetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  onsetLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  onsetTime: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },

  elapsedTime: { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 52, marginTop: 8 },
  elapsedLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 3, color: Colors.textMuted, marginBottom: 28 },

  stageBarWrap: { width: '100%', marginBottom: 32 },
  stageBarTrack: { height: 6, flexDirection: 'row', backgroundColor: Colors.border, marginBottom: 10, overflow: 'hidden' },
  stageBarSegment: { height: '100%' },
  stageLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  stageLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stageLegendDot: { width: 6, height: 6 },
  stageLegendText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: Colors.textMuted },

  stopBtnFixed: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingBottom: 36, paddingTop: 12,
    backgroundColor: Colors.bgDeep,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  stopBtnOuter: { transform: [{ skewX: '-1.5deg' }] },
  stopBtnInner: { paddingVertical: 20, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  stopBtnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },

  // ── Setup modal ───────────────────────────────────────────────────────────────
  modal: { flex: 1, backgroundColor: Colors.bgDeep },
  modalContent: { padding: 24, paddingBottom: 48 },
  modalHeader: { marginBottom: 28 },
  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary, marginBottom: 12, textTransform: 'uppercase' },

  sourceRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sourceBtn: {
    flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.textMuted, padding: 16, alignItems: 'center', gap: 4,
  },
  sourceBtnActive: { borderColor: Colors.red, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  sourceIcon: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted, marginBottom: 4 },
  sourceName: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textSecondary },
  sourceNameActive: { color: Colors.red },
  sourceDesc: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', lineHeight: 15 },
  connectedBadge: { marginTop: 6, backgroundColor: Colors.info, paddingHorizontal: 8, paddingVertical: 3 },
  connectedText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 1 },

  watchInfo: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.info, marginBottom: 4, overflow: 'hidden',
  },
  watchInfoTitle: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.info, marginBottom: 6 },
  watchInfoBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },

  trainingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  chip: {
    width: '22%', aspectRatio: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  chipActive: { borderColor: Colors.red, borderLeftWidth: 3, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  chipEmoji: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted },
  chipLabel: { fontSize: 8, fontWeight: '900', color: Colors.textSecondary },
  chipLabelActive: { color: Colors.red },

  startBtnOuter: { transform: [{ skewX: '-1.5deg' }] },
  startBtnInner: { backgroundColor: Colors.red, padding: 18, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  startBtnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },

  cancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 11, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },

  // ── Audio indicator (live tracking) ──────────────────────────────────────────
  audioIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 10, marginBottom: 20, width: '100%',
    borderLeftWidth: 3,
  },
  audioIndicatorIcon: { fontSize: 20 },
  audioIndicatorLabel: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  audioIndicatorSub: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 2 },

  // ── Sleep sounds card (NightPanel) ────────────────────────────────────────────
  noDataCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.textMuted, marginBottom: 14, overflow: 'hidden',
  },
  noDataInner: { padding: 18, alignItems: 'center' },
  noDataText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 4 },
  noDataSub: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' },

  soundsCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.info, marginBottom: 14, overflow: 'hidden',
  },
  soundsInner: { padding: 14 },
  soundsTitle: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.info, marginBottom: 10 },
  soundsEmpty: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  soundsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  soundChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  soundChipIcon: { fontSize: 14 },
  soundChipLabel: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', color: Colors.textSecondary, letterSpacing: 0.5 },
  soundChipCount: { fontSize: 10, fontWeight: '900', color: Colors.textMuted },
});
