import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { SOUNDS, useSleepAudio, SoundId } from '../../components/SleepSoundsPlayer';

const { width } = Dimensions.get('window');
const CARD_W = (width - 48 - 12) / 2; // 2-col grid, 24px pad each side, 12px gap

type Category = 'all' | 'noise' | 'nature' | 'ambient';

const CATS: { id: Category; label: string }[] = [
  { id: 'all',     label: 'All'     },
  { id: 'nature',  label: 'Nature'  },
  { id: 'noise',   label: 'Noise'   },
  { id: 'ambient', label: 'Ambient' },
];

const VOL_STEPS = [0.2, 0.4, 0.6, 0.8, 1.0];

export default function MusicScreen() {
  const { activeId, volume, play, stop, setVolume } = useSleepAudio();
  const [cat, setCat] = useState<Category>('all');

  const activeSound = SOUNDS.find((s) => s.id === activeId);
  const filtered = cat === 'all'
    ? SOUNDS
    : SOUNDS.filter((s) => s.sub.toLowerCase() === cat);

  // Pair up into rows for 2-col grid
  const rows: (typeof SOUNDS[number] | null)[][] = [];
  for (let i = 0; i < filtered.length; i += 2) {
    rows.push([filtered[i], filtered[i + 1] ?? null]);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>// WIND DOWN</Text>
            <Text style={styles.title}>MUSIC</Text>
            <View style={styles.bar} />
          </View>
          {activeSound && (
            <TouchableOpacity style={styles.stopBtn} onPress={stop} activeOpacity={0.7}>
              <Ionicons name="stop-circle" size={28} color={Colors.red} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Hero banner ── */}
        <View style={styles.hero}>
          <View style={styles.heroBg} />
          <View style={styles.heroContent}>
            <Text style={styles.heroTag}>SLEEP SOUNDS</Text>
            <Text style={styles.heroTitle}>Sleep better with{'\n'}ambient audio</Text>
            <Text style={styles.heroSub}>Plays in background · screen off · locked phone</Text>
          </View>
          <View style={styles.heroIconWrap}>
            <Text style={styles.heroIcon}>🎵</Text>
          </View>
        </View>

        {/* ── Category pills ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
        >
          {CATS.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.catPill, cat === c.id && styles.catPillActive]}
              onPress={() => setCat(c.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.catLabel, cat === c.id && styles.catLabelActive]}>
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Sound grid ── */}
        <View style={styles.grid}>
          {rows.map((row, ri) => (
            <View key={ri} style={styles.gridRow}>
              {row.map((sound, ci) =>
                sound ? (
                  <SoundCard
                    key={sound.id}
                    sound={sound}
                    active={activeId === sound.id}
                    onPress={() => play(sound.id as SoundId)}
                  />
                ) : (
                  <View key={`empty-${ci}`} style={{ width: CARD_W }} />
                )
              )}
            </View>
          ))}
        </View>

        {/* ── Spacer for mini player ── */}
        {activeSound && <View style={{ height: 90 }} />}
      </ScrollView>

      {/* ── Mini player (pinned bottom) ── */}
      {activeSound && (
        <View style={styles.miniPlayer}>
          <View style={[styles.miniAccent, { backgroundColor: activeSound.accent }]} />
          <View style={styles.miniLeft}>
            <Text style={styles.miniEmoji}>{activeSound.emoji}</Text>
            <View>
              <Text style={styles.miniName}>{activeSound.label}</Text>
              <Text style={styles.miniSub}>NOW PLAYING · SCREEN OFF SUPPORTED</Text>
            </View>
          </View>
          <View style={styles.miniRight}>
            {/* Volume bar */}
            <View style={styles.miniVolRow}>
              {VOL_STEPS.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.miniVolStep, volume >= v - 0.01 && { backgroundColor: activeSound.accent }]}
                  onPress={() => setVolume(v)}
                />
              ))}
            </View>
            <TouchableOpacity onPress={stop} activeOpacity={0.7}>
              <Ionicons name="stop-circle" size={32} color={activeSound.accent} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Sound Card ───────────────────────────────────────────────────────────────

function SoundCard({
  sound,
  active,
  onPress,
}: {
  sound: typeof SOUNDS[number];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: sound.bg, width: CARD_W }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Active border glow */}
      {active && (
        <View style={[StyleSheet.absoluteFill, styles.cardGlow, { borderColor: sound.accent }]} />
      )}

      {/* Category tag */}
      <View style={[styles.cardTag, { backgroundColor: sound.accent + '30' }]}>
        <Text style={[styles.cardTagText, { color: sound.accent }]}>{sound.sub.toUpperCase()}</Text>
      </View>

      {/* Emoji */}
      <Text style={styles.cardEmoji}>{sound.emoji}</Text>

      {/* Name */}
      <Text style={styles.cardName}>{sound.label}</Text>

      {/* Play / stop indicator */}
      <View style={[styles.cardPlayBtn, active && { backgroundColor: sound.accent }]}>
        <Ionicons
          name={active ? 'pause' : 'play'}
          size={14}
          color={active ? '#fff' : Colors.textMuted}
        />
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgDeep },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 24 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 24,
  },
  eyebrow: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 3, color: Colors.red, marginBottom: 4,
  },
  title: {
    fontSize: 52, fontWeight: '900', fontStyle: 'italic',
    color: Colors.textPrimary, lineHeight: 54,
  },
  bar: { height: 3, width: 60, backgroundColor: Colors.red, marginTop: 6 },
  stopBtn: { paddingTop: 14 },

  // Hero banner
  hero: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    height: 120,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1040',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
  },
  heroContent: { flex: 1, padding: 18 },
  heroTag: {
    fontSize: 8, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, color: Colors.red, marginBottom: 6,
  },
  heroTitle: {
    fontSize: 18, fontWeight: '900', fontStyle: 'italic',
    color: '#fff', lineHeight: 22,
  },
  heroSub: {
    fontSize: 9, color: 'rgba(255,255,255,0.4)',
    marginTop: 6, lineHeight: 13,
  },
  heroIconWrap: { paddingRight: 18 },
  heroIcon: { fontSize: 48 },

  // Category pills
  catRow: { gap: 8, marginBottom: 20, paddingVertical: 2 },
  catPill: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  catPillActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  catLabel: {
    fontSize: 11, fontWeight: '700',
    letterSpacing: 0.5, color: Colors.textMuted,
  },
  catLabelActive: { color: '#fff' },

  // Grid
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },

  // Sound card
  card: {
    height: 150,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  cardGlow: {
    borderRadius: 14,
    borderWidth: 2,
  },
  cardTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 6, marginBottom: 10,
  },
  cardTagText: { fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  cardEmoji: { fontSize: 32, marginBottom: 8 },
  cardName: {
    fontSize: 13, fontWeight: '900', fontStyle: 'italic',
    color: '#fff', letterSpacing: 0.3,
  },
  cardPlayBtn: {
    position: 'absolute', bottom: 12, right: 12,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Mini player
  miniPlayer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111118',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingBottom: 28,
    gap: 12,
  },
  miniAccent: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 2,
  },
  miniLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  miniEmoji: { fontSize: 28 },
  miniName: {
    fontSize: 13, fontWeight: '900', fontStyle: 'italic',
    color: '#fff',
  },
  miniSub: {
    fontSize: 7, fontWeight: '700', letterSpacing: 1,
    color: Colors.textMuted, marginTop: 2,
  },
  miniRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  miniVolRow: { flexDirection: 'row', gap: 3, alignItems: 'center', width: 60 },
  miniVolStep: {
    flex: 1, height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
  },
});
