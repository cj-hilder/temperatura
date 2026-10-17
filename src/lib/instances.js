// The instance state machine. Pure — no DOM, no clock read internally (every
// timestamp comes in as a parameter), no BLE. Every quantity is derived from
// stored epoch timestamps, never a tick counter, so recovery after the app is
// killed is just arithmetic — see advanceInBand's comment for why that also
// makes recovery and normal operation the same code path.
import { initAlarmState, reArmOnRestart, DATA_LOSS_TIMEOUT_MS } from "./alarms.js";

export function startInstance({ id, recipeId, stepId, stepAlarmDefs }, now) {
  return {
    id,
    recipeId,
    stepId,
    tag: null,
    status: "running",
    startedAt: now,
    pausedAt: null,
    accumulatedPausedMs: 0,
    accumulatedInBandMs: 0,
    // Time since the reading first entered the temperature band — running
    // time only, and it keeps counting if the reading leaves the band again
    // (see advanceInBand). `enteredBand` says whether that has happened yet.
    accumulatedSinceBandMs: 0,
    enteredBand: false,
    lastSampleAt: now,
    // Every step starts OUT of band: in band is only ever learned from a
    // real reading (see advanceInBand) — or from the user saying so, with
    // "Start in-band timer" (see startInBandManually).
    lastKnownInBand: false,
    manualInBand: false,
    everMeasured: false,
    latchedEstimate: false,
    completedAt: null,
    // A temporary, per-instance addition to the step's own duration — see
    // extendDuration below. Zeroed on every fresh run (Start/Restart/
    // Duplicate), never carried from a previous run of the same step.
    durationExtensionMs: 0,
    alarmState: initAlarmState(stepAlarmDefs),
  };
}

export function pauseInstance(instance, now) {
  if (instance.status !== "running") return instance;
  return { ...instance, status: "paused", pausedAt: now };
}

export function resumeInstance(instance, now) {
  if (instance.status !== "paused") return instance;
  return {
    ...instance,
    status: "running",
    pausedAt: null,
    accumulatedPausedMs: instance.accumulatedPausedMs + (now - instance.pausedAt),
    // Excludes the paused span from in-band accounting too, the same way
    // accumulatedPausedMs excludes it from elapsedRunningMs — the gap is
    // neither in-band nor out-of-band time, it simply didn't happen.
    lastSampleAt: now,
  };
}

export function restartInstance(instance, stepAlarmDefs, now) {
  return {
    ...instance,
    status: "running",
    startedAt: now,
    pausedAt: null,
    accumulatedPausedMs: 0,
    accumulatedInBandMs: 0,
    accumulatedSinceBandMs: 0,
    enteredBand: false,
    lastSampleAt: now,
    lastKnownInBand: false,
    manualInBand: false,
    everMeasured: false,
    latchedEstimate: false,
    completedAt: null,
    // A restart is a fresh run of the step — any temporary extension from a
    // previous run doesn't carry forward, same as accumulated time doesn't.
    durationExtensionMs: 0,
    // Temperature alarms are NOT re-armed here — they re-arm by temperature,
    // not by time, so a restart doesn't change anything about the thermometer.
    alarmState: reArmOnRestart(instance.alarmState, stepAlarmDefs),
  };
}

export function completeInstance(instance, now) {
  return { ...instance, status: "completed", completedAt: now };
}

// "Duplicate: Start another instance of this step" — a fresh instance, not a
// clone: no tag, no accumulated time, no claim (the "never auto-take the
// claim" rule governs this exactly like any other Start).
export function duplicateInstance(instance, newId, stepAlarmDefs, now) {
  return startInstance({ id: newId, recipeId: instance.recipeId, stepId: instance.stepId, stepAlarmDefs }, now);
}

export function setTag(instance, tag) {
  return { ...instance, tag };
}

