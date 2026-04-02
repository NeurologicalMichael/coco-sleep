import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAudioPlayer } from 'expo-audio';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { useRecoveryStore, ProcessedSession } from '../../store/recoveryStore';
import { RecoveryInsight } from '../../utils/recoveryEngine';
import { AudioEvent } from '../../utils/hrvProxy';
import { generateEstimatedEvents } from '../../utils/sleepScore';
import { scoreToCocoLevel, COCO_LEVELS } from '../../constants/cocoLevels';
import { usePurchaseStore } from '../../store/purchaseStore';
import { StageTimeline, MovementGraph } from '../../components/SleepCharts';
import { audioTypeLabel, audioTypeIcon } from '../../utils/audioSampler';
import { useSoundClipsStore, SoundClip } from '../../store/soundClipsStore';

const severityColor: Record<RecoveryInsight['severity'], string> = {
  good: Colors.green, neutral: Colors.info, warning: Colors.warning, critical: Colors.danger,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return Colors.green;
  if (score >= 50) return Colors.gold;
  return Colors.red;
}

function formatClockTime(ts: number) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ─── Bucket helpers ────────────────────────────────────────────────────────────

type Bucket = { label: string; sessions: ProcessedSession[] };

function buildDayBuckets(history: ProcessedSession[]): Bucket[] {
  const DAY = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  return Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - idx));
    const y = d.getFullYear(), mo = d.getMonth(), da = d.getDate();
    return {
      label: DAY[d.getDay()],
      sessions: history.filter((s) => { const sd = new Date(s.date); return sd.getFullYear()===y && sd.getMonth()===mo && sd.getDate()===da; }),
    };
  });
}

function buildWeekBuckets(history: ProcessedSession[]): Bucket[] {
  return Array.from({ length: 4 }, (_, idx) => {
    const i = 3 - idx;
    const end = new Date(); end.setDate(end.getDate() - i * 7);
    const start = new Date(end); start.setDate(start.getDate() - 6);
    const label = `${start.getMonth()+1}/${start.getDate()}`;
    const s0 = new Date(start).setHours(0,0,0,0);
    const e0 = new Date(end).setHours(23,59,59,999);
    return { label, sessions: history.filter((s) => { const t = new Date(s.date).getTime(); return t >= s0 && t <= e0; }) };
  });
}

function buildMonthBuckets(history: ProcessedSession[]): Bucket[] {
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return Array.from({ length: 6 }, (_, idx) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - idx));
    const y = d.getFullYear(), mo = d.getMonth();
    return {
      label: MONTHS[mo],
      sessions: history.filter((s) => { const sd = new Date(s.date); return sd.getFullYear()===y && sd.getMonth()===mo; }),
    };
  });
}

function avgOf(buckets: Bucket[], fn: (s: ProcessedSession) => number): { label: string; avg: number | null }[] {
  return buckets.map((b) => ({
    label: b.label,
    avg: b.sessions.length > 0 ? parseFloat((b.sessions.reduce((a, s) => a + fn(s), 0) / b.sessions.length).toFixed(1)) : null,
  }));
}

// ─── Bar chart with full axes ──────────────────────────────────────────────────

const CHART_H = 130; // pixel height of the bar area

