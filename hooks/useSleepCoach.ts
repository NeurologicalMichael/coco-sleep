/**
 * useSleepCoach
 * Initializes and manages the sleep coach system:
 *   - Requests notification permissions on first use
 *   - Reschedules all notifications whenever settings change
 *   - Provides coach status and toggle helpers
 */

import { useEffect, useCallback } from 'react';
import { useCoachStore } from '../store/coachStore';
import { useCocoStore } from '../store/cocoStore';
import { useRecoveryStore } from '../store/recoveryStore';
import {
  requestNotificationPermissions,
  scheduleCoachNotifications,
  cancelAllCocoNotifications,
  scheduleAlarm,
  cancelAlarm,
} from '../utils/notifications';

export function useSleepCoach() {
  const { settings, notificationsAuthorized, setNotificationsAuthorized, updateSettings } = useCoachStore();
  const { streak } = useCocoStore();
  const { history } = useRecoveryStore();

  // Rolling 7-day avg recovery score
  const rollingAvg = history.length > 0
    ? Math.round(history.slice(0, 7).reduce((s, h) => s + h.recovery.recoveryScore, 0) / Math.min(history.length, 7))
    : 0;

  // Request permissions + schedule on first mount
  useEffect(() => {
    (async () => {
      const granted = await requestNotificationPermissions();
      setNotificationsAuthorized(granted);
      if (granted && settings.bedtimeReminderEnabled) {
        await scheduleCoachNotifications(settings, streak, rollingAvg);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reschedule coach notifications whenever settings or streak/avg changes
  useEffect(() => {
    if (!notificationsAuthorized) return;
    scheduleCoachNotifications(settings, streak, rollingAvg);
  }, [settings, streak, rollingAvg, notificationsAuthorized]);

  // Reschedule alarm whenever alarm settings change
  useEffect(() => {
    if (!notificationsAuthorized) return;
    if (settings.alarmEnabled && settings.alarmDays.length > 0) {
      scheduleAlarm(settings.alarmTime, settings.alarmDays);
    } else {
      cancelAlarm();
    }
  }, [settings.alarmEnabled, settings.alarmTime, settings.alarmDays, notificationsAuthorized]);

  const enableCoach = useCallback(async () => {
    const granted = await requestNotificationPermissions();
    setNotificationsAuthorized(granted);
    if (granted) {
      updateSettings({ bedtimeReminderEnabled: true, morningReportEnabled: true, streakWarningEnabled: true });
    }
    return granted;
  }, [setNotificationsAuthorized, updateSettings]);

  const disableCoach = useCallback(async () => {
    await cancelAllCocoNotifications();
    updateSettings({ bedtimeReminderEnabled: false, morningReportEnabled: false, streakWarningEnabled: false, slackingNudgesEnabled: false });
  }, [updateSettings]);

  return {
    settings,
    updateSettings,
    notificationsAuthorized,
    rollingAvg,
    enableCoach,
    disableCoach,
  };
}
