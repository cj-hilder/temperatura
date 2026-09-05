// The client half of the notification protocol. A pure core (dueNags) plus a
// thin stateful wrapper — the same split as alarms.js/app.js. Routes actual
// firing alarms through vibrate/notification, one independently-silenceable
// tag per alarm (see alarms.js's silenceById), unlike the thermometer's
// single physical button.

export const NAG_INTERVAL_MS = 5000;

/**
 * Pure. Given the alarms currently sounding and when each was last nagged,
 * returns which are due right now — immediately the first time an alarm
 * appears (no prior timestamp), then every NAG_INTERVAL_MS after that per
 * alarm — plus the updated timestamp map. Cadence is identical whether the
 * app is visible or hidden (spec change from the platform spike phase); only
 * the delivery mechanism the caller picks differs, not this timing.
 *
 * @param {Array<{id: string}>} soundingAlarms
 * @param {Object<string, number>} lastNagAt
 * @param {number} now
 * @returns {{due: Array, lastNagAt: Object<string, number>}}
 */
export function dueNags(soundingAlarms, lastNagAt, now) {
  const due = [];
  const next = {};
  for (const alarm of soundingAlarms) {
    const last = lastNagAt[alarm.id];
    if (last == null || now - last >= NAG_INTERVAL_MS) {
      due.push(alarm);
      next[alarm.id] = now;
    } else {
      next[alarm.id] = last;
    }
  }
  // Alarms no longer sounding don't need their bookkeeping kept — if the same
  // id sounds again later it should nag immediately, not inherit a stale
  // timestamp from a previous, unrelated occurrence.
  return { due, lastNagAt: next };
}

/**
 * A single shared ticker (not one timer per alarm) driving dueNags against
 * whatever the caller currently reports as sounding.
 * @param {object} deps
 * @param {(pattern: number[]) => void} deps.vibrate
 * @param {(alarm: {id, title, body, vibrate}) => void} deps.postToSW
 * @param {() => string} [deps.visibilityState] - injectable for tests;
 *   defaults to document.visibilityState.
 */
export function createNotifyRouter({ vibrate, postToSW, visibilityState }) {
  const getVisibility = visibilityState || (() => document.visibilityState);
  let lastNagAt = {};
  let timerId = null;

  function tick(soundingAlarms, now = Date.now()) {
    const result = dueNags(soundingAlarms, lastNagAt, now);
    lastNagAt = result.lastNagAt;
    for (const alarm of result.due) {
      if (getVisibility() === "visible") vibrate(alarm.vibrate);
      else postToSW(alarm);
    }
    return result.due;
  }

  // A one-time notification, outside the nag cadence above — for an alarm
  // that just went missed. Missed alarms are deliberately absent from
  // `sounding` (they no longer make noise), so `tick()`'s dueNags loop never
  // sees them; this is the caller's own way to still tell the user, exactly
  // once per transition, while hidden. While visible there's nothing to do —
  // the in-app UI already shows it, matching tick()'s own visible-path
  // silence (no notification is ever posted while visible).
  function notifyOnce(alarm) {
    if (getVisibility() !== "visible") postToSW(alarm);
  }

  function start(getSoundingAlarms, intervalMs = 1000) {
    stop();
    timerId = setInterval(() => tick(getSoundingAlarms()), intervalMs);
  }

  function stop() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    lastNagAt = {};
  }

  return { tick, start, stop, notifyOnce };
}
