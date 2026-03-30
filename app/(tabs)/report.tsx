import { useState } from 'react';
import { ScrollView, View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAudioPlayer } from 'expo-audio';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { useRecoveryStore } from '../../store/recoveryStore';
import { RecoveryInsight } from '../../utils/recoveryEngine';
import { AudioEvent } from '../../utils/hrvProxy';
import { generateEstimatedEvents } from '../../utils/sleepScore';
import { scoreToCocoLevel, COCO_LEVELS } from '../../constants/cocoLevels';
import { usePurchaseStore } from '../../store/purchaseStore';
import { StageTimeline, MovementGraph } from '../../components/SleepCharts';
import { audioTypeLabel, audioTypeIcon } from '../../utils/audioSampler';

const severityColor: Record<RecoveryInsight['severity'], string> = {
  good: Colors.green, neutral: Colors.info, warning: Colors.warning, critical: Colors.danger,
};

export default function ReportScreen() {
  const router = useRouter();
  const { latestSession } = useRecoveryStore();
  const { isPremium } = usePurchaseStore();
  const [showInsights, setShowInsights] = useState(false);

  if (!latestSession) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>NO REPORT YET.</Text>
        <View style={styles.emptyBar} />
        <Text style={styles.emptySub}>Complete a sleep session to see your recovery report.</Text>
      </View>
    );
  }

  const { recovery, scores, durationHours } = latestSession;
  const recovScoreColor = recovery.recoveryScore >= 75 ? Colors.green : recovery.recoveryScore >= 50 ? Colors.gold : Colors.red;
  const cocoLevel = scoreToCocoLevel(recovery.recoveryScore);
  const cocoInfo  = COCO_LEVELS[cocoLevel];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>// MORNING REPORT</Text>
        <Text style={styles.title}>RECOVERY</Text>
        <View style={styles.titleUnderline} />
      </View>

      {/* Coconut grade card */}
      <View style={[styles.cocoGradeCard, { borderColor: cocoInfo.color }]}>
        <DiagonalStripes color={cocoInfo.color} opacity={0.05} />
        <View style={styles.cocoGradeInner}>
          {cocoInfo.image && (
            <Image source={cocoInfo.image} style={styles.cocoImg} resizeMode="contain" />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.cocoGradeLabel, { color: cocoInfo.color }]}>{cocoInfo.label} COCO</Text>
            <Text style={styles.cocoGradeSub}>LAST NIGHT'S GRADE</Text>
          </View>
        </View>
      </View>

      {/* Score row */}
      <View style={styles.scoreRowOuter}>
        <DiagonalStripes />
        <View style={styles.scoreRowInner}>
          {[
            { label: 'SLEEP SCORE', value: recovery.recoveryScore, color: recovScoreColor },
            { label: 'HRV PROXY',   value: recovery.hrvProxy,      color: Colors.textPrimary },
          ].map((s, i) => (
            <View key={s.label} style={[styles.scoreBlock, i > 0 && styles.scoreBlockBorder]}>
              <Text style={styles.scoreLabel}>{s.label}</Text>
              <Text style={[styles.scoreNum, { color: s.color }]}>{s.value}</Text>
              <View style={[styles.scoreAccent, { backgroundColor: s.color }]} />
            </View>
          ))}
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        {[
          { label: 'SLEEP TIME', value: `${durationHours.toFixed(1)}h` },
          { label: 'CORTISOL', value: recovery.cortisolFlag ? 'HIGH' : 'OK' },
          latestSession.watchHeartRate
            ? { label: 'AVG HR', value: `${latestSession.watchHeartRate} bpm` }
            : { label: 'DISRUPTIONS', value: String(latestSession.scores.disruptionCount ?? 0) },
        ].map((s) => (
          <View key={s.label} style={styles.statBlock}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* SEE MORE — collapsible insights */}
      <TouchableOpacity style={styles.seeMoreBtn} onPress={() => setShowInsights((v) => !v)} activeOpacity={0.7}>
        <Text style={styles.seeMoreText}>{showInsights ? 'HIDE INSIGHTS ↑' : 'SEE MORE ↓'}</Text>
      </TouchableOpacity>

      {showInsights && recovery.insights.map((insight) => {
        const locked = insight.isPremium && !isPremium;
        return (
          <View key={insight.id} style={[styles.insightOuter, { borderLeftColor: locked ? Colors.textMuted : severityColor[insight.severity] }]}>
            <View style={[styles.insightInner, locked && styles.insightLocked]}>
              <View style={styles.insightHeader}>
                <Text style={[styles.insightTitle, locked && { color: Colors.textMuted }]}>{insight.title}</Text>
                {insight.isPremium && (
                  <View style={[styles.proBadge, { backgroundColor: isPremium ? Colors.gold : Colors.border }]}>
                    <Text style={[styles.proText, { color: isPremium ? Colors.bgDeep : Colors.textMuted }]}>PRO</Text>
                  </View>
                )}
              </View>
              {locked ? (
                <TouchableOpacity onPress={() => router.push('/paywall')}>
                  <View style={styles.lockRow}>
                    <Text style={styles.lockText}>UNLOCK WITH COCO PRO</Text>
                    <Text style={styles.lockArrow}>→</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <Text style={styles.insightBody}>{insight.body}</Text>
              )}
            </View>
          </View>
        );
      })}

      {/* ── Sleep Stage Charts ─────────────────────────────────────────────── */}
      {(() => {
        const endedAt   = new Date(latestSession.date).getTime();
        const startedAt = endedAt - latestSession.durationHours * 3_600_000;
        const chartEvents = (latestSession.movementEvents?.length ?? 0) > 0
          ? latestSession.movementEvents!
          : generateEstimatedEvents(startedAt, endedAt, null);
        if (chartEvents.length === 0) return null;
        return (
          <>
            <Text style={styles.sectionEyebrow}>// SLEEP STAGES</Text>
            <StageTimeline events={chartEvents} audioEvents={latestSession.audioEvents ?? []} />
            <MovementGraph events={chartEvents} />
          </>
        );
      })()}

      {/* ── Voice / Sound Tracking ─────────────────────────────────────────── */}
      {(() => {
        const events = latestSession.audioEvents ?? [];
        const nonQuiet = events.filter((e) => e.type !== 'quiet');
        if (nonQuiet.length === 0) return null;
        const counts = {} as Record<AudioEvent['type'], number>;
        for (const e of nonQuiet) counts[e.type] = (counts[e.type] ?? 0) + 1;
        const clips = nonQuiet.filter((e) => e.clipUri);
        return (
          <>
            <Text style={styles.sectionEyebrow}>// SLEEP SOUNDS</Text>
            <View style={styles.soundsCard}>
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
            </View>
            {clips.length > 0 && (
              <>
                <Text style={styles.sectionEyebrow}>// RECORDED CLIPS</Text>
                {clips.map((e, i) => <ClipRow key={i} event={e} />)}
              </>
            )}
          </>
        );
      })()}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  noDataCard: { padding: 20, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, marginBottom: 16 },
  noDataText: { fontSize: 13, fontWeight: '600', fontStyle: 'italic', color: Colors.textMuted, textAlign: 'center' },

  // Coco grade card
  cocoGradeCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderLeftWidth: 5,
    borderRadius: 0, marginBottom: 20, overflow: 'hidden',
    transform: [{ skewX: '-1.5deg' }],
  },
  cocoGradeInner: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    transform: [{ skewX: '1.5deg' }],
  },
  cocoImg: { width: 80, height: 80 },
  cocoGradeLabel: { fontSize: 20, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  cocoGradeSub: { fontSize: 9, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 4 },
  recBadge: { borderWidth: 1.5, borderRadius: 0, paddingHorizontal: 10, paddingVertical: 6 },
  recBadgeText: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5 },

  header: { marginBottom: 24 },
  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 4 },
  title: { fontSize: 52, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 54 },
  titleUnderline: { height: 3, width: 60, backgroundColor: Colors.red, marginTop: 6, marginBottom: 4 },

  scoreRowOuter: {
    backgroundColor: Colors.bgCard, borderRadius: 0,
    borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 5, borderLeftColor: Colors.red,
    marginBottom: 14, overflow: 'hidden',
    transform: [{ skewX: '-1.5deg' }],
  },
  scoreRowInner: { flexDirection: 'row', padding: 20, transform: [{ skewX: '1.5deg' }] },
  scoreBlock: { flex: 1, alignItems: 'center' },
  scoreBlockBorder: { borderLeftWidth: 1, borderLeftColor: Colors.border },
  scoreLabel: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.textMuted, marginBottom: 6 },
  scoreNum: { fontSize: 38, fontWeight: '900', fontStyle: 'italic' },
  scoreAccent: { height: 2, width: 28, marginTop: 6 },

  recOuter: {
    borderRadius: 0, borderWidth: 1.5,
    borderLeftWidth: 5, marginBottom: 16,
    backgroundColor: Colors.bgCard, overflow: 'hidden',
    transform: [{ skewX: '-1.5deg' }],
  },
  recInner: { padding: 18, transform: [{ skewX: '1.5deg' }] },
  recLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, marginBottom: 4 },
  recValue: { fontSize: 24, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },

  sourceBadge: { borderWidth: 1.5, borderRadius: 0, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 16 },
  sourceBadgeText: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  statBlock: {
    flex: 1, backgroundColor: Colors.bgCard, borderRadius: 0, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.red,
  },
  statValue: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 4 },
  statLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted },

  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary, marginBottom: 12, textTransform: 'uppercase' },
  seeMoreBtn: {
    borderWidth: 1, borderColor: Colors.border, paddingVertical: 14, alignItems: 'center', marginBottom: 14,
    borderLeftWidth: 3, borderLeftColor: Colors.red,
  },
  seeMoreText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary },

  insightOuter: {
    backgroundColor: Colors.bgCard, borderRadius: 0, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, marginBottom: 10, overflow: 'hidden',
  },
  insightInner: { padding: 16 },
  insightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  insightTitle: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5, color: Colors.textPrimary, flex: 1 },
  proBadge: { backgroundColor: Colors.gold, borderRadius: 0, paddingHorizontal: 6, paddingVertical: 2 },
  proText: { fontSize: 8, fontWeight: '900', color: Colors.bgDeep },
  insightBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  insightLocked: { opacity: 0.7 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  lockText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.gold },
  lockArrow: { fontSize: 12, color: Colors.gold, fontWeight: '900' },

  sectionEyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textMuted, marginTop: 20, marginBottom: 10 },

  soundsCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: Colors.info, marginBottom: 12, padding: 12 },
  soundsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  soundChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 8, paddingVertical: 5 },
  soundChipIcon: { fontSize: 12 },
  soundChipLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.textSecondary },
  soundChipCount: { fontSize: 9, fontWeight: '900', color: Colors.textMuted },

  clipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.info, padding: 12, marginBottom: 6 },
  clipIcon: { fontSize: 18 },
  clipType: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  clipTime: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  clipPlayBtn: { borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 6 },
  clipPlayText: { fontSize: 11, fontWeight: '900' },

  empty: { flex: 1, backgroundColor: Colors.bgDeep, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji: { fontSize: 60, marginBottom: 20 },
  emptyTitle: { fontSize: 28, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 8 },
  emptyBar: { height: 3, width: 40, backgroundColor: Colors.red, marginBottom: 16 },
  emptySub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
});

// ─── Clip playback row ────────────────────────────────────────────────────────

function ClipRow({ event }: { event: AudioEvent }) {
  const player = useAudioPlayer(event.clipUri ? { uri: event.clipUri } : null as any);
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

  function formatClockTime(ts: number) {
    const d = new Date(ts);
    const h = d.getHours(), m = d.getMinutes();
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }

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
