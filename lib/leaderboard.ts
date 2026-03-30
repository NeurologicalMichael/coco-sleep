/**
 * leaderboard.ts
 *
 * Required Supabase migrations:
 *
 *   ALTER TABLE sleep_scores
 *     ADD COLUMN IF NOT EXISTS sleep_duration_min INTEGER,
 *     ADD COLUMN IF NOT EXISTS efficiency_pct      INTEGER,
 *     ADD COLUMN IF NOT EXISTS hrv_score           INTEGER;
 *
 *   ALTER TABLE profiles
 *     ADD COLUMN IF NOT EXISTS share_league_stats BOOLEAN NOT NULL DEFAULT TRUE;
 *
 *   ALTER TABLE leaderboard_groups
 *     ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
 *     ADD COLUMN IF NOT EXISTS stake   TEXT;
 *
 * All new columns are nullable / default-safe so existing rows are unaffected.
 */

import { supabase } from '../constants/supabase';

export interface LeagueDetailStats {
  avgDurationMins: number;   // average sleep duration this week (minutes)
  totalHours: number;        // total hours tracked in the window (sum, not avg)
  avgQuality: number;        // average sleep quality score 0-100 this week
  avgHrv: number | null;     // average HRV proxy (null if not tracked)
  sharingEnabled: true;      // always true — only present when user has sharing on
}

export interface LeaderboardEntry {
  username: string;
  avgScore: number;
  bestScore: number;
  streak: number;
  nights: number;      // sessions in the 7-day window
  tierEmoji: string;
  userId: string;
  leagueStats?: LeagueDetailStats; // only present in friends/groups tabs
}

/** Derive tier emoji from streak count — mirrors the home screen TIER_EMOJI array. */
export function tierEmojiFromStreak(streak: number): string {
  if (streak >= 60) return '👑';
  if (streak >= 30) return '🌟';
  if (streak >= 15) return '🥥';
  if (streak >= 8)  return '🌴';
  if (streak >= 3)  return '🌿';
  return '🌱';
}

export interface LeaderboardGroup {
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  endsAt: string | null;   // ISO timestamp, null = infinite
  stake: string | null;    // e.g. "loser goes bald", "winner gets $50"
}

// ─── Leaderboard queries ──────────────────────────────────────────────────────

export async function fetchGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since = sevenDaysAgo.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('sleep_scores')
    .select('user_id, recovery_score, streak, profiles(username)')
    .gte('date', since)
    .order('recovery_score', { ascending: false });

  if (error || !data) return [];
  return aggregateEntries(data).sort((a, b) => b.avgScore - a.avgScore).slice(0, 50);
}

export async function fetchFriendsLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
  const { data: friendships } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', userId);

  if (!friendships || friendships.length === 0) return [];
  const friendIds = [userId, ...friendships.map((f) => f.friend_id)];
  return fetchScoresForUsers(friendIds);
}

export async function fetchGroupLeaderboard(groupId: string): Promise<LeaderboardEntry[]> {
  const { data: members } = await supabase
    .from('leaderboard_group_members')
    .select('user_id')
    .eq('group_id', groupId);

  if (!members || members.length === 0) return [];
  return fetchScoresForUsers(members.map((m) => m.user_id));
}

async function fetchScoresForUsers(userIds: string[]): Promise<LeaderboardEntry[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since = sevenDaysAgo.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('sleep_scores')
    .select('user_id, recovery_score, streak, sleep_duration_min, efficiency_pct, hrv_score, profiles(username, share_league_stats)')
    .in('user_id', userIds)
    .gte('date', since);

  if (error || !data) return [];
  return aggregateLeagueEntries(data).sort((a, b) => b.avgScore - a.avgScore);
}

type RawScoreRow = {
  user_id: string;
  recovery_score: number;
  streak: number | null;
  profiles: { username: string } | null;
};

