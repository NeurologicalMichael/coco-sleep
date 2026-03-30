/**
 * audioSampler.ts
 *
 * Sleep sound detection using native AVAudioEngine (primary) with expo-audio fallback.
 *
 * Architecture:
 *  Primary (iOS native):
 *   - AVAudioEngine input tap → RMS → dBFS → classify every 30s
 *   - No audio files saved — purely lightweight event metadata
 *   - AVAudioSession .measurement mode = minimal filtering, best for analysis
 *   - Accelerate vDSP_rmsqv for efficient buffer processing
 *
 *  Fallback (expo-audio):
 *   - expo-audio AudioRecorder with metering enabled
 *   - 60-second chunks, non-quiet chunks saved as playable clips
 *
 * Sound events: 'quiet' | 'snoring' | 'talking' | 'loud_event'
 */

import * as FileSystem from 'expo-file-system';
import { AudioEvent } from './hrvProxy';
import { SleepAudioEngine } from '../modules/SleepAudioEngine';

// expo-audio fallback imports (only used if native engine unavailable)
let expoRequestPermission: (() => Promise<boolean>) | null = null;
let expoSetAudioMode: ((opts: any) => Promise<void>) | null = null;
let AudioModule: any = null;
let RecordingPresets: any = null;
try {
  const ea = require('expo-audio');
  expoRequestPermission = async () => { const { granted } = await ea.requestRecordingPermissionsAsync(); return granted; };
  expoSetAudioMode = ea.setAudioModeAsync;
  AudioModule   = require('expo-audio/build/AudioModule').default;
  RecordingPresets = ea.RecordingPresets;
} catch { /* expo-audio not available */ }

export { AudioEvent };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MotionSample { magnitude: number; t: number; }
export type MovementIntensity = 'low' | 'medium' | 'high';

export function classifyMovementIntensity(magnitude: number): MovementIntensity {
  if (magnitude > 0.10) return 'high';
  if (magnitude > 0.02) return 'medium';
  return 'low';
}

// ─── Clip storage (for expo-audio fallback clips) ─────────────────────────────

const CLIPS_DIR = (FileSystem.documentDirectory ?? '') + 'sleep_clips/';

export async function ensureClipsDir(): Promise<void> {
  try { await FileSystem.makeDirectoryAsync(CLIPS_DIR, { intermediates: true }); } catch { /* ok */ }
}

export async function listSavedClips(): Promise<string[]> {
  try {
    const files = await FileSystem.readDirectoryAsync(CLIPS_DIR);
    return files.map((f) => CLIPS_DIR + f).sort();
  } catch { return []; }
}

export async function deleteClip(uri: string): Promise<void> {
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* ok */ }
}

export async function deleteAllClips(): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(CLIPS_DIR);
    await Promise.all(files.map((f) => FileSystem.deleteAsync(CLIPS_DIR + f, { idempotent: true })));
  } catch { /* ok */ }
}

