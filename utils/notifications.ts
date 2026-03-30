/**
 * notifications.ts
 * Coco notifications — kept minimal intentionally.
 * Only fires:
 *   - Bedtime reminder ("almost sleep time")
 *   - Leaderboard / competitive social notifications
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoachSettings } from '../store/coachStore';
import { parseTimeHM } from './timeHelpers';
import { fetchFriendsLeaderboard } from '../lib/leaderboard';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice && Platform.OS !== 'ios') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: false,
      allowCriticalAlerts: true,
    },
  });
  return status === 'granted';
}

// ─── Schedule all coach notifications ────────────────────────────────────────

export async function scheduleCoachNotifications(
  settings: CoachSettings,
  _streak: number,
  _rollingAvgScore: number,
): Promise<void> {
  await cancelAllCocoNotifications();
  // Only schedule the bedtime reminder — nothing else
  if (settings.bedtimeReminderEnabled) {
    await scheduleBedtimeReminder(settings.bedtimeReminderTime);
  }
}

export async function cancelAllCocoNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const cocoIds = scheduled
    .filter((n) => n.content.data?.source === 'coco')
    .map((n) => n.identifier);
  await Promise.all(cocoIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

// ─── Individual notification builders ────────────────────────────────────────

/** Fires every night at bedtime. */
async function scheduleBedtimeReminder(time: string): Promise<void> {
  const parsed = parseTimeHM(time);
  if (!parsed) return;
  const { h: hour, m: minute } = parsed;
  const messages = [
    `Sleep o'clock. Coco is waiting.`,
    `Recovery starts now. Put the phone down and get horizontal.`,
    `Your gains depend on your sleep. Time to earn them.`,
    `Bedtime. Sleep is your recovery tool. Use it.`,
  ];
  const body = messages[Math.floor(Math.random() * messages.length)];
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'COCO: Bedtime',
      body,
      sound: true,
      data: { source: 'coco', type: 'bedtime' },
    },
    trigger: {
      hour,
      minute,
      repeats: true,
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
    },
  });
}

// ─── League rival notification ────────────────────────────────────────────────

/**
 * Fires immediately when someone in your league surpasses you.
 * Throttled externally — only call once per session / ranking change.
 */
export async function scheduleLeagueRivalNotification(
  rivalUsername: string,
  rivalScore: number,
  myScore: number,
): Promise<void> {
  const diff = rivalScore - myScore;
  const bodies = [
    `${rivalUsername} is ${diff} pts ahead of you. Sleep better tonight and take back your spot.`,
    `Your league rival ${rivalUsername} just overtook you. Time to fix your sleep.`,
    `${rivalUsername} scored ${rivalScore} — you're at ${myScore}. Don't sleep on this. Actually, do sleep. More.`,
  ];
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'COCO: You\'re Being Beaten',
      body: bodies[Math.floor(Math.random() * bodies.length)],
      sound: true,
      data: { source: 'coco', type: 'league_rival', deepLink: '/(tabs)/leaderboard' },
    },
    trigger: {
      seconds: 3,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
}

// ─── Alarm ────────────────────────────────────────────────────────────────────

/** Schedule a daily alarm on the specified weekdays. */
export async function scheduleAlarm(time: string, days: number[]): Promise<void> {
  await cancelAlarm();
  const parsed = parseTimeHM(time);
  if (!parsed) return;
  const { h: hour, m: minute } = parsed;
  await Promise.all(
    days.map((day) =>
      Notifications.scheduleNotificationAsync({
        identifier: `coco-alarm-${day}`,
        content: {
          title: 'COCO: Wake Up',
          body: 'Time to start your day strong.',
          sound: 'default',
          ...(Platform.OS === 'ios' ? { interruptionLevel: 'critical' } : {}),
          data: { source: 'coco', type: 'alarm' },
        },
        trigger: {
          weekday: day + 1, // expo-notifications: 1=Sun…7=Sat
          hour,
          minute,
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        },
      })
    )
  );
}

