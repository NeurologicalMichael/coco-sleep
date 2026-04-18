import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../constants/colors';
import { useFeedStore } from '../store/feedStore';
import { useRecoveryStore, ProcessedSession } from '../store/recoveryStore';
import { useAuthStore } from '../store/authStore';
import { useCocoStore } from '../store/cocoStore';
import { createPost, uploadFeedPhotos } from '../lib/feed';

// ── helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return Colors.green;
  if (score >= 60) return Colors.gold;
  return Colors.red;
}

function cocoEmoji(level: number): string {
  if (level >= 13) return '🌴';
  if (level >= 10) return '🥥';
  if (level >= 7)  return '🌲';
  if (level >= 4)  return '🌿';
  return '🌱';
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Session picker row ─────────────────────────────────────────────────────────

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ProcessedSession;
  selected: boolean;
  onSelect: () => void;
}) {
  const score = Math.round(session.scores.sleepScore);
  return (
    <TouchableOpacity
      style={[styles.sessionRow, selected && styles.sessionRowSelected]}
      onPress={onSelect}
      activeOpacity={0.75}
    >
      <View style={[styles.sessionScore, { borderColor: scoreColor(score) + '66' }]}>
        <Text style={[styles.sessionScoreText, { color: scoreColor(score) }]}>{score}</Text>
      </View>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionDate}>{session.date}</Text>
        <Text style={styles.sessionDur}>{formatDuration(session.durationHours)}</Text>
      </View>
      {selected && (
        <Ionicons name="checkmark-circle" size={22} color={Colors.red} />
      )}
    </TouchableOpacity>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function CreatePostScreen() {
  const router = useRouter();
  const { prependPost } = useFeedStore();
  const history = useRecoveryStore((s) => s.history);
  const latestSession = useRecoveryStore((s) => s.latestSession);
  const { userId, username, avatarUrl } = useAuthStore();
  const cocoLevel = useCocoStore((s) => s.cocoLevel);

  const sessions = latestSession
    ? [latestSession, ...history.filter((h) => h.id !== latestSession.id)]
    : history;

  const [selectedSession, setSelectedSession] = useState<ProcessedSession | null>(
    sessions[0] ?? null,
  );
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);

  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to attach photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhotos((prev) =>
        [...prev, ...result.assets.map((a) => a.uri)].slice(0, 4),
      );
    }
  }, []);

  const removePhoto = useCallback((uri: string) => {
    setPhotos((prev) => prev.filter((p) => p !== uri));
  }, []);

  const handlePost = useCallback(async () => {
    if (!selectedSession) {
      Alert.alert('Select a night', 'Choose a logged sleep session to post about.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Add a title', 'Give your post a title.');
      return;
    }
    if (!userId) {
      Alert.alert('Not signed in', 'Something went wrong. Please restart the app.');
      return;
    }

    setPosting(true);

    // 1. Upload photos to Supabase Storage (skip on error)
    let photoUrls: string[] = [];
    if (photos.length > 0) {
      photoUrls = await uploadFeedPhotos(userId, photos);
    }

    // 2. Save post to Supabase
    const newPost = await createPost({
      userId,
      sessionId: selectedSession.id,
      sessionDate: selectedSession.date,
      sleepScore: Math.round(selectedSession.scores.sleepScore),
      durationHours: selectedSession.durationHours,
      cocoLevel,
      title: title.trim(),
      caption: caption.trim(),
      photos: photoUrls,
    });

    setPosting(false);

    if (!newPost) {
      Alert.alert('Error', 'Could not create post. Check your connection and try again.');
      return;
    }

    // 3. Optimistically add to feed store with username + avatar
    prependPost({ ...newPost, username: username ?? 'You', avatar_url: avatarUrl ?? null });

    router.back();
  }, [selectedSession, title, caption, photos, userId, username, cocoLevel, prependPost, router]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="close" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Post</Text>
          <TouchableOpacity
            style={[
              styles.postBtn,
              (!selectedSession || !title.trim() || posting) && styles.postBtnDisabled,
            ]}
            onPress={handlePost}
            disabled={posting || !selectedSession || !title.trim()}
          >
            {posting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.postBtnText}>Post</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {/* Section: Pick night */}
          <Text style={styles.sectionLabel}>Choose a night</Text>

          {sessions.length === 0 ? (
            <View style={styles.noSessions}>
              <Text style={styles.noSessionsText}>
                No logged sleep sessions yet. Track a night first!
              </Text>
            </View>
          ) : (
            <View style={styles.sessionList}>
              {sessions.slice(0, 7).map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={selectedSession?.id === s.id}
                  onSelect={() => setSelectedSession(s)}
                />
              ))}
            </View>
          )}

          {/* Preview of selected stats */}
          {selectedSession && (
            <View style={styles.preview}>
              <Text style={styles.previewEmoji}>{cocoEmoji(cocoLevel)}</Text>
              <View style={styles.previewStats}>
                <Text
                  style={[
                    styles.previewScore,
                    { color: scoreColor(Math.round(selectedSession.scores.sleepScore)) },
                  ]}
                >
                  {Math.round(selectedSession.scores.sleepScore)}
                </Text>
                <Text style={styles.previewScoreLabel}> score</Text>
                <Text style={styles.previewSep}>·</Text>
                <Ionicons name="moon" size={13} color={Colors.info} />
                <Text style={[styles.previewScoreLabel, { color: Colors.info, marginLeft: 3 }]}>
                  {formatDuration(selectedSession.durationHours)}
                </Text>
                <Text style={styles.previewSep}>·</Text>
                <Text style={styles.previewScoreLabel}>Lv.{cocoLevel}</Text>
              </View>
            </View>
          )}

          {/* Title */}
          <Text style={styles.sectionLabel}>Title</Text>
          <TextInput
            style={styles.titleInput}
            placeholder="e.g. Best sleep in weeks 🔥"
            placeholderTextColor={Colors.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            returnKeyType="next"
          />

          {/* Caption */}
          <Text style={styles.sectionLabel}>
            Caption <Text style={styles.optional}>(optional)</Text>
          </Text>
          <TextInput
            style={styles.captionInput}
            placeholder="How did you feel? Any notes about the night..."
            placeholderTextColor={Colors.textMuted}
            value={caption}
            onChangeText={setCaption}
            maxLength={300}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* Photos */}
          <View style={styles.photosHeader}>
            <Text style={styles.sectionLabel}>
              Photos <Text style={styles.optional}>(optional)</Text>
            </Text>
            {photos.length < 4 && (
              <TouchableOpacity onPress={pickPhoto} style={styles.addPhotoBtn}>
                <Ionicons name="image-outline" size={16} color={Colors.red} />
                <Text style={styles.addPhotoBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
              {photos.map((uri) => (
                <View key={uri} style={styles.photoThumb}>
                  <Image source={{ uri }} style={styles.photoThumbImg} />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => removePhoto(uri)}
                  >
                    <Ionicons name="close-circle" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 58,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: {
    padding: 4,
    width: 60,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  postBtn: {
    backgroundColor: Colors.red,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
  },
  postBtnDisabled: {
    backgroundColor: Colors.red + '44',
  },
  postBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    padding: 20,
    gap: 8,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },
  optional: {
    color: Colors.textMuted,
    fontWeight: '500',
    textTransform: 'none',
    letterSpacing: 0,
  },
  sessionList: {
    gap: 6,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sessionRowSelected: {
    borderColor: Colors.red,
    backgroundColor: Colors.red + '0D',
  },
  sessionScore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionScoreText: {
    fontSize: 16,
    fontWeight: '800',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionDate: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  sessionDur: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  noSessions: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noSessionsText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewEmoji: {
    fontSize: 28,
  },
  previewStats: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  previewScore: {
    fontSize: 20,
    fontWeight: '800',
  },
  previewScoreLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  previewSep: {
    color: Colors.textMuted,
    fontSize: 13,
    marginHorizontal: 2,
  },
  titleInput: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: Colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  captionInput: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: Colors.textPrimary,
    fontSize: 15,
    minHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  photosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 4,
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addPhotoBtnText: {
    color: Colors.red,
    fontSize: 13,
    fontWeight: '700',
  },
  photoRow: {
    marginTop: 4,
  },
  photoThumb: {
    position: 'relative',
    marginRight: 8,
  },
  photoThumbImg: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: Colors.bgCardAlt,
  },
  photoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
});
