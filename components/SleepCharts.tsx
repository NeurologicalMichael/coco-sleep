/**
 * SleepCharts.tsx
 * Pure View-based sleep visualisations — no external charting library required.
 *
 * Exports:
 *   StageTimeline    — horizontal colour-coded sleep-stage bar + sound event markers
 *   MovementGraph    — per-epoch movement intensity bar chart
 *   StageBreakdown   — horizontal bar breakdown of time per stage
 */

import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { MovementEvent, AudioEvent } from '../utils/hrvProxy';
import { SleepStage } from '../utils/sleepScore';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_COLOR: Record<SleepStage, string> = {
  awake:      Colors.red,    // red    — awake
  dozing:     Colors.gold,   // gold   — N1 transitional
  rem:        '#7DD3FC',     // sky    — REM / dreaming (matches Apple Watch cyan)
  snoozing:   '#818CF8',     // indigo — N2 / Core
  slumbering: '#312E81',     // deep indigo — Deep / N3
};

const STAGE_LABEL: Record<SleepStage, string> = {
  awake:      'AWAKE',
  dozing:     'LIGHT',
  rem:        'REM',
  snoozing:   'CORE',
  slumbering: 'DEEP',
};

// Y-fraction from top: 0 = top (awake spikes), 1 = bottom (deep dips)
const STAGE_Y_FRAC: Record<SleepStage, number> = {
  awake:      0.00,
  dozing:     0.20,
  rem:        0.40,
  snoozing:   0.60,
  slumbering: 0.78,
};

const SOUND_COLOR: Record<string, string> = {
  snoring:    '#F97316',   // orange
  talking:    Colors.gold,
  loud_event: Colors.red,
};

