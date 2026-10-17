// The alarm evaluator. Pure — no DOM, no clock, no BLE. Given a step's alarm
// definitions, an instance's alarm runtime state, and a fresh reading, decides
// which alarms fire, which re-arm, and which are currently sounding.
//
// Alarm definition shapes (owned by recipe.js, read-only here):
//   { id, kind: "time"|"duration", name, atMs, repeat, intervalMs, theme, silenceAfterMs }
//   { id, kind: "temperature", name, thresholdC, direction: "heating"|"cooling", oneShot, theme, silenceAfterMs }
// `silenceAfterMs` is resolved by the caller (engine.js, from the def's theme)
// before stepAlarmDefs ever reaches this module — alarms.js stays theme-
// agnostic, it only ever sees a plain number.
// The data-loss alarm is not a step-defined alarm — it is implicit, evaluated
// automatically whenever hasTempInterest is true, per the spec's "Bluetooth
// specification" section (an app-wide alarm theme, not one the user creates).
export const DATA_LOSS_ALARM_ID = "__dataLoss";

// Re-arm hysteresis for an "every time" temperature alarm: after firing, it
// re-arms once the reading has gone back across the threshold and then gone
// this many readings OR this long, whichever comes first, without any reading
// over the threshold again. Both limits, because probes differ:
// an FTHERM reports ~1.3×/s, so 5 readings re-arm it in ~4 s, while a BBQ
// only reports when its value changes — a steady reading back across the
// threshold may send nothing more, so for it the time limit is what applies.
// (This replaced a 2 °C deadband, which in practice often never re-armed at
// all: a pan backing off a degree and coming back is exactly what the user
// wants to hear about again.)
export const REARM_SAMPLES = 5;
export const REARM_MS = 5000;
export const DATA_LOSS_TIMEOUT_MS = 5000;
// Fallback only — a real def/theme always supplies its own resolved
// silenceAfterMs (see alarmPlayer.js's DEFAULT_SILENCE_AFTER_SECONDS, the
// value this mirrors in ms for the one caller — evaluateAlarms's
// dataLossSilenceAfterMs default — that has no theme lookup of its own to
// fall back on).
export const DEFAULT_SILENCE_AFTER_MS = 120_000;

// Fresh runtime state for one alarm def, keyed off its kind. Shared by
// initAlarmState (every def, at Start) and evaluateAlarms' fallback below (one
// def at a time, for a def with no existing entry — see there for why that
// case exists at all).
function freshAlarmState(def) {
  return def.kind === "temperature"
    ? { armed: true, sounding: false, missed: false, firedAt: null, lastSide: null, rearm: null, seenN: null }
    : { firedCount: 0, unanswered: 0, sounding: false, missed: false, firedAt: null }; // "time" and "duration" share this shape.
}

// Fresh runtime state for a step's alarms — call at Start only. Restart goes
// through reArmOnRestart instead, which keeps an "every time" temperature
// alarm's state (it re-arms by temperature, not by time).
export function initAlarmState(stepAlarmDefs) {
  const state = {};
  for (const def of stepAlarmDefs) {
    state[def.id] = freshAlarmState(def);
  }
  state[DATA_LOSS_ALARM_ID] = { armed: true, sounding: false, missed: false, firedAt: null };
  return state;
}

// Restart re-arms time alarms and "once" temperature alarms — a "once" alarm
// fires once per run of the step, and a restart is a fresh run. An "every
// time" temperature alarm keeps its armed/lastSide state: it re-arms by
// temperature, and a restart doesn't change the thermometer. `missed` is
// cleared for EVERY kind: a missed status left over from the previous run
// has nothing to do with this one.
export function reArmOnRestart(alarmState, stepAlarmDefs) {
  const next = { ...alarmState };
  for (const def of stepAlarmDefs) {
    // Same missing-entry fallback as evaluateAlarms uses (a def can be added
    // to a running step via an edit, after alarmState was last built) —
    // freshAlarmState, not a bare {missed:false}, so a temperature def that
    // never had an entry gets a real armed/lastSide baseline instead of
    // undefined fields.
    const prev = next[def.id] ?? freshAlarmState(def);
    if (def.kind !== "temperature") {
      next[def.id] = { firedCount: 0, unanswered: 0, sounding: false, missed: false, firedAt: null };
    } else if (def.oneShot) {
      // lastSide is kept: re-armed, but it still needs a real crossing from
      // wherever the reading is now, never an instant fire.
      next[def.id] = { ...prev, armed: true, rearm: null, missed: false };
    } else {
      next[def.id] = { ...prev, missed: false };
    }
  }
  return next;
}

