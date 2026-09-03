// The alarm evaluator. Pure — no DOM, no clock, no BLE. Given a step's alarm
// definitions, an instance's alarm runtime state, and a fresh reading, decides
// which alarms fire, which re-arm, and which are currently sounding.
//
// Alarm definition shapes (owned by recipe.js, read-only here):
//   { id, kind: "time"|"duration", name, atMs, repeat, intervalMs, theme }
//   { id, kind: "temperature", name, thresholdC, direction: "heating"|"cooling", theme }
// The data-loss alarm is not a step-defined alarm — it is implicit, evaluated
// automatically whenever hasTempInterest is true, per the spec's "Bluetooth
// specification" section (an app-wide alarm theme, not one the user creates).
export const DATA_LOSS_ALARM_ID = "__dataLoss";

export const DEFAULT_DEADBAND_C = 2;
export const DATA_LOSS_TIMEOUT_MS = 5000;

// Fresh runtime state for a step's alarms — call at Start and at Restart
// (Restart re-arms every time alarm; temperature alarms re-arm by temperature,
// not time, so they are NOT reset here even on Restart).
export function initAlarmState(stepAlarmDefs) {
  const state = {};
  for (const def of stepAlarmDefs) {
    if (def.kind === "temperature") {
      state[def.id] = { armed: true, sounding: false, firedAt: null, lastAboveThreshold: null };
    } else {
      // "time" and "duration" share the same one-shot/repeating shape.
      state[def.id] = { firedCount: 0, sounding: false, firedAt: null };
    }
  }
  state[DATA_LOSS_ALARM_ID] = { armed: true, sounding: false, firedAt: null };
  return state;
}

// Restart re-arms time alarms only — temperature alarms keep their armed/
// lastAboveThreshold state, since a restart doesn't change the thermometer.
export function reArmOnRestart(alarmState, stepAlarmDefs) {
  const next = { ...alarmState };
  for (const def of stepAlarmDefs) {
    if (def.kind !== "temperature") {
      next[def.id] = { firedCount: 0, sounding: false, firedAt: null };
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
 * @param {number} p.elapsedRunningMs - running-only elapsed ms (excludes pauses)
 * @param {boolean} p.isRunning - instance.status === "running"
 * @param {boolean} p.claimed - this instance currently holds the claim
 * @param {number|null} p.msSinceLastPacket - raw connectivity fact, or null if never connected
 * @param {boolean} p.measured - provenance's "Measured" (claimed, within timeout, reading valid)
 * @param {number|null} p.tempC - current raw reading, or null if unusable
 * @param {number} p.now - epoch ms; the only clock read, and only for firedAt
 *   ordering — everything else in this module is a pure function of its inputs.
 *   firedAt must be on one consistent clock across all three alarm kinds
 *   (temperature/time/data-loss) so "earliest to fire" comparisons are valid
 *   across kinds, not just within one — elapsedRunningMs and msSinceLastPacket
 *   are on different scales and would silently break that ordering.
 * @returns {{alarmState: object, newlyFired: Array, sounding: Array}}
 */
export function evaluateAlarms({
  stepAlarmDefs,
  hasTempInterest,
  alarmState,
  elapsedRunningMs,
  isRunning,
  claimed,
  msSinceLastPacket,
  measured,
  tempC,
  now,
}) {
  const next = { ...alarmState };
  const newlyFired = [];

  for (const def of stepAlarmDefs) {
    const prev = next[def.id];
    if (def.kind === "temperature") {
      next[def.id] = evaluateTemperatureAlarm(def, prev, measured, tempC, now, newlyFired);
    } else if (isRunning) {
      // Time/duration alarms only advance against running elapsed time.
      next[def.id] = evaluateTimeAlarm(def, prev, elapsedRunningMs, now, newlyFired);
    }
  }

  next[DATA_LOSS_ALARM_ID] = evaluateDataLossAlarm(
    next[DATA_LOSS_ALARM_ID],
    claimed,
    hasTempInterest,
    msSinceLastPacket,
    now,
    newlyFired
  );

  const sounding = soundingInFireOrder(next);
  return { alarmState: next, newlyFired, sounding };
}

function evaluateTemperatureAlarm(def, prev, measured, tempC, now, newlyFired) {
  if (!measured || tempC == null) return prev; // no live data — frozen, no crossing detection

  const isAbove = tempC > def.thresholdC;
  let { armed, sounding, firedAt, lastAboveThreshold } = prev;

  if (lastAboveThreshold === null) {
    // First observation establishes a baseline — never fires on this sample,
    // which is exactly the "starts already above threshold, never fires" rule.
    return { ...prev, lastAboveThreshold: isAbove };
  }

  const crossedUp = lastAboveThreshold === false && isAbove === true;
  const crossedDown = lastAboveThreshold === true && isAbove === false;
  const fires = def.direction === "heating" ? crossedUp : crossedDown;

  if (fires && armed) {
    sounding = true;
    firedAt = now;
    armed = false;
    newlyFired.push({ id: def.id, kind: def.kind, name: def.name, theme: def.theme });
  }

  // Deadband re-arm: heating re-arms below T-deadband, cooling above T+deadband.
  if (!armed) {
    const reArmed =
      def.direction === "heating"
        ? tempC < def.thresholdC - DEFAULT_DEADBAND_C
        : tempC > def.thresholdC + DEFAULT_DEADBAND_C;
    if (reArmed) armed = true;
  }

  return { armed, sounding, firedAt, lastAboveThreshold: isAbove };
}

function evaluateTimeAlarm(def, prev, elapsedRunningMs, now, newlyFired) {
  let { firedCount, sounding } = prev;
  if (sounding) return prev; // already sounding — no new fire until silenced

  const nextThresholdMs = def.atMs + firedCount * (def.repeat ? def.intervalMs : 0);
  const canFireAgain = def.repeat || firedCount === 0;

  if (canFireAgain && elapsedRunningMs >= nextThresholdMs) {
    newlyFired.push({ id: def.id, kind: def.kind, name: def.name, theme: def.theme });
    return { firedCount: firedCount + 1, sounding: true, firedAt: now };
  }
  return prev;
}

function evaluateDataLossAlarm(prev, claimed, hasTempInterest, msSinceLastPacket, now, newlyFired) {
  let { armed, sounding, firedAt } = prev;
  const applies = claimed && hasTempInterest;

  // Any packet arrival re-arms it — a fresh loss episode gets its own alert.
  if (msSinceLastPacket != null && msSinceLastPacket < DATA_LOSS_TIMEOUT_MS) {
    armed = true;
  }

  if (applies && armed && msSinceLastPacket != null && msSinceLastPacket >= DATA_LOSS_TIMEOUT_MS) {
    sounding = true;
    firedAt = now;
    armed = false;
    newlyFired.push({ id: DATA_LOSS_ALARM_ID, kind: "dataLoss", name: "Data loss", theme: null });
  }

  return { armed, sounding, firedAt };
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
