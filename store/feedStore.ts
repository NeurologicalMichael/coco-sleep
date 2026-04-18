import { create } from 'zustand';
import {
  fetchPosts,
  toggleLike as apiToggleLike,
  type FeedPost,
  type SortMode,
} from '../lib/feed';

interface FeedStore {
  posts: FeedPost[];
  sort: SortMode;
  loading: boolean;
  refreshing: boolean;

  setSort: (sort: SortMode, userId: string | null) => Promise<void>;
  loadPosts: (userId: string | null) => Promise<void>;
  refreshPosts: (userId: string | null) => Promise<void>;
  optimisticToggleLike: (postId: string, userId: string) => Promise<void>;
  prependPost: (post: FeedPost) => void;
}

export { type FeedPost } from '../lib/feed';

export const useFeedStore = create<FeedStore>()((set, get) => ({
  posts: [],
  sort: 'relevant',
  loading: false,
  refreshing: false,

  setSort: async (sort, userId) => {
    set({ sort, loading: true });
    try {
      const posts = await fetchPosts(sort, userId);
      set({ posts, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadPosts: async (userId) => {
    set({ loading: true });
    try {
      const { sort } = get();
      const posts = await fetchPosts(sort, userId);
      set({ posts, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  refreshPosts: async (userId) => {
    set({ refreshing: true });
    try {
      const { sort } = get();
      const posts = await fetchPosts(sort, userId);
      set({ posts, refreshing: false });
    } catch {
      set({ refreshing: false });
    }
  },

  optimisticToggleLike: async (postId, userId) => {
    const { posts } = get();
    const target = posts.find((p) => p.id === postId);
    if (!target) return;

    const wasLiked = target.liked_by_me;

    // Optimistic update first
    set({
      posts: posts.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          liked_by_me: !wasLiked,
          like_count: wasLiked ? p.like_count - 1 : p.like_count + 1,
        };
      }),
    });

    // Background sync — if it fails, revert
    const err = await apiToggleLike(postId, userId, wasLiked).then(() => null).catch((e) => e);
    if (err) {
      set({
        posts: get().posts.map((p) => {
          if (p.id !== postId) return p;
          return { ...p, liked_by_me: wasLiked, like_count: wasLiked ? p.like_count + 1 : p.like_count - 1 };
        }),
      });
    }
  },

  prependPost: (post) => {
    set((s) => ({ posts: [post, ...s.posts] }));
  },
}));