/**
 * One evaluation pass. Called whenever there's something new to react to: a
 * fresh BLE sample, a claim change, a pause/resume, or a periodic tick while
 * running (time alarms need re-checking even with no new temperature data).
 *
 * @param {object} p
 * @param {Array} p.stepAlarmDefs - the step's time + temperature alarm defs
 * @param {boolean} p.hasTempInterest - step has a temp band or >=1 temp alarm
 * @param {object} p.alarmState - previous per-alarm runtime state map
 * @param {number} p.timeBasisMs - the elapsed-ms metric time/duration alarms
 *   compare their atMs threshold against. Callers (app.js's tick) choose it
 *   per the step's duration kind, matching whatever the progress bar shows
 *   for that instance: running-only elapsed time (excludes pauses) for no
 *   duration or "fixed length", or the in-band accumulation for "in
 *   temperature band" — so the duration-reached alarm and the progress bar
 *   can never disagree about when a duration is reached.
 * @param {boolean} p.isRunning - instance.status === "running"
 * @param {boolean} p.claimed - this instance currently holds the claim
 * @param {number|null} p.msSinceLastPacket - raw connectivity fact, or null if never connected
 * @param {boolean} p.measured - provenance's "Measured" (claimed, within timeout, reading valid)
 * @param {number|null} p.tempC - current raw reading, or null if unusable
 * @param {Array<{n: number, tempC: number, at: number}>|null} [p.readings] -
 *   this instance's probe's recent readings, oldest first, each numbered by a
 *   per-probe counter `n`. Evaluation runs once per tick, not once per
 *   reading, so this is how the re-arm rule still sees EVERY reading — a
 *   brief excursion over the threshold between two ticks must reset it.
 *   null = not available: the tick's own tempC stands in as one reading.
 * @param {number} p.now - epoch ms; the only clock read, used for firedAt
 *   ordering AND for the missed-status timeout below. firedAt must be on one
 *   consistent clock across all three alarm kinds (temperature/time/data-loss)
 *   so "earliest to fire" comparisons are valid across kinds, not just within
 *   one — timeBasisMs and msSinceLastPacket are on different scales and would
 *   silently break that ordering.
 * @param {number} [p.dataLossSilenceAfterMs] - the data-loss alarm's own
 *   silence-after duration. It has no step-owned def to carry a per-alarm
 *   `silenceAfterMs` field (see below), so it's passed separately.
 * @returns {{alarmState: object, newlyFired: Array, sounding: Array}}
 */
export function evaluateAlarms({
  stepAlarmDefs,
  hasTempInterest,
  alarmState,
  timeBasisMs,
  isRunning,
  claimed,
  msSinceLastPacket,
  measured,
  tempC,
  readings = null,
  now,
  dataLossSilenceAfterMs = DEFAULT_SILENCE_AFTER_MS,
}) {
  const next = { ...alarmState };
  const newlyFired = [];

  for (const def of stepAlarmDefs) {
    // A step can be edited while an instance is running (spec: "edits take
    // effect immediately"), so a def can arrive here with no matching entry —
    // e.g. a temperature band, and the band-boundary alarms it implies, added
    // after this instance's alarmState was built at Start. Treat that exactly
    // like it existed since Start rather than crashing on undefined: this def
    // gets a fresh baseline now, same as reaching Start would have given it.
    const prev = next[def.id] ?? freshAlarmState(def);
    const silenceAfterMs = def.silenceAfterMs ?? DEFAULT_SILENCE_AFTER_MS;
    if (def.kind === "temperature") {
      next[def.id] = applyMissedTransition(
        evaluateTemperatureAlarm(def, prev, measured, tempC, readings, now, newlyFired),
        silenceAfterMs,
        now
      );
    } else if (isRunning) {
      next[def.id] = applyMissedTransition(
        evaluateTimeAlarm(def, prev, timeBasisMs, now, newlyFired),
        silenceAfterMs,
        now
      );
    }
  }

  next[DATA_LOSS_ALARM_ID] = applyMissedTransition(
    evaluateDataLossAlarm(
      next[DATA_LOSS_ALARM_ID],
      claimed,
      hasTempInterest,
      msSinceLastPacket,
      now,
      newlyFired
    ),
    dataLossSilenceAfterMs,
    now
  );

  const sounding = soundingInFireOrder(next);
  return { alarmState: next, newlyFired, sounding };
}

