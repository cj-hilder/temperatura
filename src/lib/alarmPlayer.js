// Alarm playback. Real Web Audio API only — decodeAudioData and oscillators
// don't exist in Node, so this is verified on-device (like thermometer.js's
// WebBluetoothBackend) rather than unit tested end-to-end. isSoundTooLong is
// the one genuinely pure piece.
//
// Every voice MUST be created on the caller's keep-alive AudioContext, never
// a fresh one — that context is the only audio path proven to survive
// backgrounding on this platform (see useKeepAlive.js).

export const MAX_SOUND_SECONDS = 5;
// How long an alarm sounds unanswered before going to missed status — the
// spec's own default. Per-theme (resolvePlaybackParams below), not global.
export const DEFAULT_SILENCE_AFTER_SECONDS = 120;
// The synthesized cue's own beep-pair takes this long to play, independent
// of any theme setting — the repeat interval is silence added AFTER it.
const SYNTH_BEEP_PAIR_SECONDS = 0.4;

export function isSoundTooLong(durationSeconds, maxSeconds = MAX_SOUND_SECONDS) {
  return durationSeconds > maxSeconds;
}

// Pulls the three playback-affecting fields out of a theme record, with
// fallbacks matching the bundled default theme's own seeded values — for a
// theme that's missing (deleted out from under an alarm still referencing
// its id) or partially-shaped, rather than passing `undefined` into
// playAlarm/the vibrate call.
export function resolvePlaybackParams(theme) {
  return {
    rampSeconds: theme?.rampSeconds ?? 2,
    vibrate: theme?.vibrate ?? true,
    repeatIntervalSeconds: theme?.repeatIntervalSeconds ?? 0,
    silenceAfterMs: (theme?.silenceAfterSeconds ?? DEFAULT_SILENCE_AFTER_SECONDS) * 1000,
  };
}

/**
 * Decodes a picked/stored sound. Resolves to null on any failure rather than
 * throwing — "an alarm must never fail silently," so callers check a value
 * instead of wiring up their own try/catch at every call site.
 */
export async function decodeSound(audioCtx, arrayBuffer) {
  try {
    // decodeAudioData detaches the buffer in some browsers; decode a copy so
    // the caller's original ArrayBuffer (e.g. one read from IndexedDB) is
    // still usable afterwards.
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    return null;
  }
}

const activeVoices = new Map(); // alarmId -> { stop() }

/**
 * Starts (or restarts) the voice for one alarm. If `buffer` is a decoded
 * AudioBuffer, plays it on repeat with `repeatIntervalSeconds` of silence
 * between each play. Otherwise plays a synthesized default tone on the same
 * repeat/gap schedule — the spec's "loops until silenced" rule applied to a
 * repeating cue instead of a one-shot, since an alarm can't stop itself.
 * One persistent gain node carries the ramp-in (once, at start, per spec —
 * never re-applied per repeat); every voice — real or synthesized — plays
 * through it.
 *
 * A real buffer is NOT played via AudioBufferSourceNode.loop: that loops
 * back-to-back with no gap, which is exactly the "no silence between
 * repeats" behaviour the repeat-interval setting exists to fix. Instead each
 * repeat is a fresh one-shot source, rescheduled `duration +
 * repeatIntervalSeconds` later — the same setTimeout-rescheduling shape the
 * synthesized tone already used, now shared by both.
 */
export function playAlarm(audioCtx, alarmId, { buffer = null, rampSeconds = 0, repeatIntervalSeconds = 0 } = {}) {
  stopAlarm(alarmId); // idempotent — restarting an id never stacks voices

  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + Math.max(0, rampSeconds));
  masterGain.connect(audioCtx.destination);

  const gapMs = Math.max(0, repeatIntervalSeconds) * 1000;
  let timerId = null;

  if (buffer) {
    const playOnce = () => {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(masterGain);
      source.start();
      timerId = setTimeout(playOnce, buffer.duration * 1000 + gapMs);
    };
    playOnce();
    activeVoices.set(alarmId, {
      stop() {
        clearTimeout(timerId);
        masterGain.disconnect();
      },
    });
    return;
  }

  // Synthesized default: paired square-wave beeps, built on ble-hr-tool's own
  // oscillator cue (app.js's "intense" notification sound) — 1100Hz, an
  // exponential decay — rescheduled on the same repeat-interval-plus-gap
  // schedule as a real sound, since Temperatura's alarms must nag until
  // silenced and Manawa's don't.
  const scheduleBeepPair = () => {
    [0, 0.22].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const beepGain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1100, audioCtx.currentTime + offset);
      beepGain.gain.setValueAtTime(1, audioCtx.currentTime + offset);
      beepGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + offset + 0.18);
      osc.connect(beepGain);
      beepGain.connect(masterGain);
      osc.start(audioCtx.currentTime + offset);
      osc.stop(audioCtx.currentTime + offset + 0.18);
    });
    timerId = setTimeout(scheduleBeepPair, SYNTH_BEEP_PAIR_SECONDS * 1000 + gapMs);
  };
  scheduleBeepPair();
  activeVoices.set(alarmId, {
    stop() {
      clearTimeout(timerId);
      masterGain.disconnect();
    },
  });
}

export function stopAlarm(alarmId) {
  activeVoices.get(alarmId)?.stop();
  activeVoices.delete(alarmId);
}
