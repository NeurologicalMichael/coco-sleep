/**
 * WorkoutLogger
 *
 * Inline widget for logging today's workout.
 * Collapsed: shows today's workout or a "LOG WORKOUT" prompt.
 * Expanded: type picker + duration stepper + intensity slider.
 */

import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { DiagonalStripes } from './DiagonalStripes';
import { useWorkoutStore, WorkoutType } from '../store/workoutStore';

const TYPES: { id: WorkoutType; label: string; emoji: string }[] = [
  { id: 'strength', label: 'STRENGTH', emoji: '🏋️' },
  { id: 'cardio',   label: 'CARDIO',   emoji: '🏃' },
  { id: 'hiit',     label: 'HIIT',     emoji: '⚡' },
  { id: 'rest',     label: 'REST',     emoji: '😴' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function WorkoutLogger() {
  const { logWorkout, getForDate, clearForDate } = useWorkoutStore();
  const today = todayStr();
  const existing = getForDate(today);

  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<WorkoutType>(existing?.type ?? 'strength');
  const [duration, setDuration] = useState(existing?.durationMinutes ?? 45);
  const [intensity, setIntensity] = useState(existing?.intensity ?? 7);

  function handleLog() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logWorkout(today, type, duration, intensity);
    setExpanded(false);
  }

  function handleClear() {
    clearForDate(today);
  }

  function changeIntensity(delta: number) {
    setIntensity((v) => Math.min(Math.max(v + delta, 1), 10));
  }

  function changeDuration(delta: number) {
    setDuration((v) => Math.min(Math.max(v + delta, 5), 300));
  }

  const intensityLabel =
    intensity <= 3 ? 'LIGHT' :
    intensity <= 6 ? 'MODERATE' :
    intensity <= 8 ? 'HARD' : 'MAX';

  const intensityColor =
    intensity <= 3 ? Colors.textSecondary :
    intensity <= 6 ? Colors.gold :
    intensity <= 8 ? Colors.warning : Colors.red;

  if (existing && !expanded) {
    // Collapsed — show logged workout summary
    const typeInfo = TYPES.find((t) => t.id === existing.type) ?? TYPES[0];
    return (
      <View style={styles.card}>
        <DiagonalStripes color={Colors.green} opacity={0.04} />
        <View style={styles.collapsedInner}>
          <View style={styles.collapsedLeft}>
            <Text style={styles.eyebrow}>// TODAY'S WORKOUT</Text>
            <Text style={styles.collapsedLabel}>
              {typeInfo.emoji}  {typeInfo.label} · {existing.durationMinutes}MIN · {existing.intensity}/10
            </Text>
            <Text style={styles.loadLabel}>LOAD: {existing.load}</Text>
          </View>
          <View style={styles.collapsedActions}>
            <TouchableOpacity onPress={() => setExpanded(true)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>EDIT</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <DiagonalStripes color={Colors.info} opacity={0.03} />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>// LOG TODAY'S WORKOUT</Text>
          <Text style={styles.headerSub}>Updates tonight's sleep target</Text>
        </View>
        {!expanded && (
          <TouchableOpacity onPress={() => setExpanded(true)} style={styles.expandBtn}>
            <Text style={styles.expandBtnText}>LOG +</Text>
          </TouchableOpacity>
        )}
      </View>

      {expanded && (
        <View style={styles.form}>
          {/* Type selector */}
          <Text style={styles.formLabel}>WORKOUT TYPE</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => setType(t.id)}
                style={[styles.typeBtn, type === t.id && styles.typeBtnActive]}
              >
                <Text style={styles.typeEmoji}>{t.emoji}</Text>
                <Text style={[styles.typeLabel, type === t.id && styles.typeLabelActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Duration stepper */}
          {type !== 'rest' && (
            <>
              <Text style={styles.formLabel}>DURATION</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity onPress={() => changeDuration(-5)} style={styles.stepBtn}>
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{duration} MIN</Text>
                <TouchableOpacity onPress={() => changeDuration(5)} style={styles.stepBtn}>
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>

              {/* Intensity stepper */}
              <Text style={styles.formLabel}>INTENSITY</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity onPress={() => changeIntensity(-1)} style={styles.stepBtn}>
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <View style={styles.intensityCenter}>
                  <Text style={[styles.intensityNum, { color: intensityColor }]}>
                    {intensity}/10
                  </Text>
                  <Text style={[styles.intensityLabel, { color: intensityColor }]}>
                    {intensityLabel}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => changeIntensity(1)} style={styles.stepBtn}>
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.formActions}>
            <TouchableOpacity onPress={handleLog} style={styles.logBtn}>
              <View style={styles.logBtnInner}>
                <Text style={styles.logBtnText}>
                  {type === 'rest' ? 'LOG REST DAY →' : 'LOG WORKOUT →'}
                </Text>
              </View>
            </TouchableOpacity>
            {existing && (
              <TouchableOpacity onPress={() => setExpanded(false)} style={styles.cancelFormBtn}>
                <Text style={styles.cancelFormText}>CANCEL</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    overflow: 'hidden',
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.info,
  },

  // Collapsed state
  collapsedInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 16,
    gap: 12,
  },
  collapsedLeft: { flex: 1 },
  collapsedLabel: {
    fontSize: 14, fontWeight: '800', fontStyle: 'italic',
    color: Colors.textPrimary, marginTop: 2,
  },
  loadLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1, marginTop: 3,
  },
  collapsedActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  editBtn: {
    borderWidth: 1, borderColor: Colors.textMuted,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  editBtnText: { fontSize: 10, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 1 },
  clearBtn: { padding: 6 },
  clearBtnText: { fontSize: 13, color: Colors.textMuted },

  // Header (collapsed/no workout)
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  headerSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  expandBtn: {
    borderWidth: 1, borderColor: Colors.info,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  expandBtnText: {
    fontSize: 11, fontWeight: '900', fontStyle: 'italic',
    color: Colors.info, letterSpacing: 1,
  },

  // Form
  form: { paddingHorizontal: 16, paddingBottom: 16 },
  formLabel: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, color: Colors.textMuted, marginBottom: 8, marginTop: 8,
  },

  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeBtn: {
    flex: 1, minWidth: 68, alignItems: 'center', paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  typeBtnActive: { borderColor: Colors.info, backgroundColor: Colors.info + '18' },
  typeEmoji: { fontSize: 16, lineHeight: 20 },
  typeLabel: {
    fontSize: 8, fontWeight: '900', fontStyle: 'italic',
    color: Colors.textMuted, marginTop: 3, letterSpacing: 1,
  },
  typeLabelActive: { color: Colors.info },

  stepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: Colors.border,
  },
  stepBtn: {
    paddingHorizontal: 20, paddingVertical: 12,
  },
  stepBtnText: { fontSize: 18, fontWeight: '300', color: Colors.textPrimary },
  stepValue: {
    fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary,
  },

  intensityCenter: { alignItems: 'center' },
  intensityNum: { fontSize: 18, fontWeight: '900', fontStyle: 'italic' },
  intensityLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, marginTop: 2 },

  formActions: { marginTop: 16, gap: 8 },
  logBtn: {},
  logBtnInner: {
    backgroundColor: Colors.red, paddingVertical: 13, alignItems: 'center',
  },
  logBtnText: {
    fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 1,
  },
  cancelFormBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelFormText: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', letterSpacing: 1 },

  eyebrow: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 3, color: Colors.red,
  },
});
