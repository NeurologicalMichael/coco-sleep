/**
 * SleepSoundsPlayer
 *
 * Ambient audio player powered by expo-audio.
 * - Plays when screen is locked (background audio mode)
 * - Shows lock screen / Control Center controls like Spotify
 * - Loops all tracks automatically
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

export const SOUNDS = [
  {
    id: 'white',  label: 'White Noise', sub: 'Noise',   emoji: '〰',
    bg: '#1e1e2e', accent: '#7070ef',
    src: require('../assets/sounds/whitenoise.mp3'),
  },
  {
    id: 'brown',  label: 'Brown Noise', sub: 'Noise',   emoji: '☁',
    bg: '#2a1a14', accent: '#b06840',
    src: require('../assets/sounds/brownnoise.mp3'),
  },
  {
    id: 'pink',   label: 'Pink Noise',  sub: 'Noise',   emoji: '◈',
    bg: '#2a1428', accent: '#d060c0',
    src: require('../assets/sounds/pinknoise.mp3'),
  },
  {
    id: 'rain',   label: 'Rain',        sub: 'Nature',  emoji: '🌧',
    bg: '#0e2233', accent: '#4090d0',
    src: require('../assets/sounds/rain.mp3'),
  },
  {
    id: 'ocean',  label: 'Ocean',       sub: 'Nature',  emoji: '🌊',
    bg: '#0a1428', accent: '#2060b0',
    src: require('../assets/sounds/ocean.mp3'),
  },
  {
    id: 'forest', label: 'Forest',      sub: 'Nature',  emoji: '🌲',
    bg: '#0e2214', accent: '#3a9a50',
    src: require('../assets/sounds/forest.mp3'),
  },
  {
    id: 'fire',   label: 'Fireplace',   sub: 'Ambient', emoji: '🔥',
    bg: '#2a140a', accent: '#d06020',
    src: require('../assets/sounds/fire.mp3'),
  },
  {
    id: 'fan',    label: 'Fan',         sub: 'Ambient', emoji: '💨',
    bg: '#141a24', accent: '#507080',
    src: require('../assets/sounds/fan.mp3'),
  },
] as const;

export type SoundId = (typeof SOUNDS)[number]['id'];

// ─── Audio mode (set once globally) ──────────────────────────────────────────

let audioModeReady = false;
async function ensureAudioMode() {
  if (audioModeReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    audioModeReady = true;
  } catch { /* no-op */ }
}

// ─── Shared hook ─────────────────────────────────────────────────────────────

export function useSleepAudio() {
  const [activeId, setActiveId] = useState<SoundId | null>(null);
  const [volume, setVol] = useState(0.6);
  const player = useAudioPlayer(null);

  useEffect(() => {
    void ensureAudioMode();
  }, []);

  function play(id: SoundId) {
    const sound = SOUNDS.find((s) => s.id === id)!;
    if (activeId === id) {
      player.pause();
      player.clearLockScreenControls();
      setActiveId(null);
      return;
    }
    player.replace(sound.src);
    player.loop   = true;
    player.volume = volume;
    player.play();
    player.setActiveForLockScreen(true, {
      title:      sound.label,
      artist:     'Coco Sleep',
      albumTitle: 'Sleep Sounds',
    });
    setActiveId(id);
  }

  function stop() {
    player.pause();
    player.clearLockScreenControls();
    setActiveId(null);
  }

  function setVolume(vol: number) {
    setVol(vol);
    player.volume = vol;
  }

  return { activeId, volume, play, stop, setVolume };
}

// ─── Compact embedded player (used inside other screens) ─────────────────────

const VOL_STEPS = [0.2, 0.4, 0.6, 0.8, 1.0];

export function SleepSoundsPlayer() {
  const { activeId, volume, play, setVolume } = useSleepAudio();

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>// SLEEP SOUNDS</Text>
      <Text style={styles.sub}>Looped ambient audio · plays with screen off</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {SOUNDS.map((s) => {
          const active = activeId === s.id;
          return (
            <TouchableOpacity
              key={s.id}
              style={[styles.btn, active && { borderColor: s.accent, backgroundColor: s.bg }]}
              onPress={() => play(s.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.emoji}>{s.emoji}</Text>
              <Text style={[styles.label, active && { color: '#fff' }]}>{s.label}</Text>
              {active && <View style={[styles.dot, { backgroundColor: s.accent }]} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {activeId && (
        <View style={styles.volRow}>
          <Ionicons name="volume-low" size={12} color={Colors.textMuted} />
          {VOL_STEPS.map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.volStep, volume >= v - 0.01 && styles.volActive]}
              onPress={() => setVolume(v)}
            />
          ))}
          <Ionicons name="volume-high" size={12} color={Colors.textMuted} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    borderLeftColor: Colors.info,
    padding: 16,
    marginBottom: 12,
  },
  heading: {
    fontSize: 10, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 2, color: Colors.info, marginBottom: 4,
  },
  sub: { fontSize: 11, color: Colors.textMuted, marginBottom: 14 },
  row: { gap: 8 },
  btn: {
    alignItems: 'center',
    backgroundColor: Colors.bgDeep,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 72,
    borderRadius: 8,
    position: 'relative',
  },
  emoji: { fontSize: 18, marginBottom: 5 },
  label: {
    fontSize: 8, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1, color: Colors.textMuted,
  },
  dot: {
    position: 'absolute', top: 5, right: 5,
    width: 6, height: 6, borderRadius: 3,
  },
  volRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 14, gap: 5,
  },
  volStep: { flex: 1, height: 3, backgroundColor: Colors.border, borderRadius: 2 },
  volActive: { backgroundColor: Colors.info },
});
