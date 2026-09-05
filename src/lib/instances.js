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
    lastSampleAt: now,
    // "assume in-band if no data available" — the starting assumption with no
    // observations yet is exactly the no-data case. Only actually applied
    // before the FIRST real measurement when this instance holds no claim —
    // see advanceInBand's everMeasured/claimed handling for why a claimed
    // instance's very first, still-unmeasured tick(s) must NOT default to
    // this optimistic guess.
    lastKnownInBand: true,
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
    lastSampleAt: now,
    lastKnownInBand: true,
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
 * Cumulative: extending twice adds twice.
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
 */
export function extendDuration(instance, extraMs, durationAlarmIdToRearm) {
  const next = {
    ...instance,
    durationExtensionMs: (instance.durationExtensionMs || 0) + extraMs,
  };
  if (durationAlarmIdToRearm && next.alarmState[durationAlarmIdToRearm]) {
    next.alarmState = {
      ...next.alarmState,
      [durationAlarmIdToRearm]: { firedCount: 0, sounding: false, firedAt: null },
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
 * The one case that ISN'T a carried-forward continuation is the very first
 * evaluation of a claimed instance's life, before it has ever been measured
 * even once: `lastKnownInBand`'s bootstrap value of `true` exists so a step
 * with NO thermometer at all (unclaimed, or genuinely no BLE ever) doesn't
 * sit frozen forever — but a CLAIMED instance is actively expecting a real
 * reading any moment (the connection is already up), and defaulting to
 * "assume in-band" for however long that takes (observed: several seconds,
 * on real BLE hardware) silently hands out real elapsed time — and, worse,
 * permanently latches the "≈ estimated" flag — for a step that's about to be
 * fully measured and was never actually without a thermometer. `everMeasured`
 * exists solely to tell these two apart: before the first-ever measurement,
 * a CLAIMED instance assumes out-of-band (not counting, "waiting for
 * temperature") instead of the spec's optimistic default; an UNCLAIMED one
 * still gets that default immediately, unchanged. Once a real measurement
 * has happened even once, `everMeasured` is permanently true and every
 * later gap is a genuine continuation, handled exactly as before regardless
 * of claim.
 *
 * Frozen entirely while paused, per spec ("In-band accumulation pauses").
 *
 * @param {object} sample - { measured: boolean, inBand: boolean, claimed: boolean }
 */
export function advanceInBand(instance, { measured, inBand, claimed }, now) {
  if (instance.status !== "running") return instance;

  const elapsed = Math.max(0, now - instance.lastSampleAt);
  const everMeasured = instance.everMeasured || measured;
  const effectiveInBand = measured
    ? inBand
    : everMeasured
      ? instance.lastKnownInBand
      : !claimed; // never-yet-measured: optimistic only when no reading is expected at all

  return {
    ...instance,
    lastSampleAt: now,
    lastKnownInBand: effectiveInBand,
    everMeasured,
    accumulatedInBandMs: instance.accumulatedInBandMs + (effectiveInBand ? elapsed : 0),
    // Latches permanently once any in-band time was accumulated while assumed
    // — even if the instance later regains the probe.
    latchedEstimate: instance.latchedEstimate || (effectiveInBand && !measured),
  };
}

// Provenance's "Measured" formula (build-plan: "does this instance hold the
// claim, how long since the last packet, is the reading valid"). Shared by
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

// Claim: a single global value (an instance id, or null), not a per-instance
// field — "the thermometer" is one shared resource, not owned by an instance
// record. These three transitions are the whole lifecycle from the spec.

export function acquireClaimOnStart(claimHolderId, instanceId) {
  // "A new instance never takes the claim away from a holding instance."
  return claimHolderId == null ? instanceId : claimHolderId;
}

export function releaseClaimOnComplete(claimHolderId, completedInstanceId) {
  return claimHolderId === completedInstanceId ? null : claimHolderId;
}

export function toggleClaim(claimHolderId, instanceId) {
  // A deliberate tap always wins, even taking the claim from another holder —
  // "never auto-take" governs automatic acquisition at Start only.
  return claimHolderId === instanceId ? null : instanceId;
}
