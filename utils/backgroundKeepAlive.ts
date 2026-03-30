/**
 * backgroundKeepAlive
 *
 * Plays a looped silent WAV via expo-audio so iOS keeps the JS thread alive
 * all night during sleep tracking. Without this, iOS suspends the JS thread
 * ~3 minutes after the screen locks, halting setInterval and sensor callbacks.
 *
 * Requires UIBackgroundModes: ["audio"] in app.json (already set).
 */

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SILENCE_ASSET = require('../assets/silence.wav');

let _player: AudioPlayer | null = null;

export async function startBackgroundKeepAlive(): Promise<void> {
  try {
    // Configure audio session: play through silent mode, stay alive in background
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    });

    if (_player) {
      // Already running — nothing to do
      return;
    }

    _player = createAudioPlayer(SILENCE_ASSET);
    _player.loop = true;
    _player.volume = 0;   // completely inaudible
    _player.play();
  } catch (e) {
    console.warn('[BackgroundKeepAlive] failed to start:', e);
  }
}

export function stopBackgroundKeepAlive(): void {
  try {
    if (_player) {
      _player.pause();
      _player.remove();
      _player = null;
    }
  } catch (e) {
    // no-op
  }
}
