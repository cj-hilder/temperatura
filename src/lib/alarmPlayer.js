// Alarm playback. Real Web Audio API only — decodeAudioData and oscillators
// don't exist in Node, so this is verified on-device (like thermometer.js's
// WebBluetoothBackend) rather than unit tested end-to-end. isSoundTooLong is
// the one genuinely pure piece.
//
// Every voice MUST be created on the caller's keep-alive AudioContext, never
// a fresh one — that context is the only audio path proven to survive
// backgrounding on this platform (see useKeepAlive.js).

export const MAX_SOUND_SECONDS = 5;
const SYNTH_REPEAT_INTERVAL_MS = 1500;

export function isSoundTooLong(durationSeconds, maxSeconds = MAX_SOUND_SECONDS) {
  return durationSeconds > maxSeconds;
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
 * AudioBuffer, loops it for real. Otherwise plays a synthesized default tone,
 * rescheduling itself until stopped — the spec's "loops until silenced" rule
 * applied to a repeating cue instead of a one-shot, since an alarm can't stop
 * itself. One persistent gain node carries the ramp-in (once, at start, per
 * spec — never re-applied per loop); every voice — real or synthesized —
 * plays through it.
 */
export function playAlarm(audioCtx, alarmId, { buffer = null, rampSeconds = 0 } = {}) {
  stopAlarm(alarmId); // idempotent — restarting an id never stacks voices

  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + Math.max(0, rampSeconds));
  masterGain.connect(audioCtx.destination);

  if (buffer) {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(masterGain);
    source.start();
    activeVoices.set(alarmId, {
      stop() {
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect();
        masterGain.disconnect();
      },
    });
    return;
  }

  // Synthesized default: paired square-wave beeps, built on ble-hr-tool's own
  // oscillator cue (app.js's "intense" notification sound) — 1100Hz, an
  // exponential decay — rescheduled every ~1.5s instead of playing once,
  // since Temperatura's alarms must nag until silenced and Manawa's don't.
  let timerId = null;
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
    timerId = setTimeout(scheduleBeepPair, SYNTH_REPEAT_INTERVAL_MS);
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