function BarChart({ buckets, maxVal, formatVal, colorFn, ticks }: {
  buckets: { label: string; avg: number | null }[];
  maxVal: number;
  formatVal: (v: number) => string;
  colorFn: (v: number) => string;
  ticks?: number[];
}) {
  const yTicks = ticks ?? [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal].map(Math.round);

  return (
    <View style={{ flexDirection: 'row' }}>
      {/* Y-axis labels */}
      <View style={{ width: 32, height: CHART_H + 18 }}>
        {yTicks.map((t, i) => {
          const topPct = 1 - t / maxVal;
          return (
            <Text
              key={i}
              style={{
                position: 'absolute',
                top: topPct * CHART_H - 5,
                right: 4,
                fontSize: 7,
                fontWeight: '900',
                color: Colors.textMuted,
                textAlign: 'right',
              }}
            >
              {formatVal(t)}
            </Text>
          );
        })}
      </View>

      {/* Chart body */}
      <View style={{ flex: 1 }}>
        <View style={{ height: CHART_H, position: 'relative' }}>
          {/* Horizontal grid lines */}
          {yTicks.map((t, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                top: (1 - t / maxVal) * CHART_H,
                left: 0, right: 0, height: 1,
                backgroundColor: t === 0 ? Colors.textMuted : Colors.border,
                opacity: t === 0 ? 0.5 : 0.35,
              }}
            />
          ))}

          {/* Bars */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 3 }}>
            {buckets.map((b, i) => {
              const barH = b.avg !== null ? Math.max((b.avg / maxVal) * CHART_H, 3) : 0;
              const color = b.avg !== null ? colorFn(b.avg) : 'transparent';
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  {b.avg !== null && (
                    <Text style={{ fontSize: 7, fontWeight: '900', fontStyle: 'italic', color, marginBottom: 2, textAlign: 'center' }}>
                      {formatVal(b.avg)}
                    </Text>
                  )}
                  {b.avg === null && (
                    <Text style={{ fontSize: 7, color: Colors.textMuted, marginBottom: 2 }}>—</Text>
                  )}
                  <View style={{ width: '72%', height: barH, backgroundColor: b.avg !== null ? color : 'transparent' }} />
                </View>
              );
            })}
          </View>
        </View>

        {/* X-axis labels */}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 4, marginTop: 0 }}>
          {buckets.map((b, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 7, fontWeight: '900', letterSpacing: 0.3, color: Colors.textMuted }}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}


// ─── Averages Section ─────────────────────────────────────────────────────────