// An alarm left sounding for silenceAfterMs with nobody acknowledging it goes
// to "missed" — audio and vibration stop (it simply falls out of `sounding`,
// which is all the tick loop and notify router look at to decide what's
// currently making noise), but the alarm stays outstanding until dismissed
// rather than quietly going back to idle. Wall-clock based (now - firedAt),
// so it applies the same whether the instance is running or paused — an
// alarm nobody answered doesn't care whether the step itself is paused.
function applyMissedTransition(state, silenceAfterMs, now) {
  if (state.sounding && state.firedAt != null && now - state.firedAt >= silenceAfterMs) {
    return { ...state, sounding: false, missed: true };
  }
  return state;
}

// Which side of the threshold a reading is on, judged on the reading rounded
// to 0.1 °C — the resolution the app displays — so an alarm always agrees
// with the number on screen. Exactly at the threshold is its own side,
// neither past it nor back from it: a heating alarm at 70 fires on 70.1, and
// re-arms only from 69.9 or below. Compared in integer tenths so float noise
// (21.35 * 10 = 213.4999…) can't decide which side a reading lands on.
export function thresholdSide(tempC, thresholdC) {
  const r = Math.round(tempC * 10);
  const t = Math.round(thresholdC * 10);
  return r > t ? "above" : r < t ? "below" : "at";
}

// State saved before `lastSide` existed has `lastAboveThreshold` instead —
// true/false meant above / not above.
function lastSideOf(prev) {
  if (prev.lastSide !== undefined) return prev.lastSide;
  if (prev.lastAboveThreshold == null) return null;
  return prev.lastAboveThreshold ? "above" : "below";
}

// The readings this evaluation hasn't seen yet. Without a usable bookmark —
// first evaluation, right after a data gap, or a counter that went backwards
// because a different probe is in use now — only the latest reading is
// taken: anything older is from a stretch nobody was watching for this alarm.
function unseenReadings(readings, seenN) {
  const latest = readings[readings.length - 1];
  if (seenN == null || latest.n < seenN) return [latest];
  return readings.filter((r) => r.n > seenN);
}

function evaluateTemperatureAlarm(def, prev, measured, tempC, readings, now, newlyFired) {
  // No live data: frozen, no crossing detection. A re-arm in progress starts
  // over — "without going over the threshold again" can't vouch for time
  // nobody observed — and the reading bookmark is dropped for the same reason.
  if (!measured || tempC == null) {
    return prev.rearm || prev.seenN != null ? { ...prev, rearm: null, seenN: null } : prev;
  }

  const side = thresholdSide(tempC, def.thresholdC);
  const lastSide = lastSideOf(prev);
  let { armed, sounding, missed, firedAt } = prev;
  let rearm = prev.rearm ?? null;
  const hasReadings = !!readings && readings.length > 0;
  const fresh = hasReadings ? unseenReadings(readings, prev.seenN ?? null) : [{ tempC, at: now }];
  const seenN = hasReadings ? readings[readings.length - 1].n : null;
  // Heating fires on reaching "above" from anywhere else; cooling mirrors it.
  const firingSide = def.direction === "heating" ? "above" : "below";
  const farSide = def.direction === "heating" ? "below" : "above";

  if (lastSide === null) {
    // First observation establishes a baseline — never fires on this sample,
    // which is exactly the "starts already above threshold, never fires" rule.
    return { armed, sounding, missed, firedAt, lastSide: side, rearm, seenN };
  }

  const fires = side === firingSide && lastSide !== firingSide;

  // A fresh crossing fires and re-sounds even if the PREVIOUS occurrence is
  // still sounding or sitting missed-and-undismissed — there is only one
  // state slot per alarm id (no history of occurrences), so this fire
  // naturally replaces it (sounding:true, missed:false), which is exactly
  // "retriggering dismisses the earlier occurrence": the user would rather
  // be alerted to the new crossing than have it silently swallowed because
  // they hadn't gotten around to dismissing the old one.
  if (fires && armed) {
    sounding = true;
    missed = false;
    firedAt = now;
    armed = false;
    newlyFired.push({ id: def.id, kind: def.kind, name: def.name, theme: def.theme });
  }

  // Re-arm ("every time" only — a "once" alarm stays spent until Restart).
  // The count starts at a reading back across the threshold by any amount;
  // every later reading that isn't over the threshold adds one (exactly AT
  // it isn't over it), and any reading over it cancels the count, so it has
  // to start again from the next reading back across. Re-armed after
  // REARM_SAMPLES readings or REARM_MS since the count started.
  if (armed || def.oneShot) {
    rearm = null;
  } else {
    for (const r of fresh) {
      const rSide = thresholdSide(r.tempC, def.thresholdC);
      if (rSide === firingSide) rearm = null;
      else if (rearm) rearm = { ...rearm, count: rearm.count + 1 };
      else if (rSide === farSide) rearm = { at: r.at, count: 1 };
    }
    if (rearm && (rearm.count >= REARM_SAMPLES || now - rearm.at >= REARM_MS)) {
      armed = true;
      rearm = null;
    }
  }

  return { armed, sounding, missed, firedAt, lastSide: side, rearm, seenN };
}