export async function matchClipsToEvents(events: AudioEvent[]): Promise<AudioEvent[]> {
  try {
    const files = await FileSystem.readDirectoryAsync(CLIPS_DIR);
    const clips = files
      .filter((f) => f.startsWith('clip_') && f.endsWith('.m4a'))
      .map((f) => ({ uri: CLIPS_DIR + f, start: parseInt(f.replace('clip_', '').replace('.m4a', ''), 10) }));
    return events.map((e) => {
      const clip = clips.find((c) => e.timestamp >= c.start && e.timestamp < c.start + 60_000);
      return clip ? { ...e, clipUri: clip.uri } : e;
    });
  } catch { return events; }
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _onEvent: ((e: AudioEvent) => void) | null = null;
let _nativeUnsub: (() => void) | null = null;
let _usingNative = false;

// expo-audio fallback state
type AnyRecorder = any;
let _recorder: AnyRecorder | null = null;
let _epochTimer: ReturnType<typeof setInterval> | null = null;
let _chunkTimer: ReturnType<typeof setInterval> | null = null;
let _meteringBuffer: number[] = [];
let _chunkStartMs = 0;
let _chunkEvents: AudioEvent[] = [];
let _usingMic = false;

// Motion fallback
let _motionBuffer: MotionSample[] = [];

const EPOCH_MS = 30_000;
const CHUNK_MS = 60_000;

// ─── Permission ───────────────────────────────────────────────────────────────

/** Returns current permission status without triggering a dialog. */
export function audioPermissionStatus(): 'granted' | 'denied' | 'undetermined' {
  if (SleepAudioEngine.isAvailable) return SleepAudioEngine.permissionStatus();
  return 'undetermined';
}

export async function requestAudioPermission(): Promise<boolean> {
  if (SleepAudioEngine.isAvailable) return SleepAudioEngine.requestPermission();
  if (expoRequestPermission) return expoRequestPermission();
  return false;
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

export async function startAudioSampling(
  onEvent: (e: AudioEvent) => void,
): Promise<boolean> {
  _onEvent = onEvent;

  // ── Primary: Native AVAudioEngine ────────────────────────────────────────
  if (SleepAudioEngine.isAvailable) {
    try {
      const granted = await SleepAudioEngine.requestPermission();
      if (granted) {
        const started = await SleepAudioEngine.start();
        if (started) {
          _usingNative = true;
          _nativeUnsub = SleepAudioEngine.addSoundEventListener((e) => {
            const evt: AudioEvent = {
              timestamp: e.timestamp,
              db:        Math.round(e.db * 10) / 10,
              peakDb:    Math.round(e.peakDb * 10) / 10,
              peaks:     0,
              type:      e.type,
            };
            _onEvent?.(evt);
          });
          return true;
        }
      }
    } catch { /* native engine failed — fall through to expo-audio */ }
    // Fall through to expo-audio fallback if native engine fails
  }

  // ── Fallback: expo-audio recorder ────────────────────────────────────────
  _meteringBuffer = [];
  _motionBuffer   = [];
  _chunkEvents    = [];
  _usingMic       = false;
  _usingNative    = false;

  await ensureClipsDir();

  const hasPermission = expoRequestPermission ? await expoRequestPermission() : false;

  if (hasPermission && AudioModule && RecordingPresets && expoSetAudioMode) {
    try {
      await expoSetAudioMode({
        playsInSilentMode: true, shouldPlayInBackground: true,
        interruptionMode: 'doNotMix', allowsBackgroundRecording: true,
      });

      _recorder = await startFallbackRecorder();
      if (_recorder) {
        _usingMic     = true;
        _chunkStartMs = Date.now();

        _epochTimer = setInterval(() => {
          if (_meteringBuffer.length === 0) return;
          const snap = _meteringBuffer.splice(0);
          const evt  = classifyFallbackEpoch(snap);
          _chunkEvents.push(evt);
          _onEvent?.(evt);
        }, EPOCH_MS);

        _chunkTimer = setInterval(async () => {
          const oldRec    = _recorder;
          const oldStart  = _chunkStartMs;
          const oldEvents = _chunkEvents.slice();
          _recorder     = await startFallbackRecorder();
          _chunkStartMs = Date.now();
          _chunkEvents  = [];
          if (oldRec) await finalizeFallbackChunk(oldRec, oldStart, oldEvents);
        }, CHUNK_MS);

        return true;
      }
    } catch { /* fall through */ }
  }

  // ── Motion-only fallback ────────────────────────────────────────────────
  _epochTimer = setInterval(() => {
    if (_motionBuffer.length === 0) return;
    const snap = _motionBuffer.splice(0);
    _onEvent?.(classifyMotionEpoch(snap));
  }, EPOCH_MS);

  return false;
}

export async function stopAudioSampling(): Promise<void> {
  // Stop native engine
  if (_usingNative) {
    _nativeUnsub?.();
    _nativeUnsub = null;
    await SleepAudioEngine.stop();
    _usingNative = false;
  }

  // Stop expo-audio fallback
  if (_epochTimer) { clearInterval(_epochTimer); _epochTimer = null; }
  if (_chunkTimer) { clearInterval(_chunkTimer); _chunkTimer = null; }
  if (_recorder) {
    await finalizeFallbackChunk(_recorder, _chunkStartMs, _chunkEvents);
    _recorder = null;
  }

  _onEvent        = null;
  _meteringBuffer = [];
  _motionBuffer   = [];
  _chunkEvents    = [];
  _usingMic       = false;
}

// ─── Fallback recorder helpers ────────────────────────────────────────────────

async function startFallbackRecorder(): Promise<AnyRecorder | null> {
  try {
    const opts = { ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true };
    const r = new AudioModule.AudioRecorder(opts);
    r.addListener('recordingStatusUpdate', (status: any) => {
      if (typeof status.metering === 'number') _meteringBuffer.push(status.metering);
    });
    await r.prepareToRecordAsync(opts);
    r.record();
    return r;
  } catch { return null; }
}

async function finalizeFallbackChunk(
  recorder: AnyRecorder,
  chunkStart: number,
  events: AudioEvent[],
): Promise<void> {
  const nonQuiet = events.filter((e) => e.type !== 'quiet');
  try {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    if (nonQuiet.length > 0) {
      const dest = CLIPS_DIR + `clip_${chunkStart}.m4a`;
      await FileSystem.moveAsync({ from: uri, to: dest }).catch(async () => {
        await FileSystem.copyAsync({ from: uri, to: dest });
        await FileSystem.deleteAsync(uri, { idempotent: true });
      });
      nonQuiet.forEach((e) => { e.clipUri = dest; });
    } else {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch { /* ok */ }
}

function classifyFallbackEpoch(levels: number[]): AudioEvent {
  const ts   = Date.now();
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  const peak = Math.max(...levels);
  let type: AudioEvent['type'];
  if (peak > -8)         type = 'loud_event';
  else if (mean > -20)   type = 'talking';
  else if (mean > -35)   type = 'snoring';
  else                   type = 'quiet';
  return { timestamp: ts, db: Math.round(mean * 10) / 10, peakDb: Math.round(peak * 10) / 10, peaks: 0, type };
}

// ─── Motion-based inference (last resort) ────────────────────────────────────

export function feedMotionSample(magnitude: number): void {
  if (!_usingMic && !_usingNative && _onEvent) _motionBuffer.push({ magnitude, t: Date.now() });
}

function classifyMotionEpoch(samples: MotionSample[]): AudioEvent {
  const ts = Date.now();
  if (samples.length === 0) return { timestamp: ts, db: -100, type: 'quiet', peaks: 0 };
  const mags  = samples.map((s) => s.magnitude);
  const mean  = mags.reduce((a, b) => a + b, 0) / mags.length;
  const peak  = Math.max(...mags);
  const thresh = mean + 0.02;
  let peaks = 0, prevAbove = false;
  for (const m of mags) { const above = m > thresh; if (above && !prevAbove) peaks++; prevAbove = above; }
  const pDb = Math.max(-100, Math.min(0, -100 + mean * 1000));
  let type: AudioEvent['type'];
  if (peak > 0.18) type = 'loud_event';
  else if (mean > 0.06) type = 'talking';
  else if (peaks >= 4 && mean > 0.015) type = 'snoring';
  else type = 'quiet';
  return { timestamp: ts, db: Math.round(pDb * 10) / 10, peakDb: Math.round((-100 + peak * 1000) * 10) / 10, peaks, type };
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export function audioTypeLabel(type: AudioEvent['type']): string {
  switch (type) {
    case 'snoring':    return 'SNORING';
    case 'talking':    return 'SLEEP TALKING';
    case 'loud_event': return 'LOUD SOUND';
    default:           return 'QUIET';
  }
}

export function audioTypeIcon(type: AudioEvent['type']): string {
  switch (type) {
    case 'snoring':    return '😴';
    case 'talking':    return '💬';
    case 'loud_event': return '💥';
    default:           return '🔇';
  }
}
