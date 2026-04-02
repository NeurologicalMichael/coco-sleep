import { useState, useRef, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, Image, StyleSheet, Switch, TouchableOpacity, Alert, Modal, Animated, AppState, TextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../constants/supabase';
import { redeemPromoCode } from '../../lib/promoCodes';
import { useAuthStore } from '../../store/authStore';
import { useSleepStore } from '../../store/sleepStore';
import { useActivityStore } from '../../store/activityStore';
import { useSleepDebtStore } from '../../store/sleepDebtStore';
import { scoreToCocoLevel, COCO_LEVELS } from '../../constants/cocoLevels';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { useCocoStore } from '../../store/cocoStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { TIERS, getTierForLevel } from '../../constants/tiers';
import { useSleepCoach } from '../../hooks/useSleepCoach';
import { ScreenTimeManager } from '../../modules/ScreenTimeManager';
import { useCoachStore } from '../../store/coachStore';
import { usePurchaseStore } from '../../store/purchaseStore';
import { ProGate } from '../../components/ProGate';
import { parseTimeHM } from '../../utils/timeHelpers';
import { useUserProfileStore } from '../../store/userProfileStore';

export default function ProfileScreen() {
  const router = useRouter();
  const { tier } = useCocoStore();
  const { history } = useRecoveryStore();
  const { isPremium, isTrialing } = usePurchaseStore();
  const { userId, username } = useAuthStore();
  const { profilePictureUri, setProfile } = useUserProfileStore();
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const currentTier = getTierForLevel(tier);

  const { settings, updateSettings, notificationsAuthorized, enableCoach, disableCoach } = useSleepCoach();
  const { screenTimeAuthorized, setScreenTimeAuthorized, selectedAppsCount, setSelectedAppsCount } = useCoachStore();
  const [openPicker, setOpenPicker] = useState<'bedtime' | 'waketime' | 'alarm' | null>(null);
  const [showCooldown, setShowCooldown] = useState(false);
  const cooldownProgress = useRef(new Animated.Value(1)).current; // 1→0 over 60s
  const cooldownAnim     = useRef<Animated.CompositeAnimation | null>(null);
  const [cooldownDone, setCooldownDone] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(60);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // AppState failsafe: auto-unlock if app comes to foreground past wake time
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !settings.screenTimeEnabled) return;
      const wake = parseTimeHM(settings.wakeTime ?? '07:00');
      const bed  = parseTimeHM(settings.bedtimeReminderTime ?? '22:30');
      if (!wake || !bed) return;
      const now = new Date();
      const nowMins  = now.getHours() * 60 + now.getMinutes();
      const wakeMins = wake.h * 60 + wake.m;
      const bedMins  = bed.h * 60 + bed.m;
      // Only auto-unlock if we're past wake time but before next bedtime
      const pastWake = bedMins > wakeMins
        ? (nowMins >= wakeMins && nowMins < bedMins)
        : nowMins >= wakeMins;
      if (pastWake && ScreenTimeManager.isAvailable) {
        try { ScreenTimeManager.stopSleepBlock(); } catch { /* no-op */ }
      }
    });
    return () => sub.remove();
  }, [settings.screenTimeEnabled, settings.wakeTime, settings.bedtimeReminderTime]);

  function startCooldown() {
    setCooldownDone(false);
    setCooldownSeconds(60);
    cooldownProgress.setValue(1);
    setShowCooldown(true);
    cooldownAnim.current = Animated.timing(cooldownProgress, {
      toValue: 0,
      duration: 60_000,
      useNativeDriver: false,
    });
    cooldownAnim.current.start(({ finished }) => {
      if (finished) setCooldownDone(true);
    });
    // Tick counter every second for the number display
    countdownTimer.current = setInterval(() => {
      setCooldownSeconds((s) => {
        if (s <= 1) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  function cancelCooldown() {
    cooldownAnim.current?.stop();
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setShowCooldown(false);
    setCooldownDone(false);
    setCooldownSeconds(60);
  }

  function confirmDisable() {
    cancelCooldown();
    updateSettings({ screenTimeEnabled: false });
    setScreenTimeAuthorized(false);
    if (ScreenTimeManager.isAvailable) {
      try { ScreenTimeManager.cancelNightlyBlock(); } catch { /* no-op */ }
      try { ScreenTimeManager.stopSleepBlock(); } catch { /* no-op */ }
    }
  }

  async function devResetApp() {
    Alert.alert('Reset App?', 'Clears all data and restarts onboarding.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'RESET', style: 'destructive', onPress: async () => {
          // Sign out of Supabase so loadSession creates a fresh anonymous account
          await supabase.auth.signOut();
          // Wipe all persisted store data
          await AsyncStorage.clear();
          // Reset all in-memory store state
          useCocoStore.setState({ tier: 1, xp: 0, streak: 0, longestStreak: 0, totalSessions: 0, mood: 'neutral', hasSeenOnboarding: false });
          useRecoveryStore.setState({ latestSession: null, history: [] });
          useSleepStore.setState({ activeSession: null });
          useActivityStore.setState({ steps: 0, water: 0 } as any);
          useSleepDebtStore.setState({ debtHours: 0, lastUpdated: null });
          useAuthStore.setState({ userId: null, username: null, isAuthenticated: false, isAnonymous: true });
          usePurchaseStore.getState().setPremium(false);
          router.replace('/onboarding');
        },
      },
    ]);
  }

  function isInSleepWindow(bedtime: string, wakeTime: string): boolean {
    const bed  = parseTimeHM(bedtime ?? '22:30');
    const wake = parseTimeHM(wakeTime ?? '07:00');
    if (!bed || !wake) return false;
    const now = new Date();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const bedMins  = bed.h * 60 + bed.m;
    const wakeMins = wake.h * 60 + wake.m;
    if (bedMins > wakeMins) return nowMins >= bedMins || nowMins < wakeMins;
    return nowMins >= bedMins && nowMins < wakeMins;
  }

  async function handleScreenTimeToggle(val: boolean) {
    if (val) {
      if (!ScreenTimeManager.isAvailable) {
        Alert.alert('Custom Build Required', 'Screen Time blocking requires a native build with the FamilyControls entitlement.');
        return;
      }
      try {
        const status = ScreenTimeManager.getAuthorizationStatus();
        if (status !== 'approved') {
          await ScreenTimeManager.requestAuthorization();
        }
        setScreenTimeAuthorized(true);
        setSelectedAppsCount(ScreenTimeManager.getSelectedAppsCount());
        updateSettings({ screenTimeEnabled: true });
        await scheduleBlock(settings.bedtimeReminderTime, settings.wakeTime);
        // If we're currently inside the sleep window, block immediately
        if (isInSleepWindow(settings.bedtimeReminderTime, settings.wakeTime)) {
          await ScreenTimeManager.startSleepBlock([], 480);
        }
      } catch (e: any) {
        const msg = e?.message ?? '';
        if (msg.includes('one application at a time')) {
          Alert.alert('Already Claimed', 'Another app (or a previous build) already holds Screen Time authorization. Delete it from your device and try again.');
        } else {
          Alert.alert('Error', msg || 'Could not enable Screen Time blocking.');
        }
      }
    } else {
      // Show Opal-style 60-second cooldown instead of immediately disabling
      startCooldown();
    }
  }

  async function scheduleBlock(bedtime: string, wakeTime: string) {
    if (!ScreenTimeManager.isAvailable) return;
    const bed  = parseTimeHM(bedtime ?? '22:30');
    const wake = parseTimeHM(wakeTime ?? '07:00');
    if (!bed || !wake) return;
    await ScreenTimeManager.scheduleNightlyBlock(bed.h, bed.m, wake.h, wake.m);
  }

  async function handleChooseApps() {
    if (!ScreenTimeManager.isAvailable) return;
    const count = await ScreenTimeManager.presentAppPicker();
    setSelectedAppsCount(count);
    // Selecting apps implies the user wants blocking enabled
    if (count > 0) {
      updateSettings({ screenTimeEnabled: true });
      setScreenTimeAuthorized(true);
    }
  }

  async function pickProfilePicture() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setProfile({ profilePictureUri: result.assets[0].uri });
    }
  }

  return (
    <>
    {/* Opal-style 60-second cooldown modal */}
    <Modal visible={showCooldown} transparent animationType="fade">
      <View style={styles.cooldownOverlay}>
        <View style={styles.cooldownCard}>
          <Text style={styles.cooldownEyebrow}>// SCREEN TIME</Text>
          <Text style={styles.cooldownTitle}>ARE YOU SURE?</Text>
          <Text style={styles.cooldownBody}>
            Disabling screen time breaks your protection. Think about it for 60 seconds.
          </Text>

          {/* Progress bar */}
          <View style={styles.cooldownBarTrack}>
            <Animated.View
              style={[
                styles.cooldownBarFill,
                { width: cooldownProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>

          <Text style={styles.cooldownTimer}>{cooldownSeconds}s</Text>

          <TouchableOpacity
            style={[styles.cooldownDisableBtn, !cooldownDone && styles.cooldownDisableBtnDisabled]}
            onPress={cooldownDone ? confirmDisable : undefined}
            activeOpacity={cooldownDone ? 0.7 : 1}
          >
            <Text style={[styles.cooldownDisableText, !cooldownDone && styles.cooldownDisableTextDisabled]}>
              DISABLE ANYWAY
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cooldownKeepBtn} onPress={cancelCooldown}>
            <Text style={styles.cooldownKeepText}>KEEP BLOCKING</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile picture + username */}
      <View style={styles.profileHeader}>
        <TouchableOpacity onPress={pickProfilePicture} activeOpacity={0.8} style={styles.avatarWrap}>
          {profilePictureUri ? (
            <Image source={{ uri: profilePictureUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarPlaceholderText}>
                {username ? username[0].toUpperCase() : 'C'}
              </Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <Text style={styles.avatarEditText}>✎</Text>
          </View>
        </TouchableOpacity>
        {username && <Text style={styles.profileUsername}>@{username}</Text>}
      </View>

      {/* Tier card */}
      <View style={[styles.tierOuter, { borderColor: currentTier.color, borderLeftColor: currentTier.color }]}>
        <DiagonalStripes color={currentTier.color} opacity={0.06} />
        <View style={styles.tierInner}>
          <View style={[styles.cocoBlock, { backgroundColor: currentTier.color }]}><Text style={styles.cocoBlockText}>CC</Text></View>
          <View>
            <Text style={[styles.tierName, { color: currentTier.color }]}>{currentTier.name.toUpperCase()}</Text>
            <Text style={styles.tierDesc}>TIER {tier} OF {TIERS.length}</Text>
          </View>
        </View>
      </View>

      {/* Pro banner */}
      {isPremium ? (
        <View style={styles.proBanner}>
          <Text style={styles.proBannerText}>{isTrialing ? 'COCO PRO — FREE TRIAL ACTIVE' : 'COCO PRO — ACTIVE'}</Text>
        </View>
      ) : (
        <TouchableOpacity onPress={() => router.push('/paywall')}>
          <View style={styles.upgradeOuter}>
            <DiagonalStripes color={Colors.gold} opacity={0.06} />
            <View style={styles.upgradeInner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.upgradeTitle}>UNLOCK COCO PRO</Text>
                <Text style={styles.upgradeSub}>HRV, cortisol, sleep charts, global rankings + more — 7 days free</Text>
              </View>
              <Text style={styles.upgradeArrow}>→</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* Sleep Coach */}
      <View style={styles.coachOuter}>
        <DiagonalStripes opacity={0.04} />
        <View style={styles.coachInner}>
          <View style={styles.coachHeader}>
            <View>
              <Text style={styles.coachTitle}>SLEEP COACH</Text>
              <Text style={styles.coachSub}>{notificationsAuthorized ? '● ACTIVE' : '○ NOTIFICATIONS OFF'}</Text>
            </View>
            <Switch
              value={settings.bedtimeReminderEnabled}
              onValueChange={(v) => { void (v ? enableCoach() : disableCoach()); }}
              trackColor={{ false: Colors.border, true: Colors.red }}
              thumbColor={Colors.textPrimary}
              accessibilityLabel="Toggle sleep coach"
            />
          </View>

          {settings.bedtimeReminderEnabled && (
            <View style={styles.coachRows}>
              {[
                { icon: 'BED', label: 'Bedtime Reminder', sublabel: settings.bedtimeReminderTime, value: settings.bedtimeReminderEnabled, onChange: (v: boolean) => updateSettings({ bedtimeReminderEnabled: v }) },
                { icon: 'WND', label: 'Wind-Down Warning', sublabel: `${settings.windDownMinutes}min before bed`, value: settings.bedtimeReminderEnabled, onChange: () => {} },
                { icon: 'RPT', label: 'Morning Report', sublabel: settings.morningReportTime, value: settings.morningReportEnabled, onChange: (v: boolean) => updateSettings({ morningReportEnabled: v }) },
                { icon: 'STK', label: 'Streak Alerts', sublabel: "If you haven't tracked by bedtime", value: settings.streakWarningEnabled, onChange: (v: boolean) => updateSettings({ streakWarningEnabled: v }) },
                { icon: 'NRG', label: 'Slacking Nudges', sublabel: `Fires when 7d avg drops below ${settings.slackingThreshold}`, value: settings.slackingNudgesEnabled, onChange: (v: boolean) => updateSettings({ slackingNudgesEnabled: v }) },
              ].map((row) => (
                <CoachRow key={row.label} {...row} />
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Schedule */}
      <View style={[styles.scheduleCard, { marginTop: 12 }]}>
        {(['bedtime', 'waketime'] as const).map((field) => {
          const isOpen = openPicker === field;
          const timeStr = (field === 'bedtime' ? settings.bedtimeReminderTime : settings.wakeTime) ?? (field === 'bedtime' ? '22:30' : '07:00');
          const label = field === 'bedtime' ? 'BEDTIME' : 'WAKE UP';
          const parsedTime = parseTimeHM(timeStr) ?? { h: field === 'bedtime' ? 22 : 7, m: field === 'bedtime' ? 30 : 0 };
          const { h, m } = parsedTime;
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 || 12;
          const display = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
          const pickerDate = (() => { const d = new Date(); d.setHours(h, m, 0, 0); return d; })();
          return (
            <View key={field}>
              <TouchableOpacity
                style={[styles.scheduleRow, field === 'bedtime' && styles.scheduleRowBorder]}
                onPress={() => setOpenPicker(isOpen ? null : field)}
              >
                <View>
                  <Text style={styles.scheduleRowLabel}>{label}</Text>
                  <Text style={styles.scheduleRowSub}>
                    {field === 'bedtime' ? 'When you plan to sleep' : 'When your alarm goes off'}
                  </Text>
                </View>
                <Text style={[styles.scheduleRowTime, isOpen && { color: Colors.red }]}>{display}</Text>
              </TouchableOpacity>
              {isOpen && (
                <DateTimePicker
                  value={pickerDate}
                  mode="time"
                  display="spinner"
                  textColor="#FFFFFF"
                  themeVariant="dark"
                  minuteInterval={15}
                  onChange={(_, date) => {
                    if (!date) return;
                    const hh = date.getHours().toString().padStart(2, '0');
                    const mm = date.getMinutes().toString().padStart(2, '0');
                    const val = `${hh}:${mm}`;
                    if (field === 'bedtime') {
                      updateSettings({ bedtimeReminderTime: val });
                      if (settings.screenTimeEnabled) void scheduleBlock(val, settings.wakeTime);
                    } else {
                      updateSettings({ wakeTime: val, morningReportTime: val });
                      if (settings.screenTimeEnabled) void scheduleBlock(settings.bedtimeReminderTime, val);
                    }
                  }}
                />
              )}
            </View>
          );
        })}
      </View>

      {/* App Blocking */}
      <ProGate
        feature="App Blocking"
        description="Automatically block distracting apps at your bedtime and unblock them when you wake up."
      >
        <View style={styles.coachOuter}>
          <View style={styles.coachInner}>
            <View style={styles.coachHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.coachTitle}>BLOCK APPS AT NIGHT</Text>
                <Text style={styles.coachSub}>Blocks social & games during sleep window</Text>
              </View>
              <Switch
                value={settings.screenTimeEnabled}
                onValueChange={(v) => { void handleScreenTimeToggle(v); }}
                trackColor={{ false: Colors.border, true: Colors.red }}
                thumbColor={Colors.textPrimary}
                accessibilityLabel="Toggle app blocking"
              />
            </View>
            {!ScreenTimeManager.isAvailable && (
              <View style={styles.nativeBadge}>
                <Text style={styles.nativeBadgeText}>REQUIRES NATIVE BUILD</Text>
              </View>
            )}
            {settings.screenTimeEnabled && ScreenTimeManager.isAvailable && (
              <TouchableOpacity onPress={() => { void handleChooseApps(); }} style={styles.chooseAppsBtn}>
                <View style={styles.chooseAppsBtnInner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chooseAppsTitle}>
                      {selectedAppsCount > 0 ? `${selectedAppsCount} APPS / CATEGORIES SELECTED` : 'CHOOSE APPS TO BLOCK'}
                    </Text>
                    <Text style={styles.chooseAppsSub}>
                      {selectedAppsCount > 0 ? 'Tap to change selection' : 'Pick which apps to block at night'}
                    </Text>
                  </View>
                  <Text style={styles.chooseAppsArrow}>→</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ProGate>

      {/* Alarm */}
      <ProGate
        feature="Wake-Up Alarm"
        description="Set a daily alarm with custom days and time. Wakes you at the right moment."
      >
      <View style={styles.coachOuter}>
        <View style={styles.coachInner}>
          <View style={styles.coachHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.coachTitle}>WAKE-UP ALARM</Text>
              <Text style={styles.coachSub}>Daily alarm at your set time</Text>
            </View>
            <Switch
              value={settings.alarmEnabled}
              onValueChange={(v) => updateSettings({ alarmEnabled: v })}
              trackColor={{ false: Colors.border, true: Colors.red }}
              thumbColor={Colors.textPrimary}
              accessibilityLabel="Toggle alarm"
            />
          </View>

          {settings.alarmEnabled && (
            <View style={{ marginTop: 12 }}>
              {/* Time row */}
              <TouchableOpacity
                style={styles.alarmTimeRow}
                onPress={() => setOpenPicker(openPicker === 'alarm' ? null : 'alarm')}
              >
                <Text style={styles.scheduleRowLabel}>ALARM TIME</Text>
                {(() => {
                  const pt = parseTimeHM(settings.alarmTime ?? '07:00') ?? { h: 7, m: 0 };
                  const ampm = pt.h >= 12 ? 'PM' : 'AM';
                  return (
                    <Text style={[styles.scheduleRowTime, openPicker === 'alarm' && { color: Colors.red }]}>
                      {`${pt.h % 12 || 12}:${pt.m.toString().padStart(2, '0')} ${ampm}`}
                    </Text>
                  );
                })()}
              </TouchableOpacity>
              {openPicker === 'alarm' && (
                <DateTimePicker
                  value={(() => { const pt = parseTimeHM(settings.alarmTime ?? '07:00') ?? { h: 7, m: 0 }; const d = new Date(); d.setHours(pt.h, pt.m, 0, 0); return d; })()}
                  mode="time"
                  display="spinner"
                  textColor="#FFFFFF"
                  themeVariant="dark"
                  minuteInterval={5}
                  onChange={(_, date) => {
                    if (!date) return;
                    const hh = date.getHours().toString().padStart(2, '0');
                    const mm = date.getMinutes().toString().padStart(2, '0');
                    updateSettings({ alarmTime: `${hh}:${mm}` });
                  }}
                />
              )}

              {/* Day pills */}
              <View style={styles.alarmDaysRow}>
                {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day, idx) => {
                  const active = settings.alarmDays.includes(idx);
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[styles.alarmDayPill, active && styles.alarmDayPillActive]}
                      onPress={() => {
                        const days = active
                          ? settings.alarmDays.filter((d) => d !== idx)
                          : [...settings.alarmDays, idx].sort();
                        updateSettings({ alarmDays: days });
                      }}
                    >
                      <Text style={[styles.alarmDayText, active && styles.alarmDayTextActive]}>{day}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </View>
      </ProGate>

      {/* Privacy */}
      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>PRIVACY</Text>
      <View style={styles.privacyCard}>
        <View style={styles.privacyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.privacyTitle}>SHARE STATS WITH LEAGUES</Text>
            <Text style={styles.privacySub}>
              Share sleep duration, efficiency, and HRV with friends &amp; group members. Global leaderboard always shows only streak + avg score.
            </Text>
          </View>
          <Switch
            value={settings.shareLeagueStats}
            onValueChange={(val) => updateSettings({ shareLeagueStats: val })}
            trackColor={{ false: Colors.border, true: Colors.redDim }}
            thumbColor={settings.shareLeagueStats ? Colors.red : Colors.textMuted}
          />
        </View>
        {!settings.shareLeagueStats && (
          <View style={styles.privacyNote}>
            <Text style={styles.privacyNoteText}>
              // PRIVATE — league members see your rank but not your detailed metrics
            </Text>
          </View>
        )}
      </View>

      {/* Redeem code */}
      {!isPremium && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>REDEEM CODE</Text>
          <View style={styles.redeemCard}>
            <TextInput
              style={styles.redeemInput}
              placeholder="COCO-XXXX-XXXX"
              placeholderTextColor={Colors.textMuted}
              value={promoCode}
              onChangeText={(t) => setPromoCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.redeemBtn, redeeming && { opacity: 0.5 }]}
              disabled={redeeming || promoCode.length < 6}
              onPress={async () => {
                if (!userId) { Alert.alert('Not signed in'); return; }
                setRedeeming(true);
                const result = await redeemPromoCode(promoCode, userId);
                setRedeeming(false);
                if (result === 'ok') {
                  setPromoCode('');
                  Alert.alert('🥥 COCO PRO UNLOCKED', 'Access code accepted. Enjoy Pro!');
                } else if (result === 'used') {
                  Alert.alert('Already redeemed', 'This code has already been used.');
                } else if (result === 'invalid') {
                  Alert.alert('Invalid code', 'That code doesn\'t exist. Check for typos.');
                } else {
                  Alert.alert('Error', 'Something went wrong. Try again.');
                }
              }}
            >
              <Text style={styles.redeemBtnText}>{redeeming ? 'CHECKING...' : 'REDEEM'}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Tier progression */}
      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>TIER PROGRESSION</Text>
      {TIERS.map((t) => (
        <View key={t.level} style={[styles.tierRow, { borderLeftColor: t.color }, tier >= t.level && styles.tierRowUnlocked]}>
          <Text style={[styles.tierRowName, { color: tier >= t.level ? t.color : Colors.textMuted }]}>{t.name.toUpperCase()}</Text>
          <Text style={styles.tierRowReq}>{t.streakRequired}d · {t.avgScoreRequired}+</Text>
          {tier >= t.level && <Text style={styles.check}>✓</Text>}
        </View>
      ))}

      {/* History */}
      {history.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>RECENT SESSIONS</Text>
          {history.slice(0, 10).map((s) => {
            const lvl = scoreToCocoLevel(s.recovery.recoveryScore);
            const cocoInfo = COCO_LEVELS[lvl];
            return (
              <View key={s.id} style={styles.historyRow}>
                <Text style={styles.historyDate}>{s.date}</Text>
                <Text style={styles.historyTraining}>{s.durationHours.toFixed(1)}H</Text>
                {cocoInfo.image && (
                  <Image source={cocoInfo.image} style={styles.historyCocoImg} resizeMode="contain" />
                )}
                <Text style={[styles.historyScore, { color: s.recovery.recoveryScore >= 75 ? Colors.green : s.recovery.recoveryScore >= 50 ? Colors.gold : Colors.red }]}>
                  {s.recovery.recoveryScore}
                </Text>
              </View>
            );
          })}
        </>
      )}
      {__DEV__ && (
        <TouchableOpacity onPress={devResetApp} style={devResetStyles.btn}>
          <Text style={devResetStyles.txt}>DEV: RESET APP & ONBOARDING</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
    </>
  );
}

function CoachRow({ icon, label, sublabel, value, onChange }: { icon: string; label: string; sublabel: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={coachRowStyles.row}>
      <Text style={coachRowStyles.icon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={coachRowStyles.label}>{label.toUpperCase()}</Text>
        <Text style={coachRowStyles.sub}>{sublabel}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: Colors.border, true: Colors.red }} thumbColor={Colors.textPrimary} accessibilityLabel={`Toggle ${label}`} />
    </View>
  );
}

const coachRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  icon: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted, width: 28 },
  label: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  sub: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
});

const devResetStyles = StyleSheet.create({
  btn: {
    margin: 20,
    marginTop: 32,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.red,
    alignItems: 'center',
  },
  txt: {
    fontSize: 10,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1,
    color: Colors.red,
  },
});

const styles = StyleSheet.create({
  // Opal cooldown modal
  cooldownOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  cooldownCard: {
    backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#2A2A2A',
    borderLeftWidth: 4, borderLeftColor: '#FF2E2E',
    padding: 28, width: '100%',
  },
  cooldownEyebrow: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 3, color: '#FF2E2E', marginBottom: 4,
  },
  cooldownTitle: {
    fontSize: 32, fontWeight: '900', fontStyle: 'italic',
    color: '#FFFFFF', marginBottom: 12,
  },
  cooldownBody: {
    fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 20, marginBottom: 24,
  },
  cooldownBarTrack: {
    height: 3, backgroundColor: '#222', marginBottom: 8,
  },
  cooldownBarFill: {
    height: 3, backgroundColor: '#FF2E2E',
  },
  cooldownTimer: {
    fontSize: 11, fontWeight: '900', fontStyle: 'italic',
    color: 'rgba(255,255,255,0.3)', letterSpacing: 2, marginBottom: 24, textAlign: 'right',
  },
  cooldownDisableBtn: {
    backgroundColor: '#FF2E2E', paddingVertical: 14,
    alignItems: 'center', marginBottom: 10,
  },
  cooldownDisableBtnDisabled: {
    backgroundColor: '#1A1A1A',
  },
  cooldownDisableText: {
    fontSize: 12, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, color: '#FFFFFF',
  },
  cooldownDisableTextDisabled: {
    color: 'rgba(255,255,255,0.2)',
  },
  cooldownKeepBtn: {
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#FF2E2E',
  },
  cooldownKeepText: {
    fontSize: 12, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, color: '#FF2E2E',
  },

  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 24, paddingTop: 60, paddingBottom: 60 },

  profileHeader: { alignItems: 'center', marginBottom: 24 },
  avatarWrap: { position: 'relative', marginBottom: 10 },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: Colors.red },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.bgCard, borderWidth: 2, borderColor: Colors.red,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPlaceholderText: { fontSize: 32, fontWeight: '900', fontStyle: 'italic', color: Colors.red },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center',
  },
  avatarEditText: { fontSize: 11, color: '#fff', fontWeight: '900' },
  profileUsername: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', color: Colors.textSecondary, letterSpacing: 1 },

  header: { marginBottom: 16 },
  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 4 },
  title: { fontSize: 52, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 54 },
  titleUnderline: { height: 3, width: 60, backgroundColor: Colors.red, marginTop: 6 },

  tierOuter: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: 0,
    borderWidth: 1.5, borderLeftWidth: 5, marginBottom: 16, overflow: 'hidden',
    transform: [{ skewX: '-1.5deg' }],
  },
  tierInner: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, transform: [{ skewX: '1.5deg' }] },
  cocoBlock: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cocoBlockText: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', color: '#0D0D0D' },
  tierName: { fontSize: 20, fontWeight: '900', fontStyle: 'italic' },
  tierDesc: { fontSize: 10, color: Colors.textSecondary, marginTop: 2, fontWeight: '700', letterSpacing: 1 },

  proBanner: { backgroundColor: Colors.gold, padding: 10, alignItems: 'center', marginBottom: 16 },
  proBannerText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.bgDeep },
  upgradeOuter: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.gold,
    borderLeftWidth: 5, borderLeftColor: Colors.gold,
    overflow: 'hidden', marginBottom: 16,
  },
  upgradeInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  upgradeTitle: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', color: Colors.gold, marginBottom: 3 },
  upgradeSub: { fontSize: 11, color: Colors.textMuted },
  upgradeArrow: { fontSize: 20, color: Colors.gold, fontWeight: '900' },

  xpOuter: {
    backgroundColor: Colors.bgCard, borderRadius: 0, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: Colors.gold,
  },
  xpInner: { padding: 16 },
  xpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  xpLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textSecondary },
  xpValue: { fontSize: 11, fontWeight: '900', color: Colors.gold },
  xpBarBg: { height: 4, backgroundColor: Colors.border, borderRadius: 0 },
  xpBarFill: { height: 4, borderRadius: 0 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  statCard: {
    flexBasis: '31%', flexGrow: 1, backgroundColor: Colors.bgCard, borderRadius: 0, padding: 14,
    borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.red,
  },
  statValue: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 3 },
  statLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },

  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary, marginBottom: 12, textTransform: 'uppercase' },

  coachOuter: {
    backgroundColor: Colors.bgCard, borderRadius: 0, marginBottom: 4,
    borderWidth: 1.5, borderColor: Colors.red, overflow: 'hidden',
  },
  coachInner: { padding: 16 },
  coachHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  coachTitle: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  coachSub: { fontSize: 9, fontWeight: '900', color: Colors.red, marginTop: 2, letterSpacing: 1 },
  coachRows: { marginTop: 8 },

  scheduleCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 4, borderLeftColor: Colors.red, marginBottom: 4,
  },
  scheduleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  scheduleRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  scheduleRowLabel: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  scheduleRowSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  scheduleRowTime: { fontSize: 20, fontWeight: '900', fontStyle: 'italic', color: Colors.gold },

  nativeBadge: { marginTop: 10, backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 0, padding: 8, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  nativeBadgeText: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.warning },
  chooseAppsBtn: { marginTop: 12 },
  chooseAppsBtnInner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgDeep, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 4, borderLeftColor: Colors.red, padding: 14,
  },
  chooseAppsTitle: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.red, marginBottom: 2 },
  chooseAppsSub: { fontSize: 10, color: Colors.textMuted },
  chooseAppsArrow: { fontSize: 16, fontWeight: '900', color: Colors.red },

  alarmTimeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  alarmDaysRow: { flexDirection: 'row', gap: 6, marginTop: 14, flexWrap: 'wrap' },
  alarmDayPill: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.bgDeep,
  },
  alarmDayPillActive: { borderColor: Colors.red, backgroundColor: Colors.redDim },
  alarmDayText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: Colors.textMuted },
  alarmDayTextActive: { color: Colors.red },

  tierRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard,
    borderRadius: 0, padding: 14, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, gap: 12,
  },
  tierRowUnlocked: { backgroundColor: Colors.bgCardAlt },
  tierRowName: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', flex: 1 },
  tierRowReq: { fontSize: 9, color: Colors.textMuted, fontWeight: '700' },
  check: { fontSize: 13, color: Colors.green },

  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  historyCocoImg: { width: 36, height: 36 },
  historyDate: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  historyTraining: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted, flex: 1 },
  historyScore: { fontSize: 20, fontWeight: '900', fontStyle: 'italic' },

  redeemCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.gold,
    padding: 14, gap: 10, marginBottom: 8,
  },
  redeemInput: {
    backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 13, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, paddingHorizontal: 14, paddingVertical: 10,
  },
  redeemBtn: {
    backgroundColor: Colors.gold, alignItems: 'center', paddingVertical: 12,
  },
  redeemBtnText: {
    fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#000',
  },

  privacyCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.info, marginBottom: 8, overflow: 'hidden',
  },
  privacyRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  privacyTitle: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textPrimary, marginBottom: 4 },
  privacySub: { fontSize: 11, color: Colors.textMuted, lineHeight: 16 },
  privacyNote: { borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 16, paddingVertical: 10 },
  privacyNoteText: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted },
});