function evaluateTimeAlarm(def, prev, timeBasisMs, now, newlyFired) {
  const { firedCount } = prev;
  // No "already sounding" guard here — a repeating alarm's next interval
  // firing must retrigger (and so implicitly dismiss, by replacing this
  // alarm id's one state slot) a previous occurrence that's still sounding
  // OR sitting missed-and-undismissed: the whole point of "repeating" is
  // that the user doesn't want to miss the NEXT interval just because they
  // hadn't gotten around to acknowledging the last one. A one-shot alarm
  // (repeat: false, which the duration-reached alarm always is) can't
  // refire regardless — it is "due" once and only once, independent of
  // sounding/missed state.
  //
  // `due` is how many occurrences have come round by now, not just whether
  // the next one has. Several can be due at once — a repeating alarm added
  // to a step that has already been running for hours, or an app reopened
  // after a long kill — and they fire together as ONE alert. Advancing one
  // occurrence per evaluation instead re-fired the alarm every tick until it
  // caught up: an every-minute alarm added two hours in sounded and
  // re-notified 120 times in two minutes.
  if (timeBasisMs < def.atMs) return prev;
  const due = def.repeat ? Math.floor((timeBasisMs - def.atMs) / def.intervalMs) + 1 : 1;
  if (due <= firedCount) return prev;

  // How many occurrences this one alert now stands for: the ones just come
  // due, plus — if the previous occurrence is still unanswered (sounding or
  // missed) — however many that one already stood for. Answering it (one
  // Silence or Dismiss) clears them all; the count starts again from the
  // next occurrence. Shown as "every 1:00 for 120x" (stepDisplay.js).
  const outstanding = prev.sounding || prev.missed;
  const unanswered = (outstanding ? prev.unanswered ?? 1 : 0) + (due - firedCount);
  newlyFired.push({ id: def.id, kind: def.kind, name: def.name, theme: def.theme });
  return { firedCount: due, unanswered, sounding: true, missed: false, firedAt: now };
}

function evaluateDataLossAlarm(prev, claimed, hasTempInterest, msSinceLastPacket, now, newlyFired) {
  let { armed, sounding, missed, firedAt } = prev;
  const applies = claimed && hasTempInterest;

  // Any packet arrival re-arms it — a fresh loss episode gets its own alert,
  // same re-arm-then-retrigger shape as a temperature alarm: a NEW loss
  // episode fires and re-sounds even over a still-sounding or still-missed
  // earlier one, replacing it (see evaluateTemperatureAlarm's comment).
  if (msSinceLastPacket != null && msSinceLastPacket < DATA_LOSS_TIMEOUT_MS) {
    armed = true;
  }

  if (applies && armed && msSinceLastPacket != null && msSinceLastPacket >= DATA_LOSS_TIMEOUT_MS) {
    sounding = true;
    missed = false;
    firedAt = now;
    armed = false;
    newlyFired.push({ id: DATA_LOSS_ALARM_ID, kind: "dataLoss", name: "Data loss", theme: null });
  }

  return { armed, sounding, missed, firedAt };
}

function soundingInFireOrder(alarmState) {
  return Object.entries(alarmState)
    .filter(([, s]) => s.sounding)
    .sort((a, b) => (a[1].firedAt ?? 0) - (b[1].firedAt ?? 0))
    .map(([id]) => id);
}

// Silences exactly the earliest-fired currently-sounding alarm. A repeating
// time alarm keeps its firedCount (so the next interval can fire again); a
// one-shot / temperature / data-loss alarm just clears `sounding` — re-firing
// is governed by their own re-arm rules, not by silencing.
export function silenceEarliest(alarmState) {
  const order = soundingInFireOrder(alarmState);
  if (order.length === 0) return { alarmState, silencedId: null };
  const id = order[0];
  return {
    alarmState: { ...alarmState, [id]: { ...alarmState[id], sounding: false } },
    silencedId: id,
  };
}

