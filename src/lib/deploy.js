// Whether it's safe to apply a waiting service-worker update by reloading the
// page. Reloading itself is never data-unsafe — every timer is derived from
// stored epoch timestamps, so a reload recovers exactly like an app kill
// (see instances.js's advanceInBand). The reason to gate it at all is purely
// UX: build-plan §6 — don't yank the page out from under someone mid-ferment,
// and don't cut off an alarm's audio the instant it starts sounding instead
// of through the app's own silence path.
//
// "In progress" follows the spec's own language for pause: "the step remains
// in progress while paused" — so a paused instance blocks a reload exactly
// like a running one.
export function canApplyServiceWorkerUpdate(openRecipes) {
  for (const { instances } of openRecipes) {
    for (const instance of instances) {
      if (instance.status !== "completed") return false;
      if (Object.values(instance.alarmState).some((s) => s.sounding)) return false;
    }
  }
  return true;
}