type RawLeagueRow = RawScoreRow & {
  sleep_duration_min: number | null;
  efficiency_pct: number | null;
  hrv_score: number | null;
  profiles: { username: string; share_league_stats: boolean | null } | null;
};

/** Basic aggregation — used for global leaderboard (no extended stats). */
function aggregateEntries(data: RawScoreRow[]): LeaderboardEntry[] {
  const map = new Map<string, { username: string; scores: number[]; streak: number }>();
  for (const row of data) {
    const username = row.profiles?.username ?? 'unknown';
    const entry = map.get(row.user_id);
    if (!entry) {
      map.set(row.user_id, { username, scores: [row.recovery_score], streak: row.streak ?? 0 });
    } else {
      entry.scores.push(row.recovery_score);
      if ((row.streak ?? 0) > entry.streak) entry.streak = row.streak ?? 0;
    }
  }
  return Array.from(map.entries()).map(([userId, { username, scores, streak }]) => ({
    userId,
    username,
    avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    bestScore: scores.length > 0 ? Math.max(...scores) : 0,
    streak,
    nights: scores.length,
    tierEmoji: tierEmojiFromStreak(streak),
  }));
}

/** Extended aggregation — used for friends & group leaderboards. Includes detailed stats for users with sharing enabled. */
function aggregateLeagueEntries(data: RawLeagueRow[]): LeaderboardEntry[] {
  type Acc = {
    username: string;
    scores: number[];
    streak: number;
    sharing: boolean;
    durations: number[];
    efficiencies: number[];
    hrvs: number[];
  };
  const map = new Map<string, Acc>();

  for (const row of data) {
    const username = (row.profiles as RawLeagueRow['profiles'])?.username ?? 'unknown';
    const sharing = (row.profiles as RawLeagueRow['profiles'])?.share_league_stats === true;
    const entry = map.get(row.user_id);
    if (!entry) {
      map.set(row.user_id, {
        username, scores: [row.recovery_score], streak: row.streak ?? 0, sharing,
        durations: row.sleep_duration_min != null ? [row.sleep_duration_min] : [],
        efficiencies: row.efficiency_pct != null ? [row.efficiency_pct] : [],
        hrvs: row.hrv_score != null ? [row.hrv_score] : [],
      });
    } else {
      entry.scores.push(row.recovery_score);
      if ((row.streak ?? 0) > entry.streak) entry.streak = row.streak ?? 0;
      if (row.sleep_duration_min != null) entry.durations.push(row.sleep_duration_min);
      if (row.efficiency_pct != null) entry.efficiencies.push(row.efficiency_pct);
      if (row.hrv_score != null) entry.hrvs.push(row.hrv_score);
    }
  }

  return Array.from(map.entries()).map(([userId, { username, scores, streak, sharing, durations, efficiencies, hrvs }]) => {
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const leagueStats: LeagueDetailStats | undefined = sharing ? {
      avgDurationMins: avg(durations),
      totalHours: Math.round(sum(durations) / 60 * 10) / 10, // one decimal place
      avgQuality: avg(efficiencies),
      avgHrv: hrvs.length > 0 ? avg(hrvs) : null,
      sharingEnabled: true,
    } : undefined;

    return {
      userId,
      username,
      avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      bestScore: scores.length > 0 ? Math.max(...scores) : 0,
      streak,
      nights: scores.length,
      tierEmoji: tierEmojiFromStreak(streak),
      leagueStats,
    };
  });
}

// ─── Friends ──────────────────────────────────────────────────────────────────

export async function searchUser(query: string): Promise<{ id: string; username: string } | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', query.toLowerCase())
    .maybeSingle();
  return data;
}

