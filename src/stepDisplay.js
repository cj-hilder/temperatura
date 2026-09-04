import { elapsedRunningMs, isMeasured, deriveProvenance } from "./lib/instances.js";
import { formatDuration, formatRemaining } from "./lib/format.js";

// Resolves an alarms.js alarm id (local to one step's evaluation, e.g.
// "temp1" or the implicit "__dataLoss") back to a human-readable name, using
// the step definition it came from. Shared by the engine (building notify
// titles) and the step page (labeling each sounding alarm's Silence control).
export function alarmName(step, alarmId) {
  if (alarmId === "__dataLoss") return "Data loss";
  if (alarmId === `${step.id}-duration-reached`) return "Duration reached";
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
// page can list them all without entering edit mode.
export function describeStepAlarms(step) {
  const lines = [];
  for (const a of step.timeAlarms) {
    const minutes = a.atMs / 60000;
    lines.push({
      id: a.id,
      text: a.repeat
        ? `${a.name} — ${minutes} min in, every ${a.intervalMs / 60000} min`
        : `${a.name} — ${minutes} min in`,
    });
  }
  for (const a of step.tempAlarms) {
    lines.push({ id: a.id, text: `${a.name} — ${a.thresholdC}°C, ${a.direction}` });
  }
  if (step.duration && step.durationReachedAlarm?.enabled) {
    lines.push({
      id: `${step.id}-duration-reached`,
      text: `Duration reached — at ${formatDuration(step.duration.ms)}`,
    });
  }
  if (step.tempBand) {
    lines.push({ id: `${step.id}-band-min`, text: `Below band — ${step.tempBand.lowC}°C, cooling` });
    lines.push({ id: `${step.id}-band-max`, text: `Above band — ${step.tempBand.highC}°C, heating` });
  }
  return lines;
}

/**
 * What a step's progress bar / elapsed figure should show for one instance.
 * Returns null if the step has no duration — spec: no progress bar at all
 * in that case.
 */
export function computeStepProgress(instance, step, { claimHolderId, latestSample, lastPacketAt }, now) {
  if (!step.duration) return null;

  const claimed = instance.id === claimHolderId;
  const msSinceLastPacket = lastPacketAt != null ? now - lastPacketAt : null;
  const readingValid = !!(latestSample && latestSample.probePresent && latestSample.tempC != null);
  const measured = isMeasured({ claimed, msSinceLastPacket, readingValid });

  let elapsedMs;
  let provenance;
  if (step.duration.kind === "fixed") {
    // "An instance with a 'fixed length' duration is always measured and
    // always renders solid. Time is never in doubt." — reusing
    // "measured-in-band" here just means solid + advancing, the same visual
    // as a real in-band measurement; there's no temperature dimension to it.
    elapsedMs = elapsedRunningMs(instance, now);
    provenance = "measured-in-band";
  } else {
    elapsedMs = instance.accumulatedInBandMs;
    const inBand = measured
      ? latestSample.tempC >= step.tempBand.lowC && latestSample.tempC <= step.tempBand.highC
      : instance.lastKnownInBand;
    provenance = deriveProvenance({ measured, inBand });
  }

  const remainingMs = step.duration.ms - elapsedMs;
  const fraction = Math.max(0, Math.min(1, elapsedMs / step.duration.ms));

  return {
    elapsedMs,
    remainingMs,
    fraction,
    provenance,
    // Fixed-length steps are never in doubt, per spec — the estimate flag
    // only means something for an in-band duration. instance.latchedEstimate
    // still gets set internally (advanceInBand runs every tick regardless of
    // duration kind, since app.tick() doesn't know duration kind), but a
    // fixed-length step must never surface it.
    latchedEstimate: step.duration.kind === "fixed" ? false : instance.latchedEstimate,
    elapsedLabel: formatDuration(elapsedMs),
    remainingLabel: formatRemaining(remainingMs),
  };
}

// Visual mapping for the four provenance states (+ the always-solid fixed
// case, which reuses "measured-in-band"). Solid vs hatched = measured vs
// assumed; the bar advances only in the two "…counting"/"in-band" states.
export function progressBarStyle(provenance, colors) {
  const advancing = provenance === "measured-in-band" || provenance === "assumed-counting";
  const measured = provenance === "measured-in-band" || provenance === "measured-out-of-band";
  return {
    advancing,
    fillStyle: measured
      ? colors.gradientEnd
      : `repeating-linear-gradient(45deg, ${colors.gradientEnd}, ${colors.gradientEnd} 4px, transparent 4px, transparent 8px)`,
  };
}

export function provenanceLabel(provenance) {
  switch (provenance) {
    case "measured-out-of-band":
      return "waiting for temperature";
    case "assumed-not-counting":
      return "waiting for temperature — no data";
    default:
      return null;
  }
}
