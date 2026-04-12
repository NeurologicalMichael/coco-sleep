import { useState } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Colors } from '../constants/colors';
import { useSoundClipsStore, SoundClip } from '../store/soundClipsStore';
import { audioTypeIcon } from '../utils/audioSampler';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatClockTime(ts: number) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ─── Single clip row ──────────────────────────────────────────────────────────

function SavedClipRow({ clip, onRename }: { clip: SoundClip; onRename: (id: string, name: string) => void }) {
  const player = useAudioPlayer({ uri: clip.filePath });
  const status = useAudioPlayerStatus(player);
  const [showRename, setShowRename] = useState(false);
  const [draftName, setDraftName] = useState(clip.label ?? '');

  const typeColor =
    clip.type === 'snoring'    ? Colors.gold :
    clip.type === 'talking'    ? Colors.info : Colors.red;

  async function toggle() {
    if (status.playing) {
      player.pause();
    } else {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.seekTo(0);
      player.play();
    }
  }

  async function handleExport() {
    try {
      const info = await FileSystem.getInfoAsync(clip.filePath);
      if (!info.exists) { Alert.alert('File not found', 'This clip may have been deleted.'); return; }
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) { Alert.alert('Sharing not available on this device.'); return; }
      await Sharing.shareAsync(clip.filePath, {
        mimeType: 'audio/x-caf',
        dialogTitle: clip.label ?? `Sleep clip ${formatClockTime(clip.timestamp)}`,
        UTI: 'com.apple.coreaudio-format',
      });
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  }

  function confirmRename() {
    const trimmed = draftName.trim();
    if (trimmed) onRename(clip.id, trimmed);
    setShowRename(false);
  }

  return (
    <View style={st.row}>
      {/* Icon + info */}
      <Text style={st.icon}>{audioTypeIcon(clip.type)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[st.label, { color: typeColor }]} numberOfLines={1}>
          {clip.label ?? clip.type.replace('_', ' ').toUpperCase()}
        </Text>
        <Text style={st.meta}>
          {formatDate(clip.sessionDate)} · {formatClockTime(clip.timestamp)} · {Math.round(clip.durationSeconds)}s
        </Text>
      </View>

      {/* Actions */}
      <View style={st.actions}>
        {/* Play / pause */}
        <TouchableOpacity onPress={() => void toggle()} style={[st.iconBtn, status.playing && { borderColor: typeColor }]}>
          <Text style={[st.iconBtnText, { color: typeColor }]}>{status.playing ? '■' : '▶'}</Text>
        </TouchableOpacity>

        {/* Rename */}
        <TouchableOpacity onPress={() => { setDraftName(clip.label ?? ''); setShowRename(true); }} style={st.iconBtn}>
          <Text style={st.iconBtnText}>✎</Text>
        </TouchableOpacity>

        {/* Export / share */}
        <TouchableOpacity onPress={() => void handleExport()} style={st.iconBtn}>
          <Text style={st.iconBtnText}>↑</Text>
        </TouchableOpacity>
      </View>

      {/* Rename modal */}
      <Modal visible={showRename} transparent animationType="fade">
        <View style={st.modalOverlay}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>RENAME CLIP</Text>
            <TextInput
              style={st.modalInput}
              value={draftName}
              onChangeText={(v: string) => setDraftName(v)}
              placeholder="Enter name..."
              placeholderTextColor={Colors.textMuted}
              autoFocus
              onSubmitEditing={confirmRename}
            />
            <View style={st.modalBtns}>
              <TouchableOpacity style={[st.modalBtn, st.modalBtnCancel]} onPress={() => setShowRename(false)}>
                <Text style={st.modalBtnCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.modalBtn, st.modalBtnSave]} onPress={confirmRename}>
                <Text style={st.modalBtnSaveText}>SAVE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavedSoundsScreen() {
  const router = useRouter();
  const { clips, renameClip } = useSoundClipsStore();
  const saved = clips.filter((c) => c.saved).sort((a, b) => b.timestamp - a.timestamp);

  return (
    <ScrollView style={sc.container} contentContainerStyle={sc.content}>
      {/* Header */}
      <View style={sc.header}>
        <TouchableOpacity onPress={() => router.back()} style={sc.backBtn}>
          <Text style={sc.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={sc.eyebrow}>// SAVED SOUNDS</Text>
        <Text style={sc.title}>STARRED{'\n'}CLIPS</Text>
        <View style={sc.titleUnderline} />
      </View>

      {saved.length === 0 ? (
        <View style={sc.empty}>
          <Text style={sc.emptyIcon}>🎙</Text>
          <Text style={sc.emptyTitle}>No saved clips yet.</Text>
          <Text style={sc.emptySub}>
            Star clips in the Log tab to save them here permanently.
          </Text>
        </View>
      ) : (
        <>
          <Text style={sc.count}>{saved.length} saved clip{saved.length !== 1 ? 's' : ''}</Text>
          {saved.map((clip) => (
            <SavedClipRow
              key={clip.id}
              clip={clip}
              onRename={(id, name) => renameClip(id, name)}
            />
          ))}
        </>
      )}

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.gold,
    padding: 12, marginBottom: 8,
  },
  icon:    { fontSize: 20 },
  label:   { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  meta:    { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  iconBtn: { borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 9, paddingVertical: 6 },
  iconBtnText: { fontSize: 13, fontWeight: '900', color: Colors.textSecondary },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard:    { backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.gold, width: '100%', padding: 20 },
  modalTitle:   { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.gold, marginBottom: 14 },
  modalInput: {
    backgroundColor: Colors.bgDeep, borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14, fontWeight: '900',
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  modalBtns:          { flexDirection: 'row', gap: 10 },
  modalBtn:           { flex: 1, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  modalBtnCancel:     { borderColor: Colors.border },
  modalBtnCancelText: { fontSize: 10, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  modalBtnSave:       { borderColor: Colors.gold, backgroundColor: Colors.gold },
  modalBtnSaveText:   { fontSize: 10, fontWeight: '900', letterSpacing: 2, color: '#000' },
});

const sc = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content:   { padding: 24, paddingTop: 60, paddingBottom: 48 },
  header:    { marginBottom: 28 },
  backBtn:   { marginBottom: 20 },
  backText:  { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textMuted },
  eyebrow:   { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.gold, marginBottom: 4 },
  title:     { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 50 },
  titleUnderline: { height: 3, width: 60, backgroundColor: Colors.gold, marginTop: 8 },
  count:     { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, marginBottom: 14 },
  empty:     { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle:{ fontSize: 16, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  emptySub:  { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