// Uses a server-side RPC function (security definer) so both directions
// of the friendship can be inserted atomically without RLS violations.
export async function addFriend(userId: string, friendId: string): Promise<boolean> {
  const { error } = await supabase.rpc('add_friend', { target_user_id: friendId });
  return !error;
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export async function fetchUserGroups(userId: string): Promise<LeaderboardGroup[]> {
  const { data, error } = await supabase
    .from('leaderboard_group_members')
    .select('group_id, leaderboard_groups(id, name, created_by, invite_code, ends_at, stake)')
    .eq('user_id', userId);

  if (error || !data) return [];

  return data
    .map((row) => {
      const g = row.leaderboard_groups as { id: string; name: string; created_by: string; invite_code: string; ends_at: string | null; stake: string | null } | null;
      if (!g) return null;
      return { id: g.id, name: g.name, createdBy: g.created_by, inviteCode: g.invite_code, endsAt: g.ends_at ?? null, stake: g.stake ?? null } as LeaderboardGroup;
    })
    .filter((x): x is LeaderboardGroup => x !== null);
}

export async function createGroup(
  name: string,
  userId: string,
  options?: { endsAt?: string | null; stake?: string | null },
): Promise<LeaderboardGroup | null> {
  // created_by is set from auth.uid() by a DB trigger — don't pass from client
  const payload: Record<string, unknown> = { name };
  if (options?.endsAt) payload.ends_at = options.endsAt;
  if (options?.stake)  payload.stake   = options.stake.slice(0, 120); // cap at 120 chars

  const { data: group, error } = await supabase
    .from('leaderboard_groups')
    .insert(payload)
    .select()
    .single();

  if (error || !group) return null;

  await supabase
    .from('leaderboard_group_members')
    .insert({ group_id: group.id, user_id: userId });

  return { id: group.id, name: group.name, createdBy: group.created_by, inviteCode: group.invite_code, endsAt: group.ends_at ?? null, stake: group.stake ?? null };
}

export async function joinGroupByCode(inviteCode: string, userId: string): Promise<LeaderboardGroup | null> {
  const { data: group, error } = await supabase
    .from('leaderboard_groups')
    .select('id, name, created_by, invite_code, ends_at, stake')
    .eq('invite_code', inviteCode.toLowerCase().trim())
    .maybeSingle();

  if (error || !group) return null;

  await supabase
    .from('leaderboard_group_members')
    .upsert({ group_id: group.id, user_id: userId }, { onConflict: 'group_id,user_id' });

  return { id: group.id, name: group.name, createdBy: group.created_by, inviteCode: group.invite_code, endsAt: group.ends_at ?? null, stake: group.stake ?? null };
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  await supabase
    .from('leaderboard_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
}

// ─── Score upload ─────────────────────────────────────────────────────────────

export interface UploadScoreDetails {
  sleepDurationMins: number;  // total sleep duration in minutes
  efficiencyPct: number;      // sleep efficiency 0-100
  hrvScore: number | null;    // HRV proxy score (null if unavailable)
}

// user_id is validated server-side by RLS (auth.uid() = user_id)
// details are only uploaded when the user has share_league_stats enabled
export async function uploadScore(
  userId: string,
  date: string,
  recoveryScore: number,
  streak: number,
  details?: UploadScoreDetails,
): Promise<void> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    date,
    recovery_score: Math.max(0, Math.min(100, Math.round(recoveryScore))),
    streak: Math.max(0, Math.round(streak)),
  };

  if (details) {
    payload.sleep_duration_min = Math.max(0, Math.round(details.sleepDurationMins));
    payload.efficiency_pct     = Math.max(0, Math.min(100, Math.round(details.efficiencyPct)));
    payload.hrv_score          = details.hrvScore != null ? Math.max(0, Math.round(details.hrvScore)) : null;
  } else {
    // Explicitly null-out so a previous upload doesn't leak if user disables sharing
    payload.sleep_duration_min = null;
    payload.efficiency_pct     = null;
    payload.hrv_score          = null;
  }

  await supabase.from('sleep_scores').upsert(payload, { onConflict: 'user_id,date' });
}