/**
 * A temporary addition to this ONE instance's duration — the step
 * definition (and every other instance of it) is untouched, per spec: this
 * is temporary, and a permanent change means editing the recipe step.
 * Cumulative: extending twice adds twice — UNLESS the duration alarm is
 * currently missed (see `isMissed` below), in which case cumulation would
 * be pointless or actively wrong: the target it would extend is already in
 * the past.
 *
 * The duration-reached alarm, if it already fired for the un-extended
 * duration, must be able to fire again once the new, later threshold is
 * reached. A plain restart-shaped re-arm won't do — that also zeroes the
 * elapsed clock, which extending must NOT do. So only that one alarm's
 * fired state resets here (mirroring reArmOnRestart's shape for a single
 * id), leaving elapsed time and every other alarm's state untouched.
 *
 * @param {string} [durationAlarmIdToRearm] - the id to re-arm, e.g. from
 *   recipe.js's durationAlarmId(instance.stepId). Omit only if there's
 *   nothing to re-arm (defensive — the caller always has this in practice).
 * @param {object} [opts]
 * @param {boolean} [opts.isMissed] - is the duration alarm currently missed?
 *   A missed duration alarm's target has already lapsed unacknowledged —
 *   possibly a long time ago. Naively adding extraMs to that stale target
 *   (the normal cumulative path) could still land in the past, making the
 *   extension pointless. Per spec: extend FROM NOW instead.
 * @param {number} [opts.originalDurationMs] - the step's own un-extended
 *   duration (step.duration.ms) — only needed when isMissed.
 * @param {number} [opts.currentTimeBasisMs] - the instance's current elapsed
 *   time on the same clock the duration alarm itself fires against (running
 *   time or in-band time, matching app.js's tick — see alarms.js's
 *   timeBasisMs) — only needed when isMissed.
 */
export function extendDuration(instance, extraMs, durationAlarmIdToRearm, { isMissed, originalDurationMs, currentTimeBasisMs } = {}) {
  const priorExtension = instance.durationExtensionMs || 0;
  // Missed: recompute durationExtensionMs so the new target
  // (originalDurationMs + durationExtensionMs) lands exactly extraMs ahead
  // of right now — not cumulative with whatever stale extension existed
  // before, since that stale target is exactly the thing that's already
  // been missed. Not missed: unchanged, ordinary cumulative behavior.
  const addedMs =
    isMissed && originalDurationMs != null && currentTimeBasisMs != null
      ? currentTimeBasisMs + extraMs - originalDurationMs - priorExtension
      : extraMs;
  const next = {
    ...instance,
    durationExtensionMs: priorExtension + addedMs,
  };
  if (durationAlarmIdToRearm && next.alarmState[durationAlarmIdToRearm]) {
    next.alarmState = {
      ...next.alarmState,
      [durationAlarmIdToRearm]: { ...next.alarmState[durationAlarmIdToRearm], firedCount: 0, sounding: false, missed: false, firedAt: null },
    };
  }
  return next;
}

// Running-only elapsed time (excludes paused spans) — what time alarms and
// the duration-reached alarm evaluate against.
export function elapsedRunningMs(instance, now) {
  const openPauseMs = instance.pausedAt != null ? now - instance.pausedAt : 0;
  return now - instance.startedAt - instance.accumulatedPausedMs - openPauseMs;
}

// Total wall-clock elapsed time since start (includes pauses) — for display.
export function elapsedTotalMs(instance, now) {
  return now - instance.startedAt;
}

/**
 * The clock a step's duration counts against — shared by the progress bar,
 * the time/duration alarms and Extend, so they can never disagree about when
 * a duration is reached: time spent in band for "inBand", time since first
 * entering the band for "sinceBand", and plain running time otherwise (no
 * duration, or "fixed length", which the spec pins as never in doubt).
 */
export function durationBasisMs(instance, duration, now) {
  if (duration?.kind === "inBand") return instance.accumulatedInBandMs;
  if (duration?.kind === "sinceBand") return instance.accumulatedSinceBandMs ?? 0;
  return elapsedRunningMs(instance, now);
}

/**
 * Advances in-band accumulation from `instance.lastSampleAt` to `now`. Two
 * different things carry forward differently across that elapsed span:
 *
 *   - in-band/out-of-band-ness carries forward from the LAST KNOWN value when
 *     currently unmeasured (spec: "continues with the last value it had").
 *   - measured/assumed-ness does NOT carry forward — it's read live from this
 *     call's `measured` flag, because that flag describes "as far as we can
 *     tell, was there data through this whole span" (evaluation happens
 *     often — every packet, every tick — so the one case with a large gap,
 *     an app that was killed and relaunched, is correctly "no data existed
 *     for that entire gap", not "still measured because it was measured right
 *     before the gap started").
 *
 * That second point is what makes recovery free: relaunching after a kill is
 * just calling this exact function with a bigger gap and `measured: false`
 * (there's no live connection yet), and the arithmetic falls out correctly —
 * no separate recovery path needed.
 *
 * Before the first real measurement there is nothing to carry forward, and
 * the answer is always "out of band" — whether the instance has no probe,
 * its probe is disconnected, or it simply hasn't reported yet. In band is
 * only ever learned from a real in-band reading; only AFTER one has
 * happened (`everMeasured`) does losing data carry the last real state on.
 * (The original spec assumed in band when a step had no thermometer at all,
 * so a probe-less step would still progress — but that handed out in-band
 * time, and band entry, that no reading ever showed. Instances saved under
 * that rule still have lastKnownInBand: true with everMeasured false, which
 * is why the check is on everMeasured, not on lastKnownInBand alone.)
 *
 * Frozen entirely while paused, per spec ("In-band accumulation pauses").
 *
 * The one other source of "in band" is the user: "Start in-band timer"
 * (startInBandManually) for a step watched on a thermometer the app can't
 * read. That holds only while there is no data — the first real reading
 * takes over and clears it, in or out of band as the reading says.
 *
 * @param {object} sample - { measured: boolean, inBand: boolean }
 */
