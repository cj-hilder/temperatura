import { elapsedRunningMs, isMeasured, deriveProvenance, durationBasisMs } from "./lib/instances.js";
import { durationAlarmId, sortTimeAlarms, sortTempAlarms } from "./lib/recipe.js";
import { formatDuration, formatRemaining, formatHMS } from "./lib/format.js";

// Resolves an alarms.js alarm id (local to one step's evaluation, e.g.
// "temp1" or the implicit "__dataLoss") back to a human-readable name, using
// the step definition it came from. Shared by the engine (building notify
// titles) and the step page (labeling each sounding alarm's Silence control).
export function alarmName(step, alarmId) {
  if (alarmId === "__dataLoss") return "Data loss";
  if (alarmId === durationAlarmId(step.id)) return "Duration reached";
  if (alarmId === `${step.id}-band-min`) return "Below band";
  if (alarmId === `${step.id}-band-max`) return "Above band";
  return (
    step.timeAlarms.find((a) => a.id === alarmId)?.name ??
    step.tempAlarms.find((a) => a.id === alarmId)?.name ??
    alarmId
  );
}

// One human-readable line per configured alarm — every time alarm, every
// temperature alarm, and the duration-reached alarm if enabled — so the step
// page can list them all without entering edit mode. Ordered per spec: time
// alarms ascending → duration alarm → heating ascending → cooling
// descending → band alarms.
export function describeStepAlarms(step) {
  const lines = [];
  for (const a of sortTimeAlarms(step.timeAlarms)) {
    lines.push({
      id: a.id,
      text: a.repeat
        ? `${a.name} — ${formatDuration(a.atMs)} in, every ${formatDuration(a.intervalMs)}`
        : `${a.name} — ${formatDuration(a.atMs)} in`,
    });
  }
  if (step.duration && step.durationReachedAlarm?.enabled) {
    lines.push({
      id: durationAlarmId(step.id),
      text: `Duration reached — at ${formatDuration(step.duration.ms)}`,
    });
  }
  for (const a of sortTempAlarms(step.tempAlarms)) {
    lines.push({ id: a.id, text: `${a.name} — ${a.thresholdC}°C, ${a.direction}${a.oneShot ? " (once)" : ""}` });
  }
  if (step.tempBand) {
    lines.push({ id: `${step.id}-band-min`, text: `Below band — ${step.tempBand.lowC}°C, cooling` });
    lines.push({ id: `${step.id}-band-max`, text: `Above band — ${step.tempBand.highC}°C, heating` });
  }
  return lines;
}

// The alarm overlay's "(time 00:05:00)" / "(heating 70 deg)" / "(cooling 40
// deg)" qualifier — spec calls these out by kind so a row is legible without
// opening the step. `def` is one entry from buildStepAlarmDefs (has the
// atMs/repeat/intervalMs or thresholdC/direction fields); `firedCount` is
// this alarm's current occurrence number, from its alarmState — every
// occurrence of a repeating alarm is numbered, not just the second onward,
// so there's no special first-time case to reason about.
export function alarmDetail(def, firedCount) {
  if (!def) return null;
  if (def.kind === "time" || def.kind === "duration") {
    const label = `time ${formatHMS(def.atMs)}`;
    return def.repeat ? `#${firedCount} ${label}` : label;
  }
  if (def.kind === "temperature") {
    return `${def.direction} ${def.thresholdC} deg`;
  }
  return null;
}

/**
 * What a step's progress bar / elapsed figure should show for one instance.
 * Returns null if the step has no duration — spec: no progress bar at all
 * in that case.
 */
/**
 * Is live data coming in for this instance right now, and what is it — from
 * the probe it uses, if any (engine.probeFor): its own sample and its own
 * freshness, not one global reading shared by every step.
 */
export function liveReading(instance, { probeFor }, now) {
  const bound = probeFor(instance.id, now);
  const latestSample = bound?.sample ?? null;
  const readingValid = !!(latestSample && latestSample.probePresent && latestSample.tempC != null);
  const measured = isMeasured({ claimed: !!bound, msSinceLastPacket: bound?.msSinceLastPacket ?? null, readingValid });
  return { measured, latestSample };
}

