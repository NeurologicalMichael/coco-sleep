import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Animated, AppState, Image, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { ErrorBoundary } from '../components/ErrorBoundary';
import * as Linking from 'expo-linking';
import { useCocoStore } from '../store/cocoStore';
import { useAuthStore } from '../store/authStore';
import { useCoachStore } from '../store/coachStore';
import { useSleepStore } from '../store/sleepStore';
import { usePurchaseStore } from '../store/purchaseStore';
import { useActivityStore } from '../store/activityStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { useUserProfileStore } from '../store/userProfileStore';
import { initRevenueCat, syncPremiumStatus } from '../lib/purchases';
import { syncWidgetState } from '../utils/widgetSync';
import { getTierForLevel } from '../constants/tiers';
import { scoreToCocoLevel, GROWTH_STAGE_IMAGES, streakToGrowthStage } from '../constants/cocoLevels';
import { Colors } from '../constants/colors';
import { ScreenTimeManager } from '../modules/ScreenTimeManager';
import { parseTimeHM } from '../utils/timeHelpers';
import { HealthKitPermissionModal } from '../components/HealthKitPermissionModal';
import * as Notifications from 'expo-notifications';

function isInSleepWindow(bedtime: string, wakeTime: string): boolean {
  const bed = parseTimeHM(bedtime);
  const wake = parseTimeHM(wakeTime);
  if (!bed || !wake) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const bedMin = bed.h * 60 + bed.m;
  const wakeMin = wake.h * 60 + wake.m;
  // Handle midnight crossing (e.g. 22:30 → 07:00)
  if (bedMin > wakeMin) return nowMin >= bedMin || nowMin < wakeMin;
  return nowMin >= bedMin && nowMin < wakeMin;
}

