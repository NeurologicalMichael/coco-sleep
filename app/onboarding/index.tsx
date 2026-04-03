import { useState, useRef, useMemo } from 'react';
import {
  Animated, View, Text, Image, StyleSheet, TouchableOpacity,
  Dimensions, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { useCocoStore } from '../../store/cocoStore';
import { useCoachStore } from '../../store/coachStore';
import { useAuthStore } from '../../store/authStore';
import { useUserProfileStore } from '../../store/userProfileStore';
import { useSleepDebtStore } from '../../store/sleepDebtStore';
import { ScreenTimeManager } from '../../modules/ScreenTimeManager';
import { supabase } from '../../constants/supabase';
import { parseTimeHM } from '../../utils/timeHelpers';
import type {
  AgeRange, Gender, SleepStruggle, HealthCondition, SleepGoal, PersonalPlan,
} from '../../store/userProfileStore';

const { height } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type Step =
  | 'welcome'
  | 'age'
  | 'gender'
  | 'workout_freq'
  | 'workout_intensity'
  | 'sleep_struggles'
  | 'health'
  | 'goals'
  | 'league'
  | 'username'
  | 'profile_picture'
  | 'schedule'
  | 'notifications'
  | 'screentime'
  | 'widget'
  | 'plan'
  | 'done';

interface UserSetup {
  ageRange:           AgeRange | null;
  gender:             Gender | null;
  workoutDaysPerWeek: number | null;
  workoutIntensity:   'light' | 'moderate' | 'intense' | null;
  sleepStruggles:     SleepStruggle[];
  healthConditions:   HealthCondition[];
  goals:              SleepGoal[];
  bedtime:            string;
  wakeTime:           string;
  username:           string;
  profilePictureUri:  string | null;
}

const STEPS: Step[] = [
  'welcome', 'age', 'gender', 'workout_freq', 'workout_intensity',
  'sleep_struggles', 'health', 'goals', 'league', 'username', 'profile_picture',
  'schedule', 'notifications', 'screentime', 'widget', 'plan', 'done',
];

// ─── Option config ────────────────────────────────────────────────────────────

const AGE_OPTIONS: { label: string; sub: string; value: AgeRange }[] = [
  { label: 'UNDER\n18',  sub: 'TEEN',       value: 'under18' },
  { label: '18–25',      sub: 'YOUNG ADULT', value: '18_25'  },
  { label: '26–35',      sub: 'ADULT',       value: '26_35'  },
  { label: '36–45',      sub: 'MID ADULT',   value: '36_45'  },
  { label: '46–55',      sub: 'MATURE',      value: '46_55'  },
  { label: '55+',        sub: 'SENIOR',      value: '56plus' },
];

const GENDER_OPTIONS: { label: string; sub: string; value: Gender }[] = [
  { label: 'MALE',   sub: 'Biological male',   value: 'male'   },
  { label: 'FEMALE', sub: 'Biological female', value: 'female' },
];

const FREQ_OPTIONS = [
  { label: '1–2×', sublabel: 'PER WEEK', value: 2 },
  { label: '3–4×', sublabel: 'PER WEEK', value: 4 },
  { label: '5–6×', sublabel: 'PER WEEK', value: 6 },
  { label: 'EVERY\nDAY', sublabel: '7× / WEEK', value: 7 },
];

const INTENSITY_OPTIONS: { label: string; sub: string; value: UserSetup['workoutIntensity'] }[] = [
  { label: 'LIGHT',    sub: 'Walks, yoga, mobility',  value: 'light'    },
  { label: 'MODERATE', sub: 'Lifting, running',        value: 'moderate' },
  { label: 'INTENSE',  sub: 'HIIT, heavy lifting',     value: 'intense'  },
];

const STRUGGLE_OPTIONS: { label: string; sub: string; value: SleepStruggle }[] = [
  { label: "CAN'T FALL ASLEEP",    sub: 'Lying awake for ages',         value: 'cant_fall_asleep' },
  { label: 'FALL ASLEEP TOO LATE', sub: 'Going to bed way too late',    value: 'sleep_too_late'   },
  { label: 'WAKE AT NIGHT',        sub: 'Multiple wake-ups',            value: 'wake_at_night'    },
  { label: 'EARLY WAKING',         sub: 'Up before the alarm',          value: 'early_waking'     },
  { label: 'UNREFRESHING SLEEP',   sub: 'Tired despite hours in bed',   value: 'unrefreshing'     },
  { label: 'SNORING',              sub: 'Noisy or gasping at night',    value: 'snoring'          },
  { label: 'STRESS / ANXIETY',     sub: "Racing thoughts at bedtime",   value: 'stress_anxiety'   },
];

const HEALTH_OPTIONS: { label: string; sub: string; value: HealthCondition; exclusive?: boolean }[] = [
  { label: 'NONE OF THESE',        sub: 'No known conditions',           value: 'none',               exclusive: true },
  { label: 'ANXIETY / DEPRESSION', sub: 'Mental health condition',       value: 'anxiety_depression'  },
  { label: 'SLEEP APNEA',          sub: 'Diagnosed or suspected',        value: 'sleep_apnea'         },
  { label: 'CHRONIC PAIN',         sub: 'Affects daily life',            value: 'chronic_pain'        },
  { label: 'SHIFT WORK',           sub: 'Irregular work hours',          value: 'shift_work'          },
  { label: 'HEART CONDITION',      sub: 'Cardiovascular diagnosis',      value: 'heart'               },
];

const GOAL_OPTIONS: { label: string; sub: string; value: SleepGoal }[] = [
  { label: 'BETTER\nRECOVERY',  sub: 'Train harder, recover faster',  value: 'better_recovery' },
  { label: 'MORE\nENERGY',      sub: 'Feel alert all day',             value: 'more_energy'     },
  { label: 'BUILD\nMUSCLE',     sub: 'Optimise sleep for gains',       value: 'build_muscle'    },
  { label: 'LOSE\nWEIGHT',      sub: 'Sleep & fat loss link',          value: 'lose_weight'     },
  { label: 'REDUCE\nSTRESS',    sub: 'Calm the nervous system',        value: 'reduce_stress'   },
  { label: 'TRACK\nHABITS',     sub: 'Build consistency over time',    value: 'track_habits'    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateToTimeString(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function timeStringToDate(t: string): Date {
  const parsed = parseTimeHM(t) ?? { h: 22, m: 0 };
  const d = new Date();
  d.setHours(parsed.h, parsed.m, 0, 0);
  return d;
}

function formatDisplayTime(t: string): string {
  const parsed = parseTimeHM(t) ?? { h: 22, m: 0 };
  const ampm = parsed.h >= 12 ? 'PM' : 'AM';
  const h12 = parsed.h % 12 || 12;
  return `${h12}:${parsed.m.toString().padStart(2, '0')} ${ampm}`;
}

// ─── Plan Generator ───────────────────────────────────────────────────────────

function generatePersonalPlan(setup: UserSetup): PersonalPlan {
  const { ageRange, workoutIntensity, workoutDaysPerWeek, sleepStruggles, healthConditions, goals } = setup;

  // ── Sleep target ─────────────────────────────────────────────────────────
  let sleepTarget = 8.0;
  if (ageRange === 'under18')                         sleepTarget = 9.0;
  else if (ageRange === '18_25')                      sleepTarget = 8.5;
  else if (ageRange === '46_55' || ageRange === '56plus') sleepTarget = 7.5;

  if (workoutIntensity === 'intense')                 sleepTarget = Math.min(sleepTarget + 0.5, 9.5);
  if ((workoutDaysPerWeek ?? 0) >= 5)                 sleepTarget = Math.min(sleepTarget + 0.25, 9.5);
  sleepTarget = Math.round(sleepTarget * 2) / 2; // snap to .0 or .5

  // ── Headline ─────────────────────────────────────────────────────────────
  const GOAL_HEADLINES: Partial<Record<SleepGoal, string>> = {
    better_recovery: 'OPTIMISE YOUR RECOVERY',
    more_energy:     'UNLOCK ALL-DAY ENERGY',
    build_muscle:    'SLEEP YOUR WAY STRONGER',
    lose_weight:     'BURN FAT WHILE YOU SLEEP',
    reduce_stress:   'REWIRE YOUR STRESS RESPONSE',
    track_habits:    'BUILD YOUR SLEEP HABIT',
  };
  const headline = GOAL_HEADLINES[goals[0]] ?? 'YOUR PERSONAL SLEEP PLAN';

  // ── Recommendations ───────────────────────────────────────────────────────
  type Rec = { title: string; body: string; color: string };
  const recs: Rec[] = [];

  const add = (r: Rec) => { if (recs.length < 4) recs.push(r); };

  // Struggle-based
  if (sleepStruggles.includes('cant_fall_asleep'))
    add({ title: 'WIND-DOWN ROUTINE',      color: Colors.info,  body: 'Dim lights 90 min before bed and avoid screens 30 min out. Try box breathing: 4s in — 4s hold — 4s out — 4s out.' });
  if (sleepStruggles.includes('wake_at_night'))
    add({ title: 'ENVIRONMENT CONTROL',    color: Colors.info,  body: 'Target 65–68°F room temperature. Cut fluids 2h before bed. White noise masks the sounds that pull you out of deep sleep.' });
  if (sleepStruggles.includes('early_waking'))
    add({ title: 'ANCHOR YOUR WAKE TIME',  color: Colors.gold,  body: 'Keep wake time fixed — even on weekends. Morning light exposure (10+ min) locks your circadian clock and reduces early waking.' });
  if (sleepStruggles.includes('unrefreshing'))
    add({ title: 'MAXIMISE DEEP SLEEP',    color: Colors.gold,  body: 'Alcohol cuts deep sleep by up to 40% — even 1–2 drinks. Exercise earlier in the day, not within 4h of bed.' });
  if (sleepStruggles.includes('snoring'))
    add({ title: 'AIRWAY OPTIMISATION',    color: Colors.red,   body: 'Side sleeping significantly reduces snoring. Elevate your head 10–15°. Persistent snoring may indicate sleep apnea — worth screening.' });
  if (sleepStruggles.includes('stress_anxiety'))
    add({ title: 'PRE-SLEEP MIND RESET',   color: Colors.info,  body: "Write tomorrow's to-do list before bed to offload mental load. Progressive muscle relaxation can cut sleep latency by up to half." });

  // Health-based
  if (healthConditions.includes('anxiety_depression'))
    add({ title: 'SCHEDULE CONSISTENCY',   color: Colors.gold,  body: 'For mood regulation, a fixed bedtime ± 30 min matters more than total hours. The weekend lie-in resets your clock — avoid it.' });
  if (healthConditions.includes('sleep_apnea'))
    add({ title: 'POSITIONAL SLEEP',       color: Colors.red,   body: 'Side sleeping reduces apnea events. Avoid sedatives and alcohol — both worsen airway obstruction during the night.' });
  if (healthConditions.includes('chronic_pain'))
    add({ title: 'PAIN & TEMPERATURE',     color: Colors.gold,  body: 'A cool sleep surface reduces pain sensitivity. Use pillows to offload pressure points at hips, knees, and shoulders.' });
  if (healthConditions.includes('shift_work'))
    add({ title: 'LIGHT MANAGEMENT',       color: Colors.info,  body: 'Block all light when sleeping during the day. Wear blue-light glasses on the drive home from night shifts to protect melatonin.' });
  if (healthConditions.includes('heart'))
    add({ title: 'HRV IS YOUR SIGNAL',     color: Colors.red,   body: 'Your HRV proxy score in Coco is especially meaningful. Three consecutive low-HRV nights is a clear signal to reduce training load.' });

  // Goal-based (fill remaining slots)
  if (goals.includes('build_muscle'))
    add({ title: 'SLEEP = GROWTH HORMONE', color: Colors.green, body: '70% of growth hormone releases during deep sleep. Missing your target by 1h reduces muscle protein synthesis by ~18%.' });
  if (goals.includes('lose_weight'))
    add({ title: 'DEBT COSTS FAT LOSS',    color: Colors.green, body: 'Under-sleeping raises ghrelin +24% and cuts leptin — two hormones that drive hunger and fat storage. Coco\'s debt tracker keeps you honest.' });
  if (goals.includes('reduce_stress'))
    add({ title: 'CORTISOL CONTROL',       color: Colors.green, body: 'Each additional hour of quality sleep cuts cortisol ~15%. Consistency beats duration for stress regulation.' });
  if (goals.includes('more_energy'))
    add({ title: 'TIMING BEATS DURATION',  color: Colors.green, body: 'Going to bed 1–2h before midnight extends deep sleep cycles — delivering more energy than sleeping in late.' });
  if (goals.includes('better_recovery'))
    add({ title: 'STREAK = MOMENTUM',      color: Colors.green, body: 'Even one missed night disrupts recovery momentum. Coco\'s streak system is built to keep you on track.' });
  if (goals.includes('track_habits'))
    add({ title: 'DATA DRIVES CHANGE',     color: Colors.green, body: 'Track 7 nights in a row first. Patterns only become visible with consistent data — that\'s when Coco gets smart.' });

  // Fallback
  if (recs.length === 0)
    add({ title: 'CONSISTENCY FIRST',      color: Colors.green, body: 'Go to bed and wake at the same time every day. This single habit delivers more benefit than any supplement or gadget.' });

  // ── Timeline ─────────────────────────────────────────────────────────────
  const hasConditions = healthConditions.some((c) => c !== 'none');
  const manyStruggles = sleepStruggles.length >= 3;
  let timeline = manyStruggles
    ? 'Expect noticeable improvement in 2–3 weeks with consistency.'
    : 'Most people feel the difference within 7–10 nights.';
  if (hasConditions) timeline += ' Work alongside your doctor for the best results.';

  return { sleepTarget, headline, recommendations: recs, timeline };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DiagonalHero({ color, glyph }: { color: string; glyph: string }) {
  const isRed = color === Colors.red;
  return (
    <View style={[heroS.container, { height: height * 0.22 }]}>
      <View style={[heroS.bg, { backgroundColor: isRed ? Colors.red : Colors.bgCard }]} />
      <View style={heroS.cut} />
      <DiagonalStripes color={isRed ? '#fff' : Colors.red} opacity={0.07} />
      <View style={heroS.center}>
        <Text style={[heroS.glyph, { color: isRed ? 'rgba(255,255,255,0.15)' : Colors.red }]}>{glyph}</Text>
      </View>
    </View>
  );
}

const heroS = StyleSheet.create({
  container: { overflow: 'hidden', position: 'relative' },
  bg: { ...StyleSheet.absoluteFillObject },
  cut: { position: 'absolute', bottom: -28, left: -20, right: -20, height: 60, backgroundColor: Colors.bgDeep, transform: [{ rotate: '-3deg' }] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 64, fontWeight: '900', fontStyle: 'italic', letterSpacing: -2 },
});

function DotIndicator({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{
          height: 3, borderRadius: 0,
          width: i === current ? 20 : 5,
          backgroundColor: i <= current ? Colors.red : Colors.textMuted,
        }} />
      ))}
    </View>
  );
}

function P5Btn({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityLabel={label} disabled={disabled} activeOpacity={disabled ? 1 : 0.7}>
      <View style={[secondary ? btnS.outer2 : btnS.outer, disabled && btnS.outerDisabled]}>
        <View style={secondary ? btnS.inner2 : btnS.inner}>
          <Text style={[secondary ? btnS.text2 : btnS.text, disabled && btnS.textDisabled]}>{label}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const btnS = StyleSheet.create({
  outer: { transform: [{ skewX: '-1.5deg' }] },
  outerDisabled: { opacity: 0.35 },
  inner: { backgroundColor: Colors.red, paddingVertical: 17, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  text: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },
  textDisabled: { color: 'rgba(255,255,255,0.5)' },
  outer2: { transform: [{ skewX: '-1.5deg' }] },
  inner2: { borderWidth: 1.5, borderColor: Colors.border, paddingVertical: 14, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  text2: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.textMuted },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const { setHasSeenOnboarding } = useCocoStore();
  const { updateSettings, setNotificationsAuthorized, setScreenTimeAuthorized, setSelectedAppsCount } = useCoachStore();
  const { signIn } = useAuthStore();
  const { setProfile: saveProfile } = useUserProfileStore();

  const { setTarget: setDebtTarget } = useSleepDebtStore();

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const [setup, setSetup] = useState<UserSetup>({
    ageRange:           null,
    gender:             null,
    workoutDaysPerWeek: null,
    workoutIntensity:   null,
    sleepStruggles:     [],
    healthConditions:   [],
    goals:              [],
    bedtime:            '22:30',
    wakeTime:           '07:00',
    username:           '',
    profilePictureUri:  null,
  });

  const [scheduleField, setScheduleField] = useState<'bedtime' | 'waketime'>('bedtime');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [finishing, setFinishing] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Generate plan whenever relevant inputs change
  const personalPlan = useMemo<PersonalPlan | null>(() => {
    if (!setup.goals.length) return null;
    return generatePersonalPlan(setup);
  }, [
    setup.ageRange, setup.workoutIntensity, setup.workoutDaysPerWeek,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setup.sleepStruggles.join(), setup.healthConditions.join(), setup.goals.join(),
  ]);

  // ── Animation ──────────────────────────────────────────────────────────────

  const opacity     = useRef(new Animated.Value(1)).current;
  const translateX  = useRef(new Animated.Value(0)).current;
  const animStyle   = { opacity, transform: [{ translateX }] };
  const animating   = useRef(false);

  function goToStep(newIdx: number) {
    if (animating.current) return;
    animating.current = true;
    const dir = newIdx > stepIdx ? -1 : 1;

    Animated.parallel([
      Animated.timing(opacity,     { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(translateX,  { toValue: dir * 28, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setStepIdx(newIdx);
      translateX.setValue(-dir * 28);
      opacity.setValue(0);
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 190, useNativeDriver: true }),
        Animated.timing(translateX, { toValue: 0, duration: 190, useNativeDriver: true }),
      ]).start(() => { animating.current = false; });
    });
  }

  function next() { goToStep(Math.min(stepIdx + 1, STEPS.length - 1)); }

  // ── Multi-select helpers ────────────────────────────────────────────────────

  function toggleStruggle(val: SleepStruggle) {
    setSetup((p) => ({
      ...p,
      sleepStruggles: p.sleepStruggles.includes(val)
        ? p.sleepStruggles.filter((s) => s !== val)
        : [...p.sleepStruggles, val],
    }));
  }

  function toggleHealth(val: HealthCondition) {
    setSetup((p) => {
      if (val === 'none') {
        return { ...p, healthConditions: p.healthConditions.includes('none') ? [] : ['none'] };
      }
      const without = p.healthConditions.filter((c) => c !== 'none');
      return {
        ...p,
        healthConditions: without.includes(val) ? without.filter((c) => c !== val) : [...without, val],
      };
    });
  }

  function toggleGoal(val: SleepGoal) {
    setSetup((p) => ({
      ...p,
      goals: p.goals.includes(val) ? p.goals.filter((g) => g !== val) : [...p.goals, val],
    }));
  }

  // ── Username ───────────────────────────────────────────────────────────────

  function handleUsernameChange(text: string) {
    const clean = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setSetup((p) => ({ ...p, username: clean }));
    setUsernameStatus('idle');
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (clean.length < 3) { if (clean.length > 0) setUsernameStatus('invalid'); return; }
    setUsernameStatus('checking');
    checkTimer.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('id').eq('username', clean).maybeSingle();
        if (error) { setUsernameStatus('idle'); return; }
        setUsernameStatus(data ? 'taken' : 'available');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
  }

  // ── Permissions ────────────────────────────────────────────────────────────

  async function requestNotifications() {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationsAuthorized(status === 'granted');
      updateSettings({ bedtimeReminderEnabled: status === 'granted' });
    } catch { /* no-op in Expo Go */ }
    next();
  }

  async function requestScreenTime() {
    if (!ScreenTimeManager.isAvailable) { next(); return; }
    try {
      const granted = await ScreenTimeManager.requestAuthorization();
      if (granted) {
        setScreenTimeAuthorized(true);
        updateSettings({ screenTimeEnabled: true });
        const count = await ScreenTimeManager.presentAppPicker();
        setSelectedAppsCount(count);
      }
    } catch { /* FamilyControls unavailable or denied */ }
    next();
  }

  // ── Finish ─────────────────────────────────────────────────────────────────

  async function finish() {
    if (finishing) return;
    setFinishing(true);

    const plan = personalPlan ?? generatePersonalPlan(setup);

    updateSettings({
      bedtimeReminderTime: setup.bedtime,
      wakeTime:            setup.wakeTime,
      morningReportEnabled: true,
      morningReportTime:   setup.wakeTime,
    });

    // Persist profile + update sleep debt target
    saveProfile({
      ageRange:           setup.ageRange,
      gender:             setup.gender,
      sleepStruggles:     setup.sleepStruggles,
      healthConditions:   setup.healthConditions,
      goals:              setup.goals,
      personalPlan:       plan,
      profilePictureUri:  setup.profilePictureUri,
    });
    setDebtTarget(plan.sleepTarget);

    try {
      await signIn(setup.username, setup.workoutDaysPerWeek ?? 3, setup.workoutIntensity ?? 'moderate');
    } catch (e: any) {
      if (e?.message === 'USERNAME_TAKEN') {
        setFinishing(false);
        goToStep(STEPS.indexOf('username'));
        setUsernameStatus('taken');
        return;
      }
      // Other errors — continue offline
    }

    setHasSeenOnboarding();
    router.replace('/(tabs)');
  }

  // ── Render step ────────────────────────────────────────────────────────────

  function renderStep() {
    // ── Welcome ──────────────────────────────────────────────────────────────
    if (step === 'welcome') {
      return (
        <>
          <DiagonalHero color={Colors.red} glyph="CC" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// WELCOME</Text>
            <Text style={s.title}>COCO{'\n'}SLEEP</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Your recovery coach. Track sleep, evolve Coco, own your mornings.</Text>
            <Text style={s.hint}>We'll build your personal sleep plan in about 90 seconds.</Text>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="LET'S GO →" onPress={next} />
          </View>
        </>
      );
    }

    // ── Age ───────────────────────────────────────────────────────────────────
    if (step === 'age') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="AGE" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// YOUR PROFILE</Text>
            <Text style={s.title}>HOW OLD{'\n'}ARE YOU?</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>We use this to calibrate your recommended sleep duration.</Text>
            <View style={s.grid2}>
              {AGE_OPTIONS.map((opt) => {
                const active = setup.ageRange === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.bigChip, active && s.bigChipActive]}
                    onPress={() => setSetup((p) => ({ ...p, ageRange: opt.value }))}
                  >
                    <Text style={[s.bigChipMain, active && s.bigChipMainActive]}>{opt.label}</Text>
                    <Text style={[s.bigChipSub, active && { color: Colors.red }]}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} disabled={setup.ageRange === null} />
          </View>
        </>
      );
    }

    // ── Gender ────────────────────────────────────────────────────────────────
    if (step === 'gender') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="YOU" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// YOUR PROFILE</Text>
            <Text style={s.title}>WHAT IS{'\n'}YOUR SEX?</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Used to personalise sleep and recovery insights.</Text>
            <View style={s.grid2}>
              {GENDER_OPTIONS.map((opt) => {
                const active = setup.gender === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.bigChip, active && s.bigChipActive]}
                    onPress={() => setSetup((p) => ({ ...p, gender: opt.value }))}
                  >
                    <Text style={[s.bigChipMain, active && s.bigChipMainActive]}>{opt.label}</Text>
                    <Text style={[s.bigChipSub, active && { color: Colors.red }]}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} disabled={setup.gender === null} />
          </View>
        </>
      );
    }

    // ── Workout frequency ─────────────────────────────────────────────────────
    if (step === 'workout_freq') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="TRN" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// TRAINING PROFILE</Text>
            <Text style={s.title}>HOW OFTEN DO{'\n'}YOU TRAIN?</Text>
            <View style={s.bar} />
            <View style={s.grid2}>
              {FREQ_OPTIONS.map((opt) => {
                const active = setup.workoutDaysPerWeek === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.bigChip, active && s.bigChipActive]}
                    onPress={() => setSetup((p) => ({ ...p, workoutDaysPerWeek: opt.value }))}
                  >
                    <Text style={[s.bigChipMain, active && s.bigChipMainActive]}>{opt.label}</Text>
                    <Text style={[s.bigChipSub, active && { color: Colors.red }]}>{opt.sublabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} disabled={setup.workoutDaysPerWeek === null} />
          </View>
        </>
      );
    }

    // ── Workout intensity ─────────────────────────────────────────────────────
    if (step === 'workout_intensity') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="INT" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// TRAINING PROFILE</Text>
            <Text style={s.title}>HOW HARD DO{'\n'}YOU PUSH?</Text>
            <View style={s.bar} />
            <View style={s.list}>
              {INTENSITY_OPTIONS.map((opt) => {
                const active = setup.workoutIntensity === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value as string}
                    style={[s.listRow, active && s.listRowActive]}
                    onPress={() => setSetup((p) => ({ ...p, workoutIntensity: opt.value }))}
                  >
                    <View style={[s.listDot, active && s.listDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.listLabel, active && s.listLabelActive]}>{opt.label}</Text>
                      <Text style={s.listSub}>{opt.sub}</Text>
                    </View>
                    {active && <Text style={s.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} disabled={setup.workoutIntensity === null} />
          </View>
        </>
      );
    }

    // ── Sleep struggles (multi-select) ────────────────────────────────────────
    if (step === 'sleep_struggles') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="ZZZ" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// SLEEP PROFILE</Text>
            <Text style={s.title}>ANY SLEEP{'\n'}STRUGGLES?</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Select all that apply. We'll target these directly in your plan.</Text>
            <View style={s.list}>
              {STRUGGLE_OPTIONS.map((opt) => {
                const active = setup.sleepStruggles.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.listRow, active && s.listRowActive]}
                    onPress={() => toggleStruggle(opt.value)}
                  >
                    <View style={[s.listDot, active && s.listDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.listLabel, active && s.listLabelActive]}>{opt.label}</Text>
                      <Text style={s.listSub}>{opt.sub}</Text>
                    </View>
                    {active && <Text style={s.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} />
            {setup.sleepStruggles.length === 0 && (
              <Text style={s.skipHint}>No struggles? Skip ahead.</Text>
            )}
          </View>
        </>
      );
    }

    // ── Health conditions (multi-select) ──────────────────────────────────────
    if (step === 'health') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="HLT" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// HEALTH PROFILE</Text>
            <Text style={s.title}>ANY HEALTH{'\n'}CONDITIONS?</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>This helps us flag relevant advice in your plan. Stays on your device.</Text>
            <View style={s.list}>
              {HEALTH_OPTIONS.map((opt) => {
                const active = setup.healthConditions.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.listRow, active && s.listRowActive, opt.exclusive && s.listRowExclusive]}
                    onPress={() => toggleHealth(opt.value)}
                  >
                    <View style={[s.listDot, active && s.listDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.listLabel, active && s.listLabelActive]}>{opt.label}</Text>
                      <Text style={s.listSub}>{opt.sub}</Text>
                    </View>
                    {active && <Text style={s.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} />
          </View>
        </>
      );
    }

    // ── Goals (multi-select) ──────────────────────────────────────────────────
    if (step === 'goals') {
      return (
        <>
          <DiagonalHero color={Colors.red} glyph="WIN" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// YOUR GOALS</Text>
            <Text style={s.title}>WHAT ARE YOU{'\n'}HERE FOR?</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Pick everything that matters. Your top pick drives your plan headline.</Text>
            <View style={s.grid2}>
              {GOAL_OPTIONS.map((opt) => {
                const active = setup.goals.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.bigChip, active && s.bigChipActive]}
                    onPress={() => toggleGoal(opt.value)}
                  >
                    <Text style={[s.bigChipMain, { fontSize: 16 }, active && s.bigChipMainActive]}>{opt.label}</Text>
                    <Text style={[s.bigChipSub, active && { color: Colors.red }]}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="BUILD MY PLAN →" onPress={next} disabled={setup.goals.length === 0} />
          </View>
        </>
      );
    }

    // ── League showcase ───────────────────────────────────────────────────────
    if (step === 'league') {
      return (
        <>
          <DiagonalHero color={Colors.red} glyph="LG" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// COMPETE</Text>
            <Text style={s.title}>SLEEP IS{'\n'}A SPORT.</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Your sleep score goes on a global leaderboard. Compete with friends. Flex your streak.</Text>

            <View style={{ gap: 10, marginTop: 20 }}>
              {([
                { icon: '🏆', title: 'WEEKLY LEAGUE', body: 'Ranked globally and in your friend group every week. Top sleepers win bragging rights.' },
                { icon: '🔥', title: 'STREAK WARS', body: 'Longest consecutive nights tracked = top of the streak board. Miss a night, lose your rank.' },
                { icon: '📊', title: 'SCORE BREAKDOWNS', body: 'Your sleep score is public. Duration, efficiency, WASO — all logged and ranked.' },
                { icon: '🔔', title: 'RIVAL ALERTS', body: 'Get notified the second a friend overtakes you in the league. Time to sleep better.' },
              ] as const).map((item) => (
                <View key={item.title} style={leagueCardS.card}>
                  <Text style={leagueCardS.icon}>{item.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={leagueCardS.title}>{item.title}</Text>
                    <Text style={leagueCardS.body}>{item.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="JOIN THE LEAGUE →" onPress={next} />
          </View>
        </>
      );
    }

    // ── Username ──────────────────────────────────────────────────────────────
    if (step === 'username') {
      const canContinue = setup.username.length >= 3 && (usernameStatus === 'available' || usernameStatus === 'idle');
      const statusColor = usernameStatus === 'available' ? Colors.green : usernameStatus === 'taken' ? Colors.red : Colors.textMuted;
      const statusText = usernameStatus === 'available' ? 'AVAILABLE' : usernameStatus === 'taken' ? 'TAKEN' : usernameStatus === 'invalid' ? 'MIN 3 CHARS' : usernameStatus === 'checking' ? 'CHECKING...' : '';
      return (
        <>
          <DiagonalHero color={Colors.red} glyph="@" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// YOUR IDENTITY</Text>
            <Text style={s.title}>PICK A{'\n'}USERNAME.</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>This is how you'll appear on the leaderboard.</Text>
            <View style={s.inputOuter}>
              <TextInput
                style={s.input}
                value={setup.username}
                onChangeText={handleUsernameChange}
                placeholder="your_handle"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
            </View>
            <View style={s.inputMeta}>
              {usernameStatus === 'checking'
                ? <ActivityIndicator size="small" color={Colors.red} />
                : <Text style={[s.statusText, { color: statusColor }]}>{statusText}</Text>
              }
              <Text style={s.charCount}>{setup.username.length}/20</Text>
            </View>
            <Text style={s.inputHint}>Letters, numbers, underscores only.</Text>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} disabled={!canContinue} />
          </View>
        </>
      );
    }

    // ── Profile picture ───────────────────────────────────────────────────────
    if (step === 'profile_picture') {
      async function pickImage() {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
        if (!result.canceled && result.assets[0]) {
          try {
            const dest = `${FileSystem.documentDirectory}profile_picture.jpg`;
            await FileSystem.copyAsync({ from: result.assets[0].uri, to: dest });
            setSetup((p) => ({ ...p, profilePictureUri: dest }));
          } catch {
            setSetup((p) => ({ ...p, profilePictureUri: result.assets[0].uri }));
          }
        }
      }
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="IMG" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// YOUR PROFILE</Text>
            <Text style={s.title}>ADD A{'\n'}PHOTO.</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Optional — shows on your profile screen.</Text>

            <TouchableOpacity onPress={pickImage} activeOpacity={0.8} style={s.avatarPickerWrap}>
              {setup.profilePictureUri ? (
                <Image source={{ uri: setup.profilePictureUri }} style={s.avatarPreview} />
              ) : (
                <View style={s.avatarPlaceholder}>
                  <Text style={s.avatarPlaceholderText}>
                    {setup.username ? setup.username[0].toUpperCase() : 'C'}
                  </Text>
                </View>
              )}
              <View style={s.avatarEditBadge}>
                <Text style={s.avatarEditText}>{setup.profilePictureUri ? '✎' : '+'}</Text>
              </View>
            </TouchableOpacity>

            {setup.profilePictureUri && (
              <TouchableOpacity onPress={() => setSetup((p) => ({ ...p, profilePictureUri: null }))} style={{ alignSelf: 'center', marginTop: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', fontStyle: 'italic', color: Colors.textMuted, letterSpacing: 1 }}>REMOVE PHOTO</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} />
            <P5Btn label="SKIP" onPress={next} secondary />
          </View>
        </>
      );
    }

    // ── Schedule ──────────────────────────────────────────────────────────────
    if (step === 'schedule') {
      const isBedtime = scheduleField === 'bedtime';
      const pickerDate = timeStringToDate(isBedtime ? setup.bedtime : setup.wakeTime);
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="BED" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// SLEEP SCHEDULE</Text>
            <Text style={s.title}>SET YOUR{'\n'}SCHEDULE.</Text>
            <View style={s.bar} />
            <View style={s.scheduleToggle}>
              {(['bedtime', 'waketime'] as const).map((field) => (
                <TouchableOpacity
                  key={field}
                  style={[s.scheduleTab, scheduleField === field && s.scheduleTabActive]}
                  onPress={() => setScheduleField(field)}
                >
                  <Text style={[s.scheduleTabLabel, scheduleField === field && s.scheduleTabLabelActive]}>
                    {field === 'bedtime' ? 'BEDTIME' : 'WAKE UP'}
                  </Text>
                  <Text style={[s.scheduleTabTime, scheduleField === field && { color: Colors.red }]}>
                    {field === 'bedtime' ? formatDisplayTime(setup.bedtime) : formatDisplayTime(setup.wakeTime)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <DateTimePicker
              value={pickerDate}
              mode="time"
              display="spinner"
              textColor="#FFFFFF"
              themeVariant="dark"
              minuteInterval={15}
              onChange={(_, date) => {
                if (!date) return;
                if (isBedtime) setSetup((p) => ({ ...p, bedtime: dateToTimeString(date) }));
                else           setSetup((p) => ({ ...p, wakeTime: dateToTimeString(date) }));
              }}
              style={{ marginTop: -8 }}
            />
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="NEXT →" onPress={next} />
          </View>
        </>
      );
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    if (step === 'notifications') {
      return (
        <>
          <DiagonalHero color={Colors.red} glyph="NTF" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// SLEEP COACH</Text>
            <Text style={s.title}>STAY ON TRACK.</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Coco will send you:</Text>
            {[
              'Bedtime reminders at your set time',
              'Wind-down warnings 30 min before bed',
              'Morning recovery reports',
              'Streak alerts if you forget to track',
            ].map((line) => (
              <Text key={line} style={s.bulletLine}>— {line}</Text>
            ))}
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="ALLOW NOTIFICATIONS →" onPress={requestNotifications} />
            <P5Btn label="NOT NOW" onPress={next} secondary />
          </View>
        </>
      );
    }

    // ── Screen time ───────────────────────────────────────────────────────────
    if (step === 'screentime') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="BLK" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// APP BLOCKING</Text>
            <Text style={s.title}>LOCK OUT{'\n'}DISTRACTIONS.</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>Coco blocks the apps you choose the moment bedtime hits — and unlocks them when you wake up.</Text>
            {[
              'You pick exactly which apps to block',
              'Activates automatically at your bedtime',
              'Unlocks automatically when you stop',
            ].map((line) => (
              <Text key={line} style={s.bulletLine}>— {line}</Text>
            ))}
            {!ScreenTimeManager.isAvailable && (
              <View style={s.nativeBadge}>
                <Text style={s.nativeBadgeText}>REQUIRES NATIVE BUILD — enable later in Profile</Text>
              </View>
            )}
          </ScrollView>
          <View style={s.footer}>
            <P5Btn
              label={ScreenTimeManager.isAvailable ? 'ENABLE + CHOOSE APPS →' : 'CONTINUE →'}
              onPress={requestScreenTime}
            />
            {ScreenTimeManager.isAvailable && (
              <P5Btn label="SKIP FOR NOW" onPress={next} secondary />
            )}
          </View>
        </>
      );
    }

    // ── Widget ────────────────────────────────────────────────────────────────
    if (step === 'widget') {
      return (
        <>
          <DiagonalHero color={Colors.bgCard} glyph="WGT" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// HOME SCREEN WIDGET</Text>
            <Text style={s.title}>ADD THE{'\n'}WIDGET.</Text>
            <View style={s.bar} />
            <Text style={s.subtitle}>See your recovery score at a glance — right on your home screen.</Text>
            <View style={s.widgetMockup}>
              <DiagonalStripes color={Colors.red} opacity={0.08} />
              <View style={{ padding: 18 }}>
                <Text style={s.widgetMockupEyebrow}>COCO</Text>
                <Text style={s.widgetMockupScore}>82</Text>
                <View style={s.widgetMockupBar}>
                  <View style={[s.widgetMockupBarFill, { width: '82%' }]} />
                </View>
                <Text style={s.widgetMockupSub}>RECOVERY  ·  7D STREAK</Text>
              </View>
            </View>
            {['Long-press your home screen', 'Tap the + button (top left)', 'Search for "Coco Sleep"', 'Pick Small or Medium size → Add'].map((line, i) => (
              <View key={i} style={s.widgetStep}>
                <View style={s.widgetStepNum}>
                  <Text style={s.widgetStepNumText}>{i + 1}</Text>
                </View>
                <Text style={s.widgetStepText}>{line}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="I'VE ADDED IT →" onPress={next} />
            <P5Btn label="DO IT LATER" onPress={next} secondary />
          </View>
        </>
      );
    }

    // ── Personal Plan reveal ──────────────────────────────────────────────────
    if (step === 'plan') {
      const plan = personalPlan ?? generatePersonalPlan(setup);
      const targetH = Math.floor(plan.sleepTarget);
      const targetM = Math.round((plan.sleepTarget - targetH) * 60);
      const targetStr = targetM === 0 ? `${targetH}H` : `${targetH}H ${targetM}M`;
      return (
        <>
          <DiagonalHero color={Colors.red} glyph="PLN" />
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
            <DotIndicator total={STEPS.length} current={stepIdx} />
            <Text style={s.eyebrow}>// YOUR PERSONAL PLAN</Text>
            <Text style={s.title}>{plan.headline}</Text>
            <View style={s.bar} />

            {/* Sleep target */}
            <View style={s.planTargetCard}>
              <DiagonalStripes color={Colors.red} opacity={0.07} />
              <View style={s.planTargetInner}>
                <View>
                  <Text style={s.planTargetLabel}>RECOMMENDED SLEEP TARGET</Text>
                  <Text style={s.planTargetValue}>{targetStr}</Text>
                  <Text style={s.planTargetSub}>PER NIGHT  ·  BASED ON YOUR PROFILE</Text>
                </View>
                <View style={s.planTargetBadge}>
                  <Text style={s.planTargetBadgeText}>GOAL</Text>
                </View>
              </View>
            </View>

            {/* Recommendations */}
            <Text style={s.planSection}>YOUR ACTION PLAN</Text>
            {plan.recommendations.map((rec, i) => (
              <View key={i} style={[s.planRec, { borderLeftColor: rec.color }]}>
                <DiagonalStripes color={rec.color} opacity={0.04} />
                <View style={s.planRecInner}>
                  <View style={[s.planRecDot, { backgroundColor: rec.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.planRecTitle, { color: rec.color }]}>{rec.title}</Text>
                    <Text style={s.planRecBody}>{rec.body}</Text>
                  </View>
                </View>
              </View>
            ))}

            {/* Timeline */}
            <View style={s.planTimeline}>
              <Text style={s.planTimelineLabel}>// TIMELINE</Text>
              <Text style={s.planTimelineText}>{plan.timeline}</Text>
            </View>
          </ScrollView>
          <View style={s.footer}>
            <P5Btn label="LOCK IT IN →" onPress={next} />
          </View>
        </>
      );
    }

    // ── Done ──────────────────────────────────────────────────────────────────
    const plan = personalPlan ?? generatePersonalPlan(setup);
    const targetH = Math.floor(plan.sleepTarget);
    const targetM = Math.round((plan.sleepTarget - targetH) * 60);
    const targetStr = targetM === 0 ? `${targetH}H` : `${targetH}H ${targetM}M`;
    return (
      <>
        <DiagonalHero color={Colors.red} glyph="GO" />
        <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
          <DotIndicator total={STEPS.length} current={STEPS.length - 1} />
          <Text style={s.eyebrow}>// ALL SET</Text>
          <Text style={s.title}>{`YOU'RE\nREADY.`}</Text>
          <View style={s.bar} />
          <Text style={s.subtitle}>Track your first night tonight. Coco will be watching.</Text>
          <View style={s.summaryCard}>
            <DiagonalStripes opacity={0.04} />
            <View style={{ padding: 16 }}>
              <Text style={s.summaryLabel}>YOUR SETUP</Text>
              {setup.username ? <Text style={s.summaryLine}>@{setup.username}</Text> : null}
              {setup.workoutDaysPerWeek ? <Text style={s.summaryLine}>{setup.workoutDaysPerWeek}× / week · {setup.workoutIntensity ?? 'moderate'} intensity</Text> : null}
              <Text style={s.summaryLine}>Bed {formatDisplayTime(setup.bedtime)}  ·  Up {formatDisplayTime(setup.wakeTime)}</Text>
              <Text style={[s.summaryLine, { color: Colors.red }]}>Sleep target: {targetStr} / night</Text>
              {setup.goals.length > 0 && (
                <Text style={s.summaryLine}>Goals: {setup.goals.map((g) => g.replace(/_/g, ' ')).join(', ')}</Text>
              )}
            </View>
          </View>
        </ScrollView>
        <View style={s.footer}>
          <P5Btn label={finishing ? 'CREATING ACCOUNT...' : 'START TRACKING →'} onPress={finish} disabled={finishing} />
        </View>
      </>
    );
  }

  return (
    <View style={s.screen}>
      <Animated.View style={[{ flex: 1 }, animStyle]}>
        {renderStep()}
      </Animated.View>
    </View>
  );
}

const leagueCardS = StyleSheet.create({
  card: {
    flexDirection: 'row', gap: 14, alignItems: 'flex-start',
    backgroundColor: Colors.bgCard,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.red,
    padding: 14, borderRadius: 4,
  },
  icon: { fontSize: 22, marginTop: 1 },
  title: {
    fontSize: 10, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1.5, color: Colors.red, marginBottom: 3,
  },
  body: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  body: { flex: 1, paddingHorizontal: 26 },
  bodyContent: { paddingTop: 24, paddingBottom: 16 },
  footer: { paddingHorizontal: 26, paddingBottom: 48, gap: 12 },

  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 4, color: Colors.red, marginBottom: 8 },
  title: { fontSize: 36, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 38, marginBottom: 10 },
  bar: { height: 3, width: 48, backgroundColor: Colors.red, marginBottom: 16 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, lineHeight: 22, marginBottom: 12 },
  hint: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  bulletLine: { fontSize: 13, color: Colors.textSecondary, lineHeight: 28, fontWeight: '600' },
  skipHint: { fontSize: 10, fontStyle: 'italic', color: Colors.textMuted, textAlign: 'center', marginTop: -4 },

  // 2-column grid chips
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  bigChip: {
    width: '47%', backgroundColor: Colors.bgCard,
    borderWidth: 1.5, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.textMuted,
    padding: 16, alignItems: 'center', gap: 4,
  },
  bigChipActive: { borderColor: Colors.red, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  bigChipMain: { fontSize: 20, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, textAlign: 'center' },
  bigChipMainActive: { color: Colors.red },
  bigChipSub: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted, textAlign: 'center' },

  // List rows
  list: { gap: 8, marginTop: 8 },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.bgCard, padding: 14,
    borderWidth: 1.5, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.textMuted,
  },
  listRowActive:    { borderColor: Colors.red,  borderLeftColor: Colors.red,  backgroundColor: Colors.redDim },
  listRowExclusive: { borderColor: Colors.border, borderLeftColor: Colors.textMuted },
  listDot:          { width: 8, height: 8, backgroundColor: Colors.textMuted },
  listDotActive:    { backgroundColor: Colors.red },
  listLabel:        { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  listLabelActive:  { color: Colors.red },
  listSub:          { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  checkmark:        { fontSize: 14, color: Colors.red, fontWeight: '900' },

  // Username input
  inputOuter: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1.5, borderColor: Colors.red, borderLeftWidth: 4, borderLeftColor: Colors.red, marginTop: 8,
  },
  input: { padding: 16, fontSize: 20, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 1 },
  inputMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },
  charCount: { fontSize: 9, color: Colors.textMuted, fontWeight: '700' },
  inputHint: { fontSize: 10, color: Colors.textMuted, marginTop: 4, fontStyle: 'italic' },

  // Profile picture step
  avatarPickerWrap: { alignSelf: 'center', position: 'relative', marginTop: 24, marginBottom: 8 },
  avatarPreview: { width: 110, height: 110, borderRadius: 55, borderWidth: 2, borderColor: Colors.red },
  avatarPlaceholder: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: Colors.bgCard, borderWidth: 2, borderColor: Colors.red,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPlaceholderText: { fontSize: 40, fontWeight: '900', fontStyle: 'italic', color: Colors.red },
  avatarEditBadge: {
    position: 'absolute', bottom: 4, right: 4,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center',
  },
  avatarEditText: { fontSize: 14, color: '#fff', fontWeight: '900' },

  // Schedule step
  scheduleToggle: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  scheduleTab: {
    flex: 1, padding: 14, backgroundColor: Colors.bgCard,
    borderWidth: 1.5, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.textMuted,
    alignItems: 'center', gap: 4,
  },
  scheduleTabActive: { borderColor: Colors.red, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  scheduleTabLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  scheduleTabLabelActive: { color: Colors.red },
  scheduleTabTime: { fontSize: 20, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },

  // Summary card
  summaryCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 4, borderLeftColor: Colors.red, marginTop: 16, overflow: 'hidden',
  },
  summaryLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 10 },
  summaryLine: { fontSize: 13, color: Colors.textSecondary, lineHeight: 26, fontWeight: '600' },

  // Native badge
  nativeBadge: { marginTop: 14, backgroundColor: 'rgba(245,158,11,0.1)', padding: 10, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', borderLeftWidth: 3, borderLeftColor: Colors.gold },
  nativeBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.gold },

  // Widget step
  widgetMockup: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 4, borderLeftColor: Colors.red, marginTop: 4, marginBottom: 18, overflow: 'hidden',
  },
  widgetMockupEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 3, color: Colors.red, marginBottom: 4 },
  widgetMockupScore: { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: Colors.green, lineHeight: 52 },
  widgetMockupBar: { height: 3, backgroundColor: Colors.border, marginVertical: 8, overflow: 'hidden' },
  widgetMockupBarFill: { height: '100%', backgroundColor: Colors.green },
  widgetMockupSub: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  widgetStep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  widgetStepNum: { width: 24, height: 24, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center' },
  widgetStepNumText: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', color: '#fff' },
  widgetStepText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, flex: 1, fontWeight: '600' },

  // Personal plan step
  planTargetCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 4, borderLeftColor: Colors.red, marginBottom: 20, overflow: 'hidden',
  },
  planTargetInner: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTargetLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginBottom: 4 },
  planTargetValue: { fontSize: 40, fontWeight: '900', fontStyle: 'italic', color: Colors.red, lineHeight: 42 },
  planTargetSub: { fontSize: 8, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, marginTop: 2 },
  planTargetBadge: { backgroundColor: Colors.red, paddingHorizontal: 10, paddingVertical: 6 },
  planTargetBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: '#fff', fontStyle: 'italic' },
  planSection: { fontSize: 9, fontWeight: '900', letterSpacing: 3, color: Colors.textMuted, fontStyle: 'italic', marginBottom: 10 },
  planRec: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, marginBottom: 10, overflow: 'hidden',
  },
  planRecInner: { padding: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  planRecDot: { width: 7, height: 7, marginTop: 4 },
  planRecTitle: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, marginBottom: 4 },
  planRecBody: { fontSize: 12, color: Colors.textSecondary, lineHeight: 19 },
  planTimeline: {
    marginTop: 8, padding: 14,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.textMuted,
  },
  planTimelineLabel: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textMuted, marginBottom: 6 },
  planTimelineText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 20, fontStyle: 'italic' },
});