export function advanceInBand(instance, { measured, inBand }, now) {
  if (instance.status !== "running") return instance;

  const elapsed = Math.max(0, now - instance.lastSampleAt);
  const everMeasured = instance.everMeasured || measured;
  const manualInBand = !measured && !!instance.manualInBand;
  const effectiveInBand = measured ? inBand : manualInBand || (everMeasured && instance.lastKnownInBand);

  // Entering the band is a one-way door: from the first span that counts as
  // in band, time-since-entering accrues for every running span after it,
  // in band or not. The entering span itself is credited to both clocks
  // alike, so time since entering can never be less than time in band. By
  // the rule above, the entering span is always a measured one.
  // (Instances saved before these fields existed simply enter the band
  // afresh on their next in-band tick.)
  const enteredBand = !!instance.enteredBand || effectiveInBand;

  return {
    ...instance,
    lastSampleAt: now,
    lastKnownInBand: effectiveInBand,
    manualInBand,
    everMeasured,
    accumulatedInBandMs: instance.accumulatedInBandMs + (effectiveInBand ? elapsed : 0),
    accumulatedSinceBandMs: (instance.accumulatedSinceBandMs ?? 0) + (enteredBand ? elapsed : 0),
    enteredBand,
    // Latches permanently once any in-band time was accumulated while assumed
    // — even if the instance later regains the probe.
    latchedEstimate: instance.latchedEstimate || (effectiveInBand && !measured),
  };
}

/**
 * "Start in-band timer": the user, watching a thermometer the app can't read
 * (or none at all), says the temperature is in the band. Time up to now is
 * settled first under the state as it was (out of band), so the press only
 * affects what comes after it. It is still not a measurement — the time it
 * counts is assumed, hatched and "≈" like any other — and the first real
 * reading overrides it (see advanceInBand).
 */
export function startInBandManually(instance, now) {
  if (instance.status !== "running") return instance;
  const settled = advanceInBand(instance, { measured: false, inBand: false }, now);
  return { ...settled, manualInBand: true, lastKnownInBand: true };
}

// The button's visibility rule: a running step with a band, no live data
// coming in, and currently out of band — the one situation where the app
// would otherwise sit waiting for a reading it can never get.
export function canStartInBandManually(instance, step, measured) {
  return instance.status === "running" && !!step.tempBand && !measured && !instance.lastKnownInBand && !instance.manualInBand;
}

// Provenance's "Measured" formula (build-plan: "does this instance use a
// probe, is that probe's data fresh, is the reading valid"). `claimed` keeps
// its old name — it now means "this instance has a probe assigned" — and
// `msSinceLastPacket` is the probe's freshness (probes/manager.js
// msSinceFresh), which for a notify-on-change probe is link-based. Shared by
// the progress-bar state below and by whoever assembles alarms.js's sample
// (app.js) — one formula, not two copies that could drift apart.
export function isMeasured({ claimed, msSinceLastPacket, readingValid }) {
  return !!claimed && msSinceLastPacket != null && msSinceLastPacket < DATA_LOSS_TIMEOUT_MS && !!readingValid;
}

// The four progress-bar states. `inBand` is the live reading-vs-band result
// when measured, or the carried-forward `instance.lastKnownInBand` when
// assumed — resolving that distinction is the caller's job (see advanceInBand,
// which needs the same two inputs to update the carried-forward state). The
// latched "≈ estimate" marker is a separate, independently-shown flag, not one
// of these four states.
export function deriveProvenance({ measured, inBand }) {
  if (measured) return inBand ? "measured-in-band" : "measured-out-of-band";
  return inBand ? "assumed-counting" : "assumed-not-counting";
}

// Completion tallies (RecipePage's per-step tick counts): starting the
// recipe's first step resets them, but only when nothing else in the recipe
// is mid-flight — every instance belonging to it, across every step, is
// already completed (or none exist yet). Deliberately not "the last step has
// a tick": steps aren't gated on each other, so that would fire (and wipe a
// still-in-progress parallel batch's tally) whenever any instance of the
// last step had ever completed, regardless of what else was running.
export function noInstancesInProgress(instancesForRecipe) {
  return !instancesForRecipe.some((i) => i.status !== "completed");
}