function AveragesSection({ history }: { history: ProcessedSession[] }) {
  const [period, setPeriod] = useState<'days' | 'weeks' | 'months'>('days');

  const buckets = period === 'days' ? buildDayBuckets(history)
    : period === 'weeks' ? buildWeekBuckets(history)
    : buildMonthBuckets(history);

  const scoreBuckets = avgOf(buckets, (s) => s.recovery.recoveryScore);
  const durBuckets   = avgOf(buckets, (s) => s.durationHours);
  const soundBuckets = avgOf(buckets, (s) => (s.audioEvents ?? []).filter((e) => e.type !== 'quiet').length);

  return (
    <View style={avgSt.container}>
      {/* Period toggle */}
      <View style={avgSt.toggle}>
        {(['days', 'weeks', 'months'] as const).map((p) => (
          <TouchableOpacity key={p} style={[avgSt.toggleBtn, period === p && avgSt.toggleActive]} onPress={() => setPeriod(p)} activeOpacity={0.7}>
            <Text style={[avgSt.toggleText, period === p && avgSt.toggleTextActive]}>{p.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={avgSt.label}>// RECOVERY SCORE</Text>
      <View style={avgSt.card}><BarChart buckets={scoreBuckets} maxVal={100} formatVal={(v) => `${Math.round(v)}`} colorFn={scoreColor} /></View>

      <Text style={avgSt.label}>// SLEEP DURATION (HRS)</Text>
      <View style={avgSt.card}><BarChart buckets={durBuckets} maxVal={10} formatVal={(v) => `${v}h`} colorFn={() => Colors.info} /></View>

      <Text style={avgSt.label}>// SLEEP SOUNDS DETECTED</Text>
      <View style={avgSt.card}><BarChart buckets={soundBuckets} maxVal={Math.max(10, ...soundBuckets.map((b) => b.avg ?? 0))} formatVal={(v) => `${Math.round(v)}`} colorFn={() => '#A855F7'} /></View>
    </View>
  );
}

const avgSt = StyleSheet.create({
  container: { marginBottom: 32 },
  toggle: { flexDirection: 'row', borderWidth: 1, borderColor: Colors.border, alignSelf: 'flex-start', marginBottom: 16 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  toggleActive: { backgroundColor: Colors.red },
  toggleText: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted },
  toggleTextActive: { color: '#fff' },
  label: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textMuted, marginBottom: 8 },
  card: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: Colors.red, padding: 16, marginBottom: 14 },
  legendText: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted },
});

// ─── Night history browser ────────────────────────────────────────────────────

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_NAMES   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function nightChipLabel(dateStr: string) {
  const d = new Date(dateStr);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
}

function NightHistoryBrowser({ history, isPremium }: { history: ProcessedSession[]; isPremium: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState(history[0]?.id ?? null);
  const session = history.find((s) => s.id === selected) ?? history[0] ?? null;
  const visible = isPremium ? history : history.slice(0, 7);

  if (!session) return null;

  return (
    <View>
      <Text style={histSt.eyebrow}>// NIGHT HISTORY</Text>

      {/* Night chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {visible.map((s) => {
          const active = s.id === selected;
          const sc = s.recovery.recoveryScore;
          const cocoInfo = COCO_LEVELS[scoreToCocoLevel(sc)];
          return (
            <TouchableOpacity key={s.id} style={[histSt.chip, active && histSt.chipActive]} onPress={() => setSelected(s.id)} activeOpacity={0.75}>
              {cocoInfo.image && <Image source={cocoInfo.image} style={histSt.chipImg} resizeMode="contain" />}
              <Text style={[histSt.chipDate, active && { color: Colors.textPrimary }]}>{nightChipLabel(s.date)}</Text>
              <Text style={[histSt.chipScore, { color: active ? scoreColor(sc) : Colors.textMuted }]}>{sc}</Text>
            </TouchableOpacity>
          );
        })}
        {!isPremium && history.length > 7 && (
          <TouchableOpacity style={histSt.chipLocked} onPress={() => router.push('/paywall')}>
            <Text style={histSt.chipLockedNum}>+{history.length - 7}</Text>
            <Text style={histSt.chipLockedPro}>PRO</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Selected night panel */}
      <NightPanel session={session} isPremium={isPremium} />
    </View>
  );
}

const histSt = StyleSheet.create({
  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 12 },
  chip: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, minWidth: 64 },
  chipActive: { borderColor: Colors.red, backgroundColor: 'rgba(255,45,45,0.08)' },
  chipImg: { width: 28, height: 28, marginBottom: 4 },
  chipDate: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted },
  chipScore: { fontSize: 13, fontWeight: '900', marginTop: 2 },
  chipLocked: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.gold, minWidth: 52, justifyContent: 'center' },
  chipLockedNum: { fontSize: 11, fontWeight: '900', color: Colors.gold },
  chipLockedPro: { fontSize: 8, fontWeight: '900', color: Colors.gold, marginTop: 2 },
});

// ─── Night Panel ──────────────────────────────────────────────────────────────