export function computeStepProgress(instance, step, engine, now) {
  if (!step.duration) return null;

  const { measured, latestSample } = liveReading(instance, engine, now);

  const elapsedMs = durationBasisMs(instance, step.duration, now);
  const liveInBand = () =>
    measured
      ? latestSample.tempC >= step.tempBand.lowC && latestSample.tempC <= step.tempBand.highC
      : instance.lastKnownInBand;
  let provenance;
  if (step.duration.kind === "fixed") {
    // "An instance with a 'fixed length' duration is always measured and
    // always renders solid. Time is never in doubt." — reusing
    // "measured-in-band" here just means solid + advancing, the same visual
    // as a real in-band measurement; there's no temperature dimension to it.
    provenance = "measured-in-band";
  } else if (step.duration.kind === "sinceBand") {
    // Before the band is first entered it is waiting exactly like an in-band
    // step. Once entered, the clock just runs — leaving the band doesn't stop
    // it — so it always advances; it is drawn hatched only while no data is
    // coming in, so the bar still says when the probe has gone quiet.
    provenance = instance.enteredBand
      ? measured ? "measured-in-band" : "assumed-counting"
      : deriveProvenance({ measured, inBand: liveInBand() });
  } else {
    provenance = deriveProvenance({ measured, inBand: liveInBand() });
  }

  // A temporary, per-instance "Extend" only ever moves the target further
  // away — the step's own duration.ms is untouched (see
  // instances.js:extendDuration), so the bar/remaining-time target has to
  // add it back in here rather than reading step.duration.ms directly.
  const extensionMs = instance.durationExtensionMs || 0;
  const targetMs = step.duration.ms + extensionMs;
  const remainingMs = targetMs - elapsedMs;
  const fraction = Math.max(0, Math.min(1, elapsedMs / targetMs));

  return {
    elapsedMs,
    remainingMs,
    fraction,
    provenance,
    extensionMs,
    // Fixed-length steps are never in doubt, per spec — the estimate flag
    // only means something for an in-band duration. instance.latchedEstimate
    // still gets set internally (advanceInBand runs every tick regardless of
    // duration kind, since app.tick() doesn't know duration kind), but a
    // fixed-length step must never surface it.
    // Neither clock is in doubt except time spent in band: band entry only
    // ever happens on a real reading, and after that "since entering" is
    // plain running time.
    latchedEstimate: step.duration.kind === "inBand" ? instance.latchedEstimate : false,
    manualInBand: !!instance.manualInBand,
    elapsedLabel: formatDuration(elapsedMs),
    remainingLabel: formatRemaining(remainingMs),
  };
}

/**
 * The timers line under a running step: elapsed time alone for a step with
 * no temperature band, or with a band all three — elapsed, time since
 * entering the band, time spent in it — with the one the step's duration
 * counts against in bold (elapsed for no duration or fixed length). Pure, so
 * the step page and every tile show the same thing.
 *
 * @returns {Array<{key: string, text: string, bold: boolean, estimate: boolean}>}
 */
export function stepTimers(instance, step, now) {
  const kind = step.duration?.kind ?? null;
  const elapsed = {
    key: "elapsed",
    text: `${formatDuration(elapsedRunningMs(instance, now))} elapsed`,
    bold: !!step.tempBand && kind !== "sinceBand" && kind !== "inBand",
    estimate: false,
  };
  if (!step.tempBand) return [elapsed];
  return [
    elapsed,
    {
      key: "sinceBand",
      // Before the band is reached there is no "since" yet — a 0:00 would
      // read as if the reading had just arrived.
      text: instance.enteredBand ? `${formatDuration(instance.accumulatedSinceBandMs ?? 0)} since entering band` : "band not reached yet",
      bold: kind === "sinceBand",
      estimate: false,
    },
    {
      key: "inBand",
      text: `${formatDuration(instance.accumulatedInBandMs)} in band`,
      bold: kind === "inBand",
      estimate: !!instance.latchedEstimate,
    },
  ];
}

// Visual mapping for the four provenance states (+ the always-solid fixed
// case, which reuses "measured-in-band"). Solid vs hatched = measured vs
// assumed; the bar advances only in the two "…counting"/"in-band" states.
export function progressBarStyle(provenance, colors) {
  const advancing = provenance === "measured-in-band" || provenance === "assumed-counting";
  const measured = provenance === "measured-in-band" || provenance === "measured-out-of-band";
  const hatch = (stripe) => `repeating-linear-gradient(45deg, ${stripe}, ${stripe} 4px, transparent 4px, transparent 8px)`;
  return {
    advancing,
    fillStyle: measured ? colors.gradientEnd : hatch(colors.gradientEnd),
    // The empty part of the bar is hatched too while no data is coming in.
    // Hatching only the fill was invisible exactly when it mattered most: a
    // step with no probe has counted nothing, so its fill is 0% wide and the
    // bar looked like an ordinary empty one.
    trackStyle: measured ? colors.border : hatch(colors.border),
  };
}

// `manual`: in band because the user pressed "Start in-band timer" — the
// bar is advancing hatched, and this says why.
export function provenanceLabel(provenance, { manual = false } = {}) {
  switch (provenance) {
    case "measured-out-of-band":
      return "waiting for temperature";
    case "assumed-not-counting":
      return "waiting for temperature — no data";
    case "assumed-counting":
      return manual ? "in band — set by hand" : null;
    default:
      return null;
  }
}
