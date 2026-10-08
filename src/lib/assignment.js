// Probe assignment: which probe each running instance uses. Pure — plain
// `{ [instanceId]: probeId }` maps in, new maps out, never mutated. Replaces
// the old single global "claim". One-to-one: an instance uses at most one
// probe and a probe serves at most one instance (spec, Probe assignment).

export const probeOf = (assignments, instanceId) => assignments[instanceId] ?? null;

export const instanceUsing = (assignments, probeId) =>
  Object.keys(assignments).find((i) => assignments[i] === probeId) ?? null;

// A probe is free if no instance is using it.
export function freeProbeIds(connectedProbeIds, assignments) {
  const used = new Set(Object.values(assignments));
  return connectedProbeIds.filter((id) => !used.has(id));
}

/**
 * At Start: take a probe automatically only when there is exactly one free
 * connected probe — with several the app can't know which one the user put in
 * the pot, so it leaves the choice to them. A new instance never takes a probe
 * from one that's using it (only free probes are ever offered here).
 */
export function autoAssignOnStart(assignments, instanceId, freeConnectedProbeIds) {
  if (assignments[instanceId] != null || freeConnectedProbeIds.length !== 1) return assignments;
  return { ...assignments, [instanceId]: freeConnectedProbeIds[0] };
}

/**
 * A deliberate choice always wins: if another instance was using the probe it
 * is transferred (that instance becomes unassigned), because choosing it is
 * the user telling the app they have physically moved it. Replaces whatever
 * probe this instance already used.
 */
export function assign(assignments, instanceId, probeId) {
  const next = {};
  for (const [i, p] of Object.entries(assignments)) if (p !== probeId && i !== instanceId) next[i] = p;
  next[instanceId] = probeId;
  return next;
}

export function unassign(assignments, instanceId) {
  if (!(instanceId in assignments)) return assignments;
  const { [instanceId]: _gone, ...rest } = assignments;
  return rest;
}

// Completing an instance frees its probe. It is not handed on to anything.
export const releaseOnComplete = unassign;

export function forgetProbe(assignments, probeId) {
  return Object.fromEntries(Object.entries(assignments).filter(([, p]) => p !== probeId));
}

// Drops assignments belonging to instances that no longer exist or are
// completed (closing/deleting a recipe completes or removes instances without
// going through releaseOnComplete one by one).
export function pruneAssignments(assignments, activeInstanceIds) {
  const active = new Set(activeInstanceIds);
  const entries = Object.entries(assignments);
  const kept = entries.filter(([i]) => active.has(i));
  return kept.length === entries.length ? assignments : Object.fromEntries(kept);
}

/**
 * One-off migration from the old single `claimHolderId`: the old app only ever
 * had one thermometer, so if exactly one probe is known the holder maps
 * cleanly onto it; with none or several there is no way to know which, so the
 * stale claim is dropped (an unassigned instance is a normal, recoverable state).
 */
export function migrateClaim(claimHolderId, knownProbeIds) {
  if (claimHolderId == null || knownProbeIds.length !== 1) return {};
  return { [claimHolderId]: knownProbeIds[0] };
}