// Silences one specific alarm by id, regardless of fire order. Unlike the
// thermometer's single physical button (which has no way to target a
// specific alarm and so must fall back to earliest-first), both the
// notification's Silence action and the in-app per-alarm control silence
// exactly the alarm they belong to (build-plan §7 decision #2).
export function silenceById(alarmState, alarmId) {
  if (!alarmState[alarmId]?.sounding) return { alarmState, silencedId: null };
  return {
    alarmState: { ...alarmState, [alarmId]: { ...alarmState[alarmId], sounding: false } },
    silencedId: alarmId,
  };
}

// Clears a missed alarm's outstanding status. Distinct from silencing — a
// missed alarm has nothing currently sounding to silence, it just needs
// acknowledging so it can go back to idle. A repeating time alarm, a
// temperature alarm, or the data-loss alarm will all clear this on their own
// the moment they next retrigger (see their evaluators above) — this is for
// dismissing it explicitly beforehand, and is the ONLY way to clear a
// one-shot time alarm or the duration-reached alarm, since those never
// retrigger on their own.
export function dismissById(alarmState, alarmId) {
  if (!alarmState[alarmId]?.missed) return { alarmState, dismissedId: null };
  return {
    alarmState: { ...alarmState, [alarmId]: { ...alarmState[alarmId], missed: false } },
    dismissedId: alarmId,
  };
}

// The thermometer button is a single shared physical input across every
// running instance, not scoped to one step — spec: "if multiple alarms are
// firing the button press silences the earliest one to fire," with no
// mention of restricting that to one step. This compares fire order across
// every instance's alarm state at once, unlike silenceEarliest which only
// looks within one.
// @param {Array<{instanceId: string, alarmState: object}>} instances
// @returns {{instanceId: string, alarmId: string} | null}
export function earliestSoundingAcrossInstances(instances) {
  let best = null;
  for (const { instanceId, alarmState } of instances) {
    for (const [alarmId, state] of Object.entries(alarmState)) {
      if (!state.sounding) continue;
      const firedAt = state.firedAt ?? 0;
      if (best === null || firedAt < best.firedAt) {
        best = { instanceId, alarmId, firedAt };
      }
    }
  }
  return best ? { instanceId: best.instanceId, alarmId: best.alarmId } : null;
}

// The generalized version of the above for the global alarm overlay, the
// thermometer button, and the back button once missed status exists: a
// missed alarm is exactly as outstanding as a sounding one, and "earliest"
// spans both — resolving it means silencing if it's still sounding, or
// dismissing if it's already missed. Kept alongside
// earliestSoundingAcrossInstances rather than replacing it, since a caller
// that only ever needs "what's currently sounding" (unrelated to resolving
// it) still has that narrower function available.
// @param {Array<{instanceId: string, alarmState: object}>} instances
// @returns {{instanceId: string, alarmId: string, missed: boolean} | null}
export function earliestOutstandingAcrossInstances(instances) {
  let best = null;
  for (const { instanceId, alarmState } of instances) {
    for (const [alarmId, state] of Object.entries(alarmState)) {
      if (!state.sounding && !state.missed) continue;
      const firedAt = state.firedAt ?? 0;
      if (best === null || firedAt < best.firedAt) {
        best = { instanceId, alarmId, firedAt, missed: state.missed };
      }
    }
  }
  return best ? { instanceId: best.instanceId, alarmId: best.alarmId, missed: best.missed } : null;
}

/* ==========================================================================
 * Which alarm theme applies?
 * ========================================================================== */

// Params are passed in rather than imported (storage.js's DEFAULT_THEME_ID,
// app.js's data-loss theme setting) so this module keeps its zero-imports
// shape — it stays a pure function of its own inputs either way.
//
// The data-loss alarm isn't a step-defined alarm (it's synthesized in
// evaluateDataLossAlarm, always with `theme: null` on its newlyFired entry —
// see there), so it alone needs the separate global setting instead of a
// per-alarm theme field.
export function themeIdForFiredAlarm(fired, { dataLossThemeId, defaultThemeId }) {
  if (fired.kind === "dataLoss") return dataLossThemeId || defaultThemeId;
  return fired.theme || defaultThemeId;
}

// Same decision, but for an alarm id with no `newlyFired` entry in hand
// (e.g. resolving vibrate for every currently-sounding alarm each tick,
// not just the ones that just fired) — looks the def back up by id instead.
export function themeIdForAlarmId(alarmId, stepAlarmDefs, { dataLossThemeId, defaultThemeId }) {
  if (alarmId === DATA_LOSS_ALARM_ID) return dataLossThemeId || defaultThemeId;
  return stepAlarmDefs.find((d) => d.id === alarmId)?.theme || defaultThemeId;
}