function NightPanel({ session, isPremium }: { session: ProcessedSession; isPremium: boolean }) {
  const router = useRouter();
  const [showInsights, setShowInsights] = useState(false);
  const score    = session.recovery.recoveryScore;
  const color    = scoreColor(score);
  const cocoInfo = COCO_LEVELS[scoreToCocoLevel(score)];
  const { recovery, scores, durationHours } = session;

  // Stage chart events
  const endedAt   = new Date(session.date).getTime();
  const startedAt = endedAt - durationHours * 3_600_000;
  const chartEvents = (session.movementEvents?.length ?? 0) > 0
    ? session.movementEvents!
    : generateEstimatedEvents(startedAt, endedAt, null);

  // Sound events
  const audioEvents = session.audioEvents ?? [];
  const nonQuiet    = audioEvents.filter((e) => e.type !== 'quiet');
  const soundCounts = {} as Record<AudioEvent['type'], number>;
  for (const e of nonQuiet) soundCounts[e.type] = (soundCounts[e.type] ?? 0) + 1;
  const clips = nonQuiet.filter((e) => e.clipUri);

  return (
    <View style={npSt.container}>
      {/* Header */}
      <View style={npSt.header}>
        <Text style={npSt.date}>{formatDate(session.date)}</Text>
        <View style={[npSt.srcBadge, { borderColor: session.dataSource === 'watch' ? Colors.info : Colors.textMuted }]}>
          <Text style={[npSt.srcText, { color: session.dataSource === 'watch' ? Colors.info : Colors.textMuted }]}>
            {session.dataSource === 'watch' ? 'WATCH' : 'PHONE'}
          </Text>
        </View>
      </View>

      {/* Coco grade */}
      <View style={[npSt.gradeCard, { borderColor: cocoInfo.color }]}>
        <DiagonalStripes color={cocoInfo.color} opacity={0.05} />
        <View style={npSt.gradeInner}>
          {cocoInfo.image && <Image source={cocoInfo.image} style={npSt.gradeImg} resizeMode="contain" />}
          <View style={{ flex: 1 }}>
            <Text style={[npSt.gradeLabel, { color: cocoInfo.color }]}>{cocoInfo.label} COCO</Text>
            <Text style={npSt.gradeSub}>RECOVERY GRADE</Text>
          </View>
          <Text style={[npSt.gradeScore, { color }]}>{score}</Text>
        </View>
      </View>

      {/* Score bar */}
      <View style={npSt.scoreBarTrack}>
        <View style={[npSt.scoreBarFill, { width: `${score}%` as any, backgroundColor: color }]} />
      </View>

      {/* Stats grid */}
      <View style={npSt.statsGrid}>
        {[
          { label: 'DURATION',    value: `${durationHours.toFixed(1)}h` },
          { label: 'EFFICIENCY',  value: `${scores.sleepEfficiency}%` },
          { label: 'HRV PROXY',   value: `${Math.round(recovery.hrvProxy)}` },
          { label: 'WENT TO BED', value: formatClockTime(startedAt) },
          { label: 'WOKE UP',     value: formatClockTime(endedAt) },
          { label: session.watchHeartRate ? 'AVG HR' : 'DISRUPTIONS',
            value: session.watchHeartRate ? `${session.watchHeartRate}` : `${scores.disruptionCount ?? 0}` },
        ].map((s) => (
          <View key={s.label} style={npSt.stat}>
            <Text style={npSt.statNum}>{s.value}</Text>
            <Text style={npSt.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Insights toggle */}
      <TouchableOpacity style={npSt.seeMoreBtn} onPress={() => setShowInsights((v) => !v)} activeOpacity={0.7}>
        <Text style={npSt.seeMoreText}>{showInsights ? 'HIDE INSIGHTS ↑' : 'SEE MORE ↓'}</Text>
      </TouchableOpacity>

      {showInsights && recovery.insights.map((insight) => {
        const locked = insight.isPremium && !isPremium;
        return (
          <View key={insight.id} style={[npSt.insightOuter, { borderLeftColor: locked ? Colors.textMuted : severityColor[insight.severity] }]}>
            <View style={[npSt.insightInner, locked && { opacity: 0.7 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={[npSt.insightTitle, locked && { color: Colors.textMuted }]}>{insight.title}</Text>
                {insight.isPremium && (
                  <View style={[npSt.proBadge, { backgroundColor: isPremium ? Colors.gold : Colors.border }]}>
                    <Text style={{ fontSize: 8, fontWeight: '900', color: isPremium ? Colors.bgDeep : Colors.textMuted }}>PRO</Text>
                  </View>
                )}
              </View>
              {locked ? (
                <TouchableOpacity onPress={() => router.push('/paywall')}>
                  <Text style={{ fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.gold }}>UNLOCK WITH COCO PRO →</Text>
                </TouchableOpacity>
              ) : (
                <Text style={npSt.insightBody}>{insight.body}</Text>
              )}
            </View>
          </View>
        );
      })}

      {/* Stage timeline */}
      <Text style={npSt.sectionEyebrow}>// SLEEP STAGES</Text>
      {chartEvents.length > 0 ? (
        <>
          <StageTimeline events={chartEvents} audioEvents={audioEvents} />
          <MovementGraph events={chartEvents} />
        </>
      ) : (
        <View style={npSt.emptyBlock}><Text style={npSt.emptyText}>No stage data</Text></View>
      )}

      {/* Sleep sounds — ALWAYS shown */}
      <Text style={npSt.sectionEyebrow}>// SLEEP SOUNDS</Text>
      <View style={npSt.soundsCard}>
        {nonQuiet.length === 0 ? (
          <Text style={npSt.soundsEmpty}>No sounds detected this night</Text>
        ) : (
          <View style={npSt.soundsRow}>
            {(['snoring', 'talking', 'loud_event'] as AudioEvent['type'][]).map((t) =>
              soundCounts[t] > 0 ? (
                <View key={t} style={npSt.soundChip}>
                  <Text style={npSt.soundChipIcon}>{audioTypeIcon(t)}</Text>
                  <Text style={npSt.soundChipLabel}>{audioTypeLabel(t)}</Text>
                  <Text style={npSt.soundChipCount}>{soundCounts[t]}×</Text>
                </View>
              ) : null
            )}
          </View>
        )}
      </View>

      {/* Recorded clips with live playback */}
      {clips.length > 0 && (
        <>
          <Text style={npSt.sectionEyebrow}>// RECORDED CLIPS</Text>
          {clips.map((e, i) => <ClipRow key={i} event={e} />)}
        </>
      )}

      <View style={{ height: 24 }} />
    </View>
  );
}

const npSt = StyleSheet.create({
  container: { marginTop: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  date: { fontSize: 16, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 1 },
  srcBadge: { borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 4 },
  srcText: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  gradeCard: { borderWidth: 2, borderLeftWidth: 5, marginBottom: 8, backgroundColor: Colors.bgCard, overflow: 'hidden' },
  gradeInner: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  gradeImg: { width: 60, height: 60 },
  gradeLabel: { fontSize: 18, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  gradeSub: { fontSize: 8, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 3 },
  gradeScore: { fontSize: 42, fontWeight: '900', fontStyle: 'italic' },
  scoreBarTrack: { height: 4, backgroundColor: Colors.border, marginBottom: 12, overflow: 'hidden' },
  scoreBarFill: { height: '100%' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14, gap: 1, backgroundColor: Colors.border },
  stat: { width: '33.33%', backgroundColor: Colors.bgCard, padding: 12, alignItems: 'center' },
  statNum: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  statLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted, marginTop: 3 },
  seeMoreBtn: { borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, alignItems: 'center', marginBottom: 14, borderLeftWidth: 3, borderLeftColor: Colors.red },
  seeMoreText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary },
  insightOuter: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, marginBottom: 10 },
  insightInner: { padding: 14 },
  insightTitle: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, flex: 1 },
  proBadge: { paddingHorizontal: 6, paddingVertical: 2 },
  insightBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  sectionEyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textMuted, marginTop: 20, marginBottom: 10 },
  emptyBlock: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, padding: 18, alignItems: 'center', marginBottom: 10 },
  emptyText: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  soundsCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: '#A855F7', padding: 12, marginBottom: 10 },
  soundsEmpty: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  soundsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  soundChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 8, paddingVertical: 5 },
  soundChipIcon: { fontSize: 12 },
  soundChipLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.textSecondary },
  soundChipCount: { fontSize: 9, fontWeight: '900', color: Colors.textMuted },
});