export default function RootLayout() {
  const router = useRouter();
  const hasSeenOnboarding = useCocoStore((s) => s.hasSeenOnboarding);
  const { loadSession } = useAuthStore();

  // HealthKit permission modal
  const { healthKitPermissionAsked } = useUserProfileStore();
  const [showHealthKitModal, setShowHealthKitModal] = useState(false);

  // Wait for zustand to hydrate from AsyncStorage before routing
  const [hydrated, setHydrated] = useState(() => useCocoStore.persist.hasHydrated());
  const [loadingDone, setLoadingDone] = useState(false);
  const loadingOpacity = useRef(new Animated.Value(0)).current;

  // Level-up modal (fires on boot and during active sessions when level changes)
  // Each value uses its own selector so Zustand's Object.is check never creates a new object
  const cocoLevel           = useCocoStore((s) => s.cocoLevel);
  const lastCelebratedLevel = useCocoStore((s) => s.lastCelebratedLevel);
  const markLevelCelebrated = useCocoStore((s) => s.markLevelCelebrated);
  const streak              = useCocoStore((s) => s.streak);
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);
  const [pendingLevel, setPendingLevel] = useState(0);
  const levelUpScale = useRef(new Animated.Value(1)).current;

  const triggerLevelUpCelebration = useCallback((level: number) => {
    setPendingLevel(level);
    setShowLevelUpModal(true);
    levelUpScale.setValue(0.5);
    Animated.sequence([
      Animated.spring(levelUpScale, { toValue: 1.45, useNativeDriver: true, speed: 16, bounciness: 18 }),
      Animated.spring(levelUpScale, { toValue: 1,    useNativeDriver: true, speed: 10, bounciness: 10 }),
    ]).start(() => {
      setTimeout(() => {
        setShowLevelUpModal(false);
        markLevelCelebrated(level);
        levelUpScale.setValue(1);
      }, 1400);
    });
  }, [markLevelCelebrated]);

  useEffect(() => {
    if (hydrated) return;
    return useCocoStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    loadSession().catch(() => {});
  }, []);

  // Check for pending level-up on boot and whenever cocoLevel changes mid-session
  useEffect(() => {
    if (loadingDone && cocoLevel > lastCelebratedLevel) {
      triggerLevelUpCelebration(cocoLevel);
    }
  }, [loadingDone, cocoLevel, lastCelebratedLevel]);

  // Loading screen: fade in → hold → fade out (~0.8s total)
  useEffect(() => {
    Animated.sequence([
      Animated.timing(loadingOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(200),
      Animated.timing(loadingOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setLoadingDone(true));
  }, []);


  // Show HealthKit permission modal after onboarding, once per device
  useEffect(() => {
    if (loadingDone && hasSeenOnboarding && Platform.OS === 'ios' && !healthKitPermissionAsked) {
      // Small delay so the UI is fully rendered first
      const t = setTimeout(() => setShowHealthKitModal(true), 1200);
      return () => clearTimeout(t);
    }
  }, [loadingDone, hasSeenOnboarding, healthKitPermissionAsked]);

  // Re-sync widget whenever any relevant state changes (including level and streak)
  const bedtimeTime = useCoachStore((s) => s.settings.bedtimeReminderTime);
  const wakeTime    = useCoachStore((s) => s.settings.wakeTime);
  const isTracking  = useSleepStore((s) => !!s.activeSession?.isActive);
  useEffect(() => {
    try {
      const { tier, mood } = useCocoStore.getState();
      const { latestSession } = useRecoveryStore.getState();

      // Derive growth image name from streak so widget always shows the correct hero
      const growthStage = streakToGrowthStage(streak);
      const pct = growthStage.nextAt !== null
        ? Math.round(((streak - growthStage.minStreak) / (growthStage.nextAt - growthStage.minStreak)) * 100)
        : 100;
      const variantIdx = pct >= 67 ? 2 : pct >= 34 ? 1 : 0;
      const growthImageName = `growth_${growthStage.stage}_${variantIdx + 1}`;

      syncWidgetState({
        recoveryScore: latestSession?.recovery.recoveryScore ?? null,
        streak,
        tierName: getTierForLevel(tier).name,
        mood,
        isTracking,
        bedtimeTime,
        wakeTime,
        cocoLevel: latestSession ? scoreToCocoLevel(latestSession.recovery.recoveryScore) : 'normal',
        cocoLevelNum: cocoLevel,
        growthImageName,
      }).catch(() => {});
    } catch { /* no-op */ }
  }, [bedtimeTime, wakeTime, isTracking, cocoLevel, streak]);

  // Cleanup: purge sessions under 10 minutes — only if any such sessions exist
  useEffect(() => {
    const { history } = useRecoveryStore.getState();
    const hasShort = history.some((s) => s.durationHours < 10 / 60);
    if (hasShort) useRecoveryStore.getState().purgeShortSessions();
  }, []);

  // Initialise RevenueCat and sync subscription status on startup
  useEffect(() => {
    try {
      const { userId } = useAuthStore.getState();
      initRevenueCat(userId ?? undefined);
      syncPremiumStatus().catch(() => {});
    } catch { /* no-op */ }
  }, []);

  // Daily reset for steps + water — fires on every foreground
  useEffect(() => {
    useActivityStore.getState().checkDailyReset();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useActivityStore.getState().checkDailyReset();
    });
    return () => sub.remove();
  }, []);

  // Re-register DeviceActivity nightly block schedule on every launch AND every foreground.
  // The schedule is lost after reinstall/reset/device-restart; this ensures it's always active.
  // The extension (CocoDeviceActivityMonitor) fires independently at bedtime even when the
  // app is fully closed — but only if startMonitoring has been called at least once recently.
  useEffect(() => {
    if (!hydrated || !ScreenTimeManager.isAvailable) return;

    function refreshSchedule() {
      try {
        const { settings } = useCoachStore.getState();
        if (!settings.screenTimeEnabled) return;
        const bed  = parseTimeHM(settings.bedtimeReminderTime ?? '22:30');
        const wake = parseTimeHM(settings.wakeTime ?? '07:00');
        if (bed && wake) {
          ScreenTimeManager.scheduleNightlyBlock(bed.h, bed.m, wake.h, wake.m).catch(() => {});
        }
      } catch { /* no-op */ }
    }

    // Run immediately on mount
    refreshSchedule();

    // Re-register every time app comes to foreground so the schedule survives
    // device restarts and iOS discarding the monitoring state under memory pressure.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshSchedule();
    });

    return () => sub.remove();
  }, [hydrated]);

  // JS-level bedtime blocking enforcement — fires on every app foreground.
  // This is a reliable fallback when the DeviceActivity extension (CocoDeviceActivityMonitor)
  // fails to wake at the exact scheduled time.
  useEffect(() => {
    if (!ScreenTimeManager.isAvailable) return;

    function checkAndEnforceBlock() {
      try {
        const { settings } = useCoachStore.getState();
        if (!settings.screenTimeEnabled) return;
        const bedtime  = settings.bedtimeReminderTime ?? '22:30';
        const wakeTime = settings.wakeTime ?? '07:00';
        if (isInSleepWindow(bedtime, wakeTime)) {
          // Calculate remaining minutes until wake time
          const wake = parseTimeHM(wakeTime);
          if (wake) {
            const now = new Date();
            const nowMin  = now.getHours() * 60 + now.getMinutes();
            const wakeMin = wake.h * 60 + wake.m;
            const remaining = wakeMin > nowMin
              ? wakeMin - nowMin
              : 1440 - nowMin + wakeMin;  // crosses midnight
            ScreenTimeManager.startSleepBlock([], Math.max(remaining, 30)).catch(() => {});
          }
        } else {
          try { ScreenTimeManager.stopSleepBlock(); } catch { /* no-op */ }
        }
      } catch { /* no-op */ }
    }

    // Check immediately on mount
    checkAndEnforceBlock();

    // Foreground resume check
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndEnforceBlock();
    });

    // Periodic check every 60s so bedtime is enforced even when app stays foregrounded
    const interval = setInterval(checkAndEnforceBlock, 60_000);

    return () => { sub.remove(); clearInterval(interval); };
  }, []);

  // Notification-based screen time enforcement.
  // When the bedtime notification fires (app in foreground) OR the user taps it
  // (app in background/cold start), immediately start the sleep block so we don't
  // depend solely on the DeviceActivity extension.
  useEffect(() => {
    if (!ScreenTimeManager.isAvailable) return;

    function maybeStartBlock() {
      try {
        const { settings } = useCoachStore.getState();
        if (!settings.screenTimeEnabled) return;
        const bedtime  = settings.bedtimeReminderTime ?? '22:30';
        const wakeTime = settings.wakeTime ?? '07:00';
        if (isInSleepWindow(bedtime, wakeTime)) {
          ScreenTimeManager.startSleepBlock([], 480).catch(() => {});
        }
      } catch { /* no-op */ }
    }

    // Fires when app is foregrounded and notification arrives
    const receivedSub = Notifications.addNotificationReceivedListener((notif) => {
      if (notif.request.content.data?.type === 'bedtime') {
        maybeStartBlock();
      }
    });

    // Fires when user taps the bedtime notification from lock screen / notification center
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.type === 'bedtime') {
        maybeStartBlock();
      }
    });

    return () => { receivedSub.remove(); responseSub.remove(); };
  }, []);

  // Handle widget deep links when app is already open (foreground URL events).
  // Cold-start deep links (begin-sleep, toggle-sleep) are handled by app/begin-sleep.tsx
  // via Expo Router's file-based routing — no need to handle them here on cold start.
  useEffect(() => {
    function handleUrl({ url }: { url: string }) {
      if (url.includes('toggle-sleep') || url.includes('begin-sleep')) {
        useSleepStore.getState().setPendingWidgetToggle(true);
        router.push('/(tabs)/sleep');
      } else if (url.includes('sleep')) {
        router.push('/(tabs)/sleep');
      }
    }
    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!hasSeenOnboarding && !__DEV__) {
      router.replace('/onboarding');
    }
  }, [hydrated, hasSeenOnboarding]);

  // Show loading screen until both hydrated AND animation finished
  if (!hydrated || !loadingDone) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ opacity: loadingOpacity }}>
          <Image
            source={require('../assets/splash-icon.png')}
            style={{ width: 400, height: 400 }}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
    );
  }

  const cocoGrowth  = streakToGrowthStage(streak);
  const cocoGrowthPct = cocoGrowth.nextAt !== null
    ? Math.round(((streak - cocoGrowth.minStreak) / (cocoGrowth.nextAt - cocoGrowth.minStreak)) * 100)
    : 100;
  const cocoSubImg = GROWTH_STAGE_IMAGES[cocoGrowth.stage][cocoGrowthPct >= 67 ? 2 : cocoGrowthPct >= 34 ? 1 : 0];

  return (
    <ErrorBoundary fallbackLabel="Something went wrong on startup. Tap to retry.">
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bgDeep } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', gestureEnabled: true }} />
        <Stack.Screen name="discount-offer" options={{ presentation: 'modal', gestureEnabled: false }} />
        <Stack.Screen name="create-post" options={{ presentation: 'modal', gestureEnabled: true, headerShown: false }} />
      </Stack>

      {/* Level-up modal — always shown on boot if level went up, blocks all interaction */}
      <Modal visible={showLevelUpModal} transparent animationType="fade" statusBarTranslucent>
        <View style={lvlStyles.overlay}>
          <Animated.View style={{ transform: [{ scale: levelUpScale }], alignItems: 'center' }}>
            <Image source={cocoSubImg} style={lvlStyles.img} resizeMode="contain" />
          </Animated.View>
          <Animated.Text style={[lvlStyles.level, { transform: [{ scale: levelUpScale }] }]}>
            LVL {pendingLevel}
          </Animated.Text>
          <Text style={lvlStyles.flash}>LEVEL UP</Text>
          <Text style={lvlStyles.sub}>Keep tracking to keep growing.</Text>
        </View>
      </Modal>

      {/* HealthKit permission — shown once after onboarding */}
      <HealthKitPermissionModal
        visible={showHealthKitModal}
        onDismiss={() => setShowHealthKitModal(false)}
      />
    </ErrorBoundary>
  );
}

const lvlStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.97)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  img: { width: 260, height: 260 },
  level: {
    fontSize: 72, fontWeight: '900', fontStyle: 'italic', letterSpacing: 6,
    color: '#F5C842',
    textShadowColor: '#FFE066', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  flash: {
    fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: 5,
    color: '#FFE066', marginTop: 4,
    textShadowColor: '#F5C842', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  sub: {
    fontSize: 11, fontWeight: '700', letterSpacing: 2,
    color: Colors.textMuted, marginTop: 8,
  },
});
