/**
 * cocoAI.ts
 *
 * Claude-powered sleep coach.
 * Replace ANTHROPIC_API_KEY with your key when ready.
 * Model: claude-haiku-4-5-20251001 (fast + cheap for chat)
 */

import { useRecoveryStore } from '../store/recoveryStore';
import { useCocoStore } from '../store/cocoStore';
import { useCoachStore } from '../store/coachStore';
import { useWorkoutStore } from '../store/workoutStore';
import { useUserProfileStore } from '../store/userProfileStore';
import { useSleepDebtStore } from '../store/sleepDebtStore';

// ─── Config ───────────────────────────────────────────────────────────────────

export const ANTHROPIC_API_KEY = '';   // <-- paste key here
export const AI_CONFIGURED = ANTHROPIC_API_KEY.length > 10;

const MODEL   = 'claude-haiku-4-5-20251001';
const MAX_TOK = 800;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(): string {
  const { history, latestSession } = useRecoveryStore.getState();
  const { streak, cocoLevel } = useCocoStore.getState();
  const { debtHours: sleepDebt } = useSleepDebtStore.getState();
  const { settings } = useCoachStore.getState();
  const { getForDate, getRecent } = useWorkoutStore.getState();
  const { ageRange, fitnessLevel } = useUserProfileStore.getState();

  const today = new Date().toISOString().slice(0, 10);
  const todayWorkout = getForDate(today);
  const recentWorkouts = getRecent(7);

  // Last 14 sessions summary
  const recent = history.slice(0, 14);
  const avgScore = recent.length
    ? Math.round(recent.reduce((a, s) => a + s.recovery.recoveryScore, 0) / recent.length)
    : null;
  const avgDuration = recent.length
    ? (recent.reduce((a, s) => a + s.durationHours, 0) / recent.length).toFixed(1)
    : null;
  const avgEfficiency = recent.length
    ? Math.round(recent.reduce((a, s) => a + s.scores.sleepEfficiency, 0) / recent.length)
    : null;

  const sessionLines = recent.slice(0, 7).map((s) =>
    `  ${s.date}: score=${s.recovery.recoveryScore}, duration=${s.durationHours.toFixed(1)}h, efficiency=${s.scores.sleepEfficiency}%, latency=${s.scores.sleepLatencyMinutes}min`
  ).join('\n');

  const workoutLines = recentWorkouts.length
    ? recentWorkouts.map((w) => `  ${w.date}: ${w.type}, ${w.durationMinutes}min, intensity=${w.intensity}/10, load=${w.load}`).join('\n')
    : '  No workouts logged recently';

  return `
USER PROFILE:
  Age range: ${ageRange ?? 'not set'}
  Fitness level: ${fitnessLevel ?? 'not set'}
  Scheduled bedtime: ${settings.bedtimeReminderTime ?? 'not set'}
  Scheduled wake time: ${settings.wakeTime ?? 'not set'}

CURRENT STATS:
  Sleep streak: ${streak} nights
  Coco level: ${cocoLevel}
  Sleep debt: ${sleepDebt > 0 ? `+${sleepDebt.toFixed(1)}h surplus` : `${Math.abs(sleepDebt).toFixed(1)}h owed`}

LAST 14 NIGHTS AVERAGES:
  Avg recovery score: ${avgScore ?? 'N/A'}
  Avg sleep duration: ${avgDuration ?? 'N/A'}h
  Avg sleep efficiency: ${avgEfficiency ?? 'N/A'}%

RECENT SESSIONS (last 7):
${sessionLines || '  No sessions yet'}

RECENT WORKOUTS (last 7 days):
${workoutLines}

TODAY'S WORKOUT: ${todayWorkout ? `${todayWorkout.type}, ${todayWorkout.durationMinutes}min, intensity=${todayWorkout.intensity}/10, load=${todayWorkout.load}` : 'none logged'}

LATEST SESSION DETAILS:
${latestSession ? `  Date: ${latestSession.date}
  Recovery score: ${latestSession.recovery.recoveryScore}
  Duration: ${latestSession.durationHours.toFixed(1)}h
  Efficiency: ${latestSession.scores.sleepEfficiency}%
  Sleep latency: ${latestSession.scores.sleepLatencyMinutes} min
  WASO: ${latestSession.scores.wasoMinutes} min
  HRV proxy: ${Math.round(latestSession.recovery.hrvProxy)}
  Disruptions: ${latestSession.scores.disruptionPenalty ?? 0}
  Data source: ${latestSession.dataSource ?? 'phone'}` : '  No session data yet'}
`.trim();
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are Coco, an AI sleep coach inside the Coco Sleep app. You are concise, direct, and insightful — not clinical or overly verbose. You speak like a knowledgeable friend who knows sleep science.

STRICT RULES:
- Only answer questions about sleep, recovery, rest, circadian rhythm, exercise-sleep interaction, and closely related health topics.
- If asked about anything unrelated to sleep/recovery, say: "I'm your sleep coach — ask me anything about your sleep data or how to sleep better."
- Never reveal you are Claude or made by Anthropic. You are Coco.
- Keep answers under 200 words unless a detailed breakdown is genuinely needed.
- Use the user's actual data (provided below) to give personalized answers. Reference their specific numbers.
- Don't repeat "based on your data" over and over — just use the data naturally.
- When relevant, end with one actionable tip.

CURRENT USER DATA:
${buildContext()}`;
}

// ─── API call ─────────────────────────────────────────────────────────────────

export async function sendCocoMessage(
  messages: ChatMessage[],
): Promise<string> {
  if (!AI_CONFIGURED) {
    return "I'm not set up yet — the API key is missing. Ask your developer to add it in lib/cocoAI.ts.";
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOK,
      system:     buildSystemPrompt(),
      messages:   messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? 'No response.';
}