// ─── Clip Row ─────────────────────────────────────────────────────────────────

function ClipRow({ event }: { event: AudioEvent }) {
  const player  = useAudioPlayer(event.clipUri ? { uri: event.clipUri } : null as any);
  const [playing, setPlaying] = useState(false);

  const typeColor =
    event.type === 'snoring'    ? Colors.gold :
    event.type === 'talking'    ? Colors.info :
    event.type === 'loud_event' ? Colors.red  : Colors.textMuted;

  function toggle() {
    if (!event.clipUri) return;
    if (playing) { player.pause(); setPlaying(false); }
    else { player.seekTo(0); player.play(); setPlaying(true); }
  }

  return (
    <View style={clipSt.row}>
      <Text style={clipSt.icon}>{audioTypeIcon(event.type)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[clipSt.type, { color: typeColor }]}>{audioTypeLabel(event.type)}</Text>
        <Text style={clipSt.time}>{formatClockTime(event.timestamp)}</Text>
      </View>
      {event.clipUri && (
        <TouchableOpacity onPress={toggle} style={[clipSt.playBtn, playing && { borderColor: typeColor }]}>
          <Text style={[clipSt.playText, { color: typeColor }]}>{playing ? '■' : '▶'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const clipSt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.info, padding: 12, marginBottom: 6 },
  icon: { fontSize: 18 },
  type: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  time: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  playBtn: { borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 6 },
  playText: { fontSize: 11, fontWeight: '900' },
});

// ─── Sound Clip Row (playable, saveable) ──────────────────────────────────────

function SoundClipRow({ clip, onToggleSave, onDelete }: {
  clip: SoundClip;
  onToggleSave: () => void;
  onDelete: () => void;
}) {
  const player = useAudioPlayer({ uri: clip.filePath });
  const [playing, setPlaying] = useState(false);

  const typeColor =
    clip.type === 'snoring'    ? Colors.gold  :
    clip.type === 'talking'    ? Colors.info  : Colors.red;

  function toggle() {
    if (playing) { player.pause(); setPlaying(false); }
    else         { player.seekTo(0); player.play(); setPlaying(true); }
  }

  return (
    <View style={scRowSt.row}>
      <Text style={scRowSt.icon}>{audioTypeIcon(clip.type)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[scRowSt.type, { color: typeColor }]}>
          {clip.label ?? audioTypeLabel(clip.type)}
        </Text>
        <Text style={scRowSt.meta}>
          {formatClockTime(clip.timestamp)} · {Math.round(clip.durationSeconds)}s
        </Text>
      </View>
      <View style={scRowSt.actions}>
        <TouchableOpacity onPress={toggle}
          style={[scRowSt.playBtn, playing && { borderColor: typeColor }]}>
          <Text style={[scRowSt.playText, { color: typeColor }]}>{playing ? '■' : '▶'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onToggleSave} style={scRowSt.starBtn}>
          <Text style={{ fontSize: 14, color: clip.saved ? Colors.gold : Colors.textMuted }}>
            {clip.saved ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
        {!clip.saved && (
          <TouchableOpacity onPress={onDelete} style={scRowSt.deleteBtn}>
            <Text style={{ fontSize: 12, color: Colors.textMuted }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const scRowSt = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: '#A855F7', padding: 12, marginBottom: 6,
  },
  icon: { fontSize: 18 },
  type: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  meta: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  playBtn: { borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 5 },
  playText: { fontSize: 11, fontWeight: '900' },
  starBtn: { padding: 4 },
  deleteBtn: { padding: 4 },
});

// ─── Night Sounds Section ─────────────────────────────────────────────────────

function NightSoundsSection() {
  const { clips, deleteOldUnsaved, saveClip, unsaveClip, deleteClip } = useSoundClipsStore();

  useEffect(() => { void deleteOldUnsaved(); }, []);

  // Unique session dates, newest first
  const dates = [...new Set(clips.map((c) => c.sessionDate))]
    .sort().reverse().slice(0, 7);

  const defaultDate = dates[0] ?? new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(defaultDate);

  const dayClips = clips
    .filter((c) => c.sessionDate === selectedDate)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (clips.length === 0) {
    return (
      <View style={nsSt.emptyCard}>
        <Text style={nsSt.emptyIcon}>🎙</Text>
        <Text style={nsSt.emptyTitle}>No overnight recordings yet.</Text>
        <Text style={nsSt.emptySub}>
          Sleep with mic access enabled — Coco listens for snoring, talking, and sound events and saves short clips for review.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 28 }}>
      {/* Date selector chips */}
      {dates.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          {dates.map((d) => {
            const active  = d === selectedDate;
            const count   = clips.filter((c) => c.sessionDate === d).length;
            const dt      = new Date(d);
            return (
              <TouchableOpacity key={d}
                style={[nsSt.chip, active && nsSt.chipActive]}
                onPress={() => setSelectedDate(d)} activeOpacity={0.75}>
                <Text style={[nsSt.chipDate, active && { color: Colors.textPrimary }]}>
                  {DAY_NAMES[dt.getDay()]} {dt.getDate()}
                </Text>
                <Text style={[nsSt.chipCount, active && { color: '#A855F7' }]}>{count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {dayClips.length === 0 ? (
        <View style={nsSt.noClipsCard}>
          <Text style={nsSt.noClipsText}>No sound events recorded this night.</Text>
        </View>
      ) : (
        <>
          <Text style={nsSt.countRow}>
            {dayClips.length} clip{dayClips.length !== 1 ? 's' : ''} recorded
            {dayClips.some((c) => c.saved) ? ` · ${dayClips.filter((c) => c.saved).length} saved` : ''}
          </Text>
          {dayClips.map((clip) => (
            <SoundClipRow
              key={clip.id}
              clip={clip}
              onToggleSave={() => clip.saved ? unsaveClip(clip.id) : saveClip(clip.id)}
              onDelete={() => void deleteClip(clip.id)}
            />
          ))}
        </>
      )}
    </View>
  );
}

const nsSt = StyleSheet.create({
  emptyCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: '#A855F7',
    padding: 20, alignItems: 'center', marginBottom: 24,
  },
  emptyIcon:  { fontSize: 28, marginBottom: 8 },
  emptyTitle: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 6 },
  emptySub:   { fontSize: 11, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 },
  chip: {
    alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, minWidth: 60,
  },
  chipActive: { borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.08)' },
  chipDate:   { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted },
  chipCount:  { fontSize: 13, fontWeight: '900', marginTop: 2, color: Colors.textMuted },
  noClipsCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, padding: 14,
  },
  noClipsText: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  countRow: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, marginBottom: 10 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const { history } = useRecoveryStore();
  const { isPremium } = usePurchaseStore();

  if (history.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>// NIGHT SOUNDS</Text>
        <NightSoundsSection />
        <View style={styles.emptyFull}>
          <Text style={styles.emptyTitle}>NO SLEEP DATA.</Text>
          <View style={styles.emptyBar} />
          <Text style={styles.emptySub}>Complete a sleep session to see your stats.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>// NIGHT SOUNDS</Text>
      <NightSoundsSection />

      <Text style={styles.sectionLabel}>// SLEEP STATS</Text>
      <AveragesSection history={history} />

      <NightHistoryBrowser history={history} isPremium={isPremium} />

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  header: { marginBottom: 24 },
  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 4 },
  title: { fontSize: 52, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 54 },
  titleUnderline: { height: 3, width: 60, backgroundColor: Colors.red, marginTop: 6, marginBottom: 4 },
  emptyFull: { backgroundColor: Colors.bgDeep, alignItems: 'center', justifyContent: 'center', padding: 40, paddingTop: 20 },
  emptyTitle: { fontSize: 28, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 8 },
  emptyBar: { height: 3, width: 40, backgroundColor: Colors.red, marginBottom: 16 },
  emptySub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 14 },
});
