import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFeedStore, type FeedPost } from '../../store/feedStore';
import { useAuthStore } from '../../store/authStore';
import {
  fetchComments,
  addComment,
  type FeedComment,
  type SortMode,
} from '../../lib/feed';

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

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Sort tabs ──────────────────────────────────────────────────────────────────

function SortTabs({
  sort,
  onSort,
}: {
  sort: SortMode;
  onSort: (s: SortMode) => void;
}) {
  const tabs: { key: SortMode; label: string }[] = [
    { key: 'relevant', label: 'Relevant' },
    { key: 'popular',  label: 'Popular' },
    { key: 'latest',   label: 'Latest' },
  ];
  return (
    <View style={styles.sortRow}>
      {tabs.map(({ key, label }) => (
        <TouchableOpacity
          key={key}
          onPress={() => onSort(key)}
          style={[styles.sortTab, sort === key && styles.sortTabActive]}
          activeOpacity={0.75}
        >
          <Text style={[styles.sortTabText, sort === key && styles.sortTabTextActive]}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Comments modal ─────────────────────────────────────────────────────────────

function CommentsModal({
  post,
  visible,
  onClose,
  currentUserId,
}: {
  post: FeedPost;
  visible: boolean;
  onClose: () => void;
  currentUserId: string | null;
}) {
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!visible) return;
    setLoadingComments(true);
    fetchComments(post.id).then((data) => {
      setComments(data);
      setLoadingComments(false);
    });
  }, [visible, post.id]);

  const handleSend = useCallback(async () => {
    if (!text.trim() || !currentUserId || sending) return;
    setSending(true);
    const newComment = await addComment(post.id, currentUserId, text.trim());
    if (newComment) {
      setComments((prev) => [...prev, newComment]);
      setText('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
    setSending(false);
  }, [text, currentUserId, post.id, sending]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.commentsContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.commentsHeader}>
          <Text style={styles.commentsTitle}>Comments</Text>
          <TouchableOpacity onPress={onClose} style={styles.commentsClose}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Comment list */}
        {loadingComments ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
        ) : comments.length === 0 ? (
          <View style={styles.commentsEmpty}>
            <Text style={styles.commentsEmptyText}>No comments yet. Be the first!</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={comments}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.commentsList}
            renderItem={({ item }) => (
              <View style={styles.commentRow}>
                <View style={styles.commentAvatar}>
                  <Text style={styles.commentAvatarText}>
                    {(item.username ?? '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.commentBody}>
                  <Text style={styles.commentUsername}>{item.username}</Text>
                  <Text style={styles.commentText}>{item.body}</Text>
                </View>
              </View>
            )}
          />
        )}

        {/* Input */}
        {currentUserId ? (
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder="Add a comment..."
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={setText}
              maxLength={240}
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
            >
              <Ionicons name="send" size={18} color={!text.trim() || sending ? Colors.textMuted : Colors.red} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.commentInputRow}>
            <Text style={[styles.commentText, { color: Colors.textMuted, flex: 1 }]}>
              Sign in to comment
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Post card ──────────────────────────────────────────────────────────────────

function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
}: {
  post: FeedPost;
  currentUserId: string | null;
  onLike: () => void;
  onComment: () => void;
}) {
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        {post.avatar_url ? (
          <Image source={{ uri: post.avatar_url }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {(post.username ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardUsername}>{post.username || 'Anonymous'}</Text>
          <Text style={styles.cardTime}>{timeAgo(post.created_at)}</Text>
        </View>
      </View>

      {/* Sleep stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statPill}>
          <Text style={styles.statEmoji}>{cocoEmoji(post.coco_level)}</Text>
          <Text style={styles.statLabel}>Lv.{post.coco_level}</Text>
        </View>
        <View style={[styles.statPill, { borderColor: scoreColor(post.sleep_score) + '44' }]}>
          <Text style={[styles.statScore, { color: scoreColor(post.sleep_score) }]}>
            {post.sleep_score}
          </Text>
          <Text style={styles.statLabel}> score</Text>
        </View>
        <View style={styles.statPill}>
          <Ionicons name="moon" size={13} color={Colors.info} style={{ marginRight: 4 }} />
          <Text style={[styles.statLabel, { color: Colors.info }]}>
            {formatDuration(post.duration_hours)}
          </Text>
        </View>
        <Text style={styles.statDate}>{post.session_date}</Text>
      </View>

      {/* Title */}
      {!!post.title && <Text style={styles.cardTitle}>{post.title}</Text>}

      {/* Caption */}
      {!!post.caption && <Text style={styles.cardCaption}>{post.caption}</Text>}

      {/* Photos */}
      {post.photos.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
          {post.photos.map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.photo} />
          ))}
        </ScrollView>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onLike}
          disabled={!currentUserId}
        >
          <Ionicons
            name={post.liked_by_me ? 'heart' : 'heart-outline'}
            size={20}
            color={post.liked_by_me ? Colors.red : Colors.textSecondary}
          />
          {post.like_count > 0 && (
            <Text style={[styles.actionCount, post.liked_by_me && { color: Colors.red }]}>
              {post.like_count}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onComment}>
          <Ionicons name="chatbubble-outline" size={18} color={Colors.textSecondary} />
          {post.comment_count > 0 && (
            <Text style={styles.actionCount}>{post.comment_count}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyFeed({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>🌙</Text>
      <Text style={styles.emptyTitle}>No posts yet</Text>
      <Text style={styles.emptyBody}>
        Share your first sleep — tap the + button to get started.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onCreate}>
        <Text style={styles.emptyBtnText}>Create Post</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const router = useRouter();
  const { posts, sort, loading, refreshing, setSort, loadPosts, refreshPosts, optimisticToggleLike } =
    useFeedStore();
  const { userId } = useAuthStore();
  const [commentPost, setCommentPost] = useState<FeedPost | null>(null);

  // Load on focus (and when sort or userId changes)
  useFocusEffect(
    useCallback(() => {
      loadPosts(userId);
    }, [userId]),
  );

  const handleSort = useCallback(
    (s: SortMode) => {
      setSort(s, userId);
    },
    [userId, setSort],
  );

  return (
    <View style={styles.container}>
      {/* Sort tabs */}
      <View style={styles.header}>
        <SortTabs sort={sort} onSort={handleSort} />
      </View>

      {loading && posts.length === 0 ? (
        <ActivityIndicator color={Colors.red} size="large" style={{ marginTop: 60 }} />
      ) : posts.length === 0 ? (
        <EmptyFeed onCreate={() => router.push('/create-post')} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              currentUserId={userId}
              onLike={() => userId && optimisticToggleLike(item.id, userId)}
              onComment={() => setCommentPost(item)}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refreshPosts(userId)}
              tintColor={Colors.red}
            />
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/create-post')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Comments sheet */}
      {commentPost && (
        <CommentsModal
          post={commentPost}
          visible={!!commentPost}
          onClose={() => setCommentPost(null)}
          currentUserId={userId}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 8,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  // Sort tabs
  sortRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sortTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sortTabActive: {
    backgroundColor: Colors.red + '22',
    borderColor: Colors.red,
  },
  sortTabText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  sortTabTextActive: {
    color: Colors.red,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  // Card
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.red + '22',
    borderWidth: 1,
    borderColor: Colors.red + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarText: {
    color: Colors.red,
    fontSize: 16,
    fontWeight: '700',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardUsername: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  cardTime: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCardAlt,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statEmoji: {
    fontSize: 13,
    marginRight: 4,
  },
  statScore: {
    fontSize: 14,
    fontWeight: '800',
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  statDate: {
    color: Colors.textMuted,
    fontSize: 11,
    marginLeft: 'auto',
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  cardCaption: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  photoRow: {
    marginTop: 2,
  },
  photo: {
    width: 200,
    height: 140,
    borderRadius: 10,
    marginRight: 8,
    backgroundColor: Colors.bgCardAlt,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  actionCount: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 52,
    marginBottom: 4,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  emptyBody: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: Colors.red,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  // FAB
  fab: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  // Comments modal
  commentsContainer: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },
  commentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  commentsTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  commentsClose: {
    padding: 4,
  },
  commentsEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  commentsEmptyText: {
    color: Colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  commentsList: {
    padding: 16,
    gap: 14,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.red + '22',
    borderWidth: 1,
    borderColor: Colors.red + '44',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  commentAvatarText: {
    color: Colors.red,
    fontSize: 13,
    fontWeight: '700',
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentUsername: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  commentText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgDeep,
  },
  commentInput: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.red + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    borderColor: Colors.border,
  },
});