export async function cancelAlarm(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const alarmIds = scheduled
    .filter((n) => (n.identifier as string).startsWith('coco-alarm-'))
    .map((n) => n.identifier);
  await Promise.all(alarmIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

// ─── Social motivational notifications ───────────────────────────────────────

const SOCIAL_THROTTLE_KEY = 'coco-social-notif-last';
// Fire at most once per 36 hours
const SOCIAL_MIN_INTERVAL_MS = 36 * 60 * 60 * 1000;

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * Fires a social motivational notification based on how you stack up
 * against your friends this week. Throttled to once per 36 hours.
 * No-ops silently if you have no friends.
 */
export async function scheduleSocialNotifications(
  userId: string,
  myScore: number,
  myStreak: number,
): Promise<void> {
  try {
    // Throttle — skip if already sent within 36h
    const lastStr = await AsyncStorage.getItem(SOCIAL_THROTTLE_KEY);
    if (lastStr && Date.now() - parseInt(lastStr, 10) < SOCIAL_MIN_INTERVAL_MS) return;

    const allEntries = await fetchFriendsLeaderboard(userId);
    const friends = allEntries.filter((f) => f.userId !== userId);
    if (friends.length === 0) return;

    const myEntry  = allEntries.find((f) => f.userId === userId);
    const myAvg    = myEntry?.avgScore ?? myScore;
    const sorted   = [...allEntries].sort((a, b) => b.avgScore - a.avgScore);
    const iAmFirst = sorted[0]?.userId === userId;
    const topFriend = friends.sort((a, b) => b.avgScore - a.avgScore)[0];

    let title = '';
    let body  = '';

    if (iAmFirst && friends.length >= 1) {
      // Leading the pack
      title = 'COCO: You\'re leading';
      body = pick([
        `Best sleep score in your group this week — ${Math.round(myAvg)} avg. Don't get comfortable.`,
        `You're beating all your friends this week. Keep the streak alive.`,
      ]);

    } else if (topFriend && topFriend.avgScore > myAvg + 10) {
      // Getting lapped by a friend
      const diff = Math.round(topFriend.avgScore - myAvg);
      title = `COCO: ${topFriend.username} is sleeping on you`;
      body = pick([
        `${topFriend.username} is ${diff} pts ahead of you this week. Fix your nights.`,
        `${topFriend.username} is averaging ${Math.round(topFriend.avgScore)} — you're at ${Math.round(myAvg)}. Do better.`,
      ]);

    } else if (topFriend && Math.abs(topFriend.avgScore - myAvg) <= 4) {
      // Neck and neck
      title = `COCO: You and ${topFriend.username} are tied`;
      body = pick([
        `${Math.round(myAvg)} vs ${topFriend.username}'s ${Math.round(topFriend.avgScore)}. One good night separates you.`,
        `Basically tied with ${topFriend.username} this week. Tonight decides it.`,
      ]);

    } else if (myScore >= 80) {
      // You're cooking
      title = 'COCO: You\'re on a roll';
      body = pick([
        `${myScore} last night. Coco is thriving. Keep it going.`,
        `Sleep score ${myScore} — locked in. Your friends better watch out.`,
        `${myScore}. That's elite. Don't break the pattern.`,
      ]);

    } else {
      // Check if a friend is on a hot streak
      const streakFriend = friends.find((f) => f.streak >= 7 && f.streak > myStreak + 2);
      if (streakFriend) {
        title = `COCO: ${streakFriend.username} is on a run`;
        body = pick([
          `${streakFriend.username} hasn't missed a night in ${streakFriend.streak} days. Can you say the same?`,
          `${streakFriend.streak} nights straight from ${streakFriend.username}. Are you keeping pace?`,
        ]);

      } else if (friends.every((f) => f.avgScore < 50) && myAvg < 50) {
        // Everyone slept bad
        title = 'COCO: Your whole squad 💀';
        body = pick([
          `Nobody's scoring well. Tonight's your chance to separate yourself.`,
          `Everyone's sleep is off. Whoever fixes it first wins the week.`,
        ]);

      } else {
        // Generic nudge
        const activeCount = friends.filter((f) => f.nights > 0).length;
        title = 'COCO: Sleep check';
        body = `${activeCount} of your friend${activeCount !== 1 ? 's are' : ' is'} tracking this week. Don't fall behind.`;
      }
    }

    if (!title || !body) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { source: 'coco', type: 'social', deepLink: '/(tabs)/leaderboard' },
      },
      trigger: {
        seconds: 5,
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      },
    });

    await AsyncStorage.setItem(SOCIAL_THROTTLE_KEY, String(Date.now()));
  } catch { /* network failure, no friends data — fail silently */ }
}

// notifyAutoSessionEnd removed — auto-end notifications are too noisy.
