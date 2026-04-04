import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Animated, AppState, Image, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useCocoStore } from '../store/cocoStore';
import { useAuthStore } from '../store/authStore';
import { useCoachStore } from '../store/coachStore';
import { useSleepStore } from '../store/sleepStore';
import { usePurchaseStore } from '../store/purchaseStore';
import { useActivityStore } from '../store/activityStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { useUserProfileStore } from '../store/userProfileStore';
import { initRevenueCat, syncPremiumStatus, REVENUECAT_CONFIGURED } from '../lib/purchases';
import { syncWidgetState } from '../utils/widgetSync';
import { getTierForLevel } from '../constants/tiers';
import { scoreToCocoLevel, GROWTH_STAGE_IMAGES, streakToGrowthStage } from '../constants/cocoLevels';
import { Colors } from '../constants/colors';
import { ScreenTimeManager } from '../modules/ScreenTimeManager';
import { parseTimeHM } from '../utils/timeHelpers';
import { HealthKitPermissionModal } from '../components/HealthKitPermissionModal';

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

  // Level-up modal (fires on boot, regardless of which tab is active)
  const { cocoLevel, lastCelebratedLevel, markLevelCelebrated, streak } = useCocoStore();
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
    void loadSession();
  }, []);

  // Check for pending level-up once loading screen is done
  useEffect(() => {
    if (loadingDone && cocoLevel > lastCelebratedLevel) {
      triggerLevelUpCelebration(cocoLevel);
    }
  }, [loadingDone]);

  // Loading screen: fade in → hold → fade out (~0.8s total)
  useEffect(() => {
    Animated.sequence([
      Animated.timing(loadingOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(200),
      Animated.timing(loadingOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setLoadingDone(true));
  }, []);

  // Force premium on until RevenueCat is wired up for real purchases
  useEffect(() => {
    usePurchaseStore.getState().setPremium(true);
  }, []);

  // Show HealthKit permission modal after onboarding, once per device
  useEffect(() => {
    if (loadingDone && hasSeenOnboarding && Platform.OS === 'ios' && !healthKitPermissionAsked) {
      // Small delay so the UI is fully rendered first
      const t = setTimeout(() => setShowHealthKitModal(true), 1200);
      return () => clearTimeout(t);
    }
  }, [loadingDone, hasSeenOnboarding, healthKitPermissionAsked]);

  // Re-sync widget whenever bedtime, wake time, or tracking state changes
  const bedtimeTime = useCoachStore((s) => s.settings.bedtimeReminderTime);
  const wakeTime    = useCoachStore((s) => s.settings.wakeTime);
  const isTracking  = useSleepStore((s) => !!s.activeSession?.isActive);
  useEffect(() => {
    const { streak, tier, mood } = useCocoStore.getState();
    const { latestSession } = useRecoveryStore.getState();
    void syncWidgetState({
      recoveryScore: latestSession?.recovery.recoveryScore ?? null,
      streak,
      tierName: getTierForLevel(tier).name,
      mood,
      isTracking,
      bedtimeTime,
      wakeTime,
      cocoLevel: latestSession ? scoreToCocoLevel(latestSession.recovery.recoveryScore) : 'normal',
      cocoLevelNum: useCocoStore.getState().cocoLevel,
    });
  }, [bedtimeTime, wakeTime, isTracking]);

  // Cleanup: purge sessions under 10 minutes — only if any such sessions exist
  useEffect(() => {
    const { history } = useRecoveryStore.getState();
    const hasShort = history.some((s) => s.durationHours < 10 / 60);
    if (hasShort) useRecoveryStore.getState().purgeShortSessions();
  }, []);

  // Initialise RevenueCat and sync subscription status on startup
  useEffect(() => {
    if (!REVENUECAT_CONFIGURED) return;
    const { userId } = useAuthStore.getState();
    initRevenueCat(userId ?? undefined);
    void syncPremiumStatus();
  }, []);

  // Daily reset for steps + water — fires on every foreground
  useEffect(() => {
    useActivityStore.getState().checkDailyReset();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useActivityStore.getState().checkDailyReset();
    });
    return () => sub.remove();
  }, []);

  // Re-register DeviceActivity nightly block schedule on every launch.
  // The schedule is lost after reinstall/reset; this ensures it's always active.
  useEffect(() => {
    if (!hydrated || !ScreenTimeManager.isAvailable) return;
    const { settings } = useCoachStore.getState();
    if (!settings.screenTimeEnabled) return;
    const bed  = parseTimeHM(settings.bedtimeReminderTime ?? '22:30');
    const wake = parseTimeHM(settings.wakeTime ?? '07:00');
    if (bed && wake) {
      void ScreenTimeManager.scheduleNightlyBlock(bed.h, bed.m, wake.h, wake.m);
    }
  }, [hydrated]);

  // JS-level bedtime blocking enforcement — fires on every app foreground.
  // This is a reliable fallback when the DeviceActivity extension (CocoDeviceActivityMonitor)
  // fails to wake at the exact scheduled time.
  useEffect(() => {
    if (!ScreenTimeManager.isAvailable) return;

    function checkAndEnforceBlock() {
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
          void ScreenTimeManager.startSleepBlock([], Math.max(remaining, 30));
        }
      } else {
        try { ScreenTimeManager.stopSleepBlock(); } catch { /* no-op */ }
      }
    }

    // Check immediately on mount
    checkAndEnforceBlock();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndEnforceBlock();
    });
    return () => sub.remove();
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
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bgDeep } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', gestureEnabled: true }} />
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
    </>
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