const SOUND_LABEL: Record<string, string> = {
  snoring:    'SNORING',
  talking:    'TALKING',
  loud_event: 'LOUD',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(epochMs: number): string {
  const d = new Date(epochMs);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// ─── Stage Timeline ───────────────────────────────────────────────────────────

interface StageTimelineProps {
  events: MovementEvent[];
  audioEvents?: AudioEvent[];
}

const CHART_H = 90;

function fmtDur(epochCount: number): string {
  const totalMin = Math.round(epochCount * 0.5);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function StageTimeline({ events, audioEvents = [] }: StageTimelineProps) {
  if (events.length === 0) return null;

  const EPOCH_MS = 30_000;
  const startTs  = events[0].timestamp - EPOCH_MS;
  const endTs    = events[events.length - 1].timestamp;
  const totalMs  = Math.max(endTs - startTs, 1);

  const stageCounts: Record<SleepStage, number> = { awake: 0, dozing: 0, rem: 0, snoozing: 0, slumbering: 0 };
  for (const e of events) stageCounts[(e.stage ?? 'dozing') as SleepStage]++;

  const nonQuiet = audioEvents.filter((a) => a.type !== 'quiet');

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>// SLEEP STAGES</Text>

      {/* Hypnogram — bars grow upward from bottom; awake=full height, deep=short */}
      <View style={s.hypoContainer}>
        {/* Faint horizontal grid lines */}
        {[0.0, 0.4, 0.78].map((frac) => (
          <View
            key={frac}
            style={[s.hypoGridLine, { top: frac * CHART_H }]}
          />
        ))}

        {/* Stage bars */}
        <View style={s.hypoTrack}>
          {events.map((e, i) => {
            const stage  = (e.stage ?? 'dozing') as SleepStage;
            const yFrac  = STAGE_Y_FRAC[stage];
            const barH   = Math.round(CHART_H * (1 - yFrac));
            return (
              <View key={i} style={[s.hypoCol, { justifyContent: 'flex-end' }]}>
                <View style={{ height: barH, backgroundColor: STAGE_COLOR[stage] }} />
              </View>
            );
          })}
        </View>

        {/* Sound markers — dots floating above the chart at timestamp position */}
        {nonQuiet.map((a, i) => {
          const rel = Math.max(0, Math.min(((a.timestamp - startTs) / totalMs) * 100, 98));
          return (
            <View
              key={i}
              style={[
                s.soundPin,
                {
                  left: `${rel}%` as any,
                  backgroundColor: SOUND_COLOR[a.type] ?? Colors.textMuted,
                },
              ]}
            />
          );
        })}
      </View>

      {/* Time axis */}
      <View style={s.timeRow}>
        <Text style={s.timeLabel}>{fmtTime(startTs)}</Text>
        <Text style={s.timeLabel}>{fmtTime(startTs + totalMs * 0.5)}</Text>
        <Text style={s.timeLabel}>{fmtTime(endTs)}</Text>
      </View>

      {/* Stage legend — dot + name + duration */}
      <View style={s.hypoLegend}>
        {(['awake', 'dozing', 'rem', 'snoozing', 'slumbering'] as SleepStage[])
          .map((st) => (
            <View key={st} style={s.hypoLegendRow}>
              <View style={[s.hypoLegendDot, { backgroundColor: STAGE_COLOR[st] }]} />
              <Text style={s.hypoLegendName}>{STAGE_LABEL[st]}</Text>
              <Text style={s.hypoLegendDur}>{fmtDur(stageCounts[st])}</Text>
            </View>
          ))}
      </View>

      {/* Sound events */}
      {nonQuiet.length > 0 && (
        <View style={s.soundsRow}>
          <Text style={s.soundsLabel}>SOUNDS  </Text>
          {(['snoring', 'talking', 'loud_event'] as AudioEvent['type'][])
            .filter((t) => nonQuiet.some((a) => a.type === t))
            .map((t) => (
              <View key={t} style={s.soundChipSmall}>
                <View style={[s.soundChipDot, { backgroundColor: SOUND_COLOR[t] }]} />
                <Text style={s.soundChipTxt}>{SOUND_LABEL[t]}</Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

// ─── Movement Intensity Graph ─────────────────────────────────────────────────

// Three categorical intensity levels
const MOV_STILL  = '#2A3441';   // dark muted — no movement
const MOV_MED    = Colors.gold; // gold — moderate movement
const MOV_HEAVY  = Colors.red;  // red  — heavy movement

type MovLevel = 'still' | 'movement' | 'heavy';

const MOV_LABEL: Record<MovLevel, string> = {
  still:    'STILL',
  movement: 'MOVEMENT',
  heavy:    'HEAVY',
};

const MOV_COLOR: Record<MovLevel, string> = {
  still:    MOV_STILL,
  movement: MOV_MED,
  heavy:    MOV_HEAVY,
};

function movLevel(magnitude: number, scale: number): MovLevel {
  const ratio = magnitude / scale;
  if (ratio < 0.1)  return 'still';
  if (ratio < 0.5)  return 'movement';
  return 'heavy';
}

interface MovementGraphProps {
  events: MovementEvent[];
}

export function MovementGraph({ events }: MovementGraphProps) {
  if (events.length === 0) return null;

  const GRAPH_H = 72;
  const EPOCH_MS = 30_000;
  const startTs  = events[0].timestamp - EPOCH_MS;
  const endTs    = events[events.length - 1].timestamp;

  // Use 99th-percentile to avoid one spike dominating the scale
  const sorted = [...events.map((e) => e.magnitude)].sort((a, b) => a - b);
  const p99    = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0.01;
  const scale  = Math.max(p99, 0.01);

  // Count epochs per level for legend
  const levelCounts: Record<MovLevel, number> = { still: 0, movement: 0, heavy: 0 };
  for (const e of events) levelCounts[movLevel(e.magnitude, scale)]++;

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>// MOVEMENT INTENSITY</Text>

      {/* Bar chart */}
      <View style={[s.graphTrack, { height: GRAPH_H }]}>
        {events.map((e, i) => {
          const level  = movLevel(e.magnitude, scale);
          const height = Math.max(2, Math.round((Math.min(e.magnitude, scale) / scale) * GRAPH_H));
          return (
            <View
              key={i}
              style={[s.graphBar, { height, backgroundColor: MOV_COLOR[level] }]}
            />
          );
        })}
      </View>

      {/* Time axis */}
      <View style={s.timeRow}>
        <Text style={s.timeLabel}>{fmtTime(startTs)}</Text>
        <Text style={s.timeLabel}>{fmtTime(startTs + (endTs - startTs) * 0.5)}</Text>
        <Text style={s.timeLabel}>{fmtTime(endTs)}</Text>
      </View>

      {/* Legend */}
      <View style={s.hypoLegend}>
        {(['still', 'movement', 'heavy'] as MovLevel[]).map((lvl) => (
          <View key={lvl} style={s.hypoLegendRow}>
            <View style={[s.hypoLegendDot, { backgroundColor: MOV_COLOR[lvl] }]} />
            <Text style={s.hypoLegendName}>{MOV_LABEL[lvl]}</Text>
            <Text style={s.hypoLegendDur}>{fmtDur(levelCounts[lvl])}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Stage Breakdown ──────────────────────────────────────────────────────────

interface StageBreakdownProps {
  events: MovementEvent[];
}

export function StageBreakdown({ events }: StageBreakdownProps) {
  if (events.length === 0) return null;

  const counts: Record<SleepStage, number> = { awake: 0, dozing: 0, rem: 0, snoozing: 0, slumbering: 0 };
  for (const e of events) counts[(e.stage ?? 'dozing') as SleepStage]++;
  const total = events.length;

  const rows = (['awake', 'rem', 'snoozing', 'slumbering'] as SleepStage[])
    .map((st) => ({ st, epochs: counts[st], pct: counts[st] / Math.max(total, 1) }))
    .filter((r) => r.epochs > 0);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>// BREAKDOWN</Text>
      {rows.map(({ st, epochs, pct }) => (
        <View key={st} style={s.breakdownRow}>
          <View style={[s.breakdownDot, { backgroundColor: STAGE_COLOR[st] }]} />
          <Text style={s.breakdownLabel}>{STAGE_LABEL[st]}</Text>
          <View style={s.breakdownBarCol}>
            <View style={s.breakdownTrack}>
              <View style={[s.breakdownFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: STAGE_COLOR[st] }]} />
            </View>
          </View>
          <Text style={s.breakdownMins}>{fmtDur(epochs)}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.red,
    padding: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 3,
    color: Colors.red,
    marginBottom: 10,
  },

  // ── Hypnogram ────────────────────────────────────────────────────────────────
  hypoContainer: {
    height: CHART_H,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: Colors.bgDeep,
    marginBottom: 6,
  },
  hypoGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.border,
    opacity: 0.4,
  },
  hypoTrack: {
    flexDirection: 'row',
    height: CHART_H,
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
  },
  hypoCol: {
    flex: 1,
    overflow: 'hidden',
  },
  soundPin: {
    position: 'absolute',
    top: 2,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  hypoLegend: {
    marginTop: 6,
    gap: 5,
  },
  hypoLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hypoLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  hypoLegendName: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    width: 44,
  },
  hypoLegendDur: {
    fontSize: 11,
    fontWeight: '900',
    color: Colors.textPrimary,
    textAlign: 'right',
    flex: 1,
  },
  soundsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  soundsLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
    color: Colors.textMuted,
  },
  soundChipSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  soundChipDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  soundChipTxt: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: Colors.textSecondary,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  timeLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: Colors.textMuted,
  },

  // ── Movement graph ──────────────────────────────────────────────────────────
  graphTrack: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    backgroundColor: Colors.bgDeep,
    padding: 2,
  },
  graphBar: {
    flex: 1,
    minWidth: 1,
  },
  graphAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  graphAxisLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: Colors.textMuted,
  },

  // ── Stage breakdown ─────────────────────────────────────────────────────────
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  breakdownDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  breakdownLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    width: 44,
  },
  breakdownBarCol: {
    flex: 1,
  },
  breakdownTrack: {
    height: 6,
    backgroundColor: Colors.bgDeep,
  },
  breakdownFill: {
    height: 6,
  },
  breakdownMins: {
    fontSize: 11,
    fontWeight: '900',
    color: Colors.textPrimary,
    width: 48,
    textAlign: 'right',
  },
});
