import { supabase } from '../constants/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SortMode = 'relevant' | 'popular' | 'latest';

export interface FeedPost {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  session_id: string;
  session_date: string;
  sleep_score: number;
  duration_hours: number;
  coco_level: number;
  title: string;
  caption: string;
  photos: string[];
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
}

export interface FeedComment {
  id: string;
  post_id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
}

const PAGE = 25;

// ── Posts ──────────────────────────────────────────────────────────────────────

export async function fetchPosts(
  sort: SortMode,
  currentUserId: string | null,
): Promise<FeedPost[]> {
  let query = supabase
    .from('feed_posts_with_counts')
    .select('*')
    .limit(PAGE);

  if (sort === 'latest') {
    query = query.order('created_at', { ascending: false });
  } else if (sort === 'popular') {
    query = query
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    // relevant: last 7 days, ordered by likes then recency
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query
      .gte('created_at', sevenDaysAgo)
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const posts = (data as any[]).map((p) => ({ ...p, liked_by_me: false })) as FeedPost[];

  if (!currentUserId || posts.length === 0) return posts;

  // Mark which posts the current user has liked
  const ids = posts.map((p) => p.id);
  const { data: myLikes } = await supabase
    .from('feed_likes')
    .select('post_id')
    .eq('user_id', currentUserId)
    .in('post_id', ids);

  const likedSet = new Set((myLikes ?? []).map((l: any) => l.post_id));
  return posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id) }));
}

export async function createPost(params: {
  userId: string;
  sessionId: string;
  sessionDate: string;
  sleepScore: number;
  durationHours: number;
  cocoLevel: number;
  title: string;
  caption: string;
  photos: string[];
}): Promise<FeedPost | null> {
  const { data, error } = await supabase
    .from('feed_posts')
    .insert({
      user_id: params.userId,
      session_id: params.sessionId,
      session_date: params.sessionDate,
      sleep_score: params.sleepScore,
      duration_hours: params.durationHours,
      coco_level: params.cocoLevel,
      title: params.title,
      caption: params.caption,
      photos: params.photos,
    })
    .select()
    .single();

  if (error || !data) return null;

  return {
    ...data,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    username: '',
    avatar_url: null,
  } as FeedPost;
}

export async function deletePost(postId: string): Promise<void> {
  await supabase.from('feed_posts').delete().eq('id', postId);
}

// ── Likes ──────────────────────────────────────────────────────────────────────

export async function toggleLike(
  postId: string,
  userId: string,
  currentlyLiked: boolean,
): Promise<void> {
  if (currentlyLiked) {
    await supabase
      .from('feed_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
  } else {
    await supabase
      .from('feed_likes')
      .upsert({ post_id: postId, user_id: userId }, { onConflict: 'post_id,user_id' });
  }
}

// ── Comments ───────────────────────────────────────────────────────────────────

export async function fetchComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase
    .from('feed_comments')
    .select('id, post_id, user_id, body, created_at, profiles(username)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error || !data) return [];

  return (data as any[]).map((c) => ({
    id: c.id,
    post_id: c.post_id,
    user_id: c.user_id,
    username: c.profiles?.username ?? 'unknown',
    body: c.body,
    created_at: c.created_at,
  }));
}

export async function addComment(
  postId: string,
  userId: string,
  body: string,
): Promise<FeedComment | null> {
  const { data, error } = await supabase
    .from('feed_comments')
    .insert({ post_id: postId, user_id: userId, body })
    .select('id, post_id, user_id, body, created_at, profiles(username)')
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    post_id: data.post_id,
    user_id: data.user_id,
    username: (data as any).profiles?.username ?? 'unknown',
    body: data.body,
    created_at: data.created_at,
  };
}

// ── Photos ─────────────────────────────────────────────────────────────────────

export async function uploadFeedPhotos(
  userId: string,
  localUris: string[],
): Promise<string[]> {
  const uploaded: string[] = [];

  for (let i = 0; i < localUris.length; i++) {
    const uri = localUris[i];
    try {
      const rawExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
      const path = `${userId}/${Date.now()}_${i}.${ext}`;
      const response = await fetch(uri);
      const blob = await response.blob();

      const { error } = await supabase.storage
        .from('feed-photos')
        .upload(path, blob, {
          contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          upsert: false,
        });

      if (!error) {
        const { data } = supabase.storage.from('feed-photos').getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }
    } catch {
      // Skip failed photos — don't block the post
    }
  }

  return uploaded;
}
