// The controller. Follows Ride the Wind's createAppController({ backend, now,
// ... }) shape: injected backend/clock, builds a Store
// internally, returns a flat method-per-operation object plus the raw store
// handle. No pub/sub — callers get results back from calls, same as RTW.
import { IndexedDBBackend, MemoryBackend, Store, DEFAULT_THEME_ID } from "./storage.js";
import { validateRecipe, durationAlarmId } from "./recipe.js";
import {
  startInstance, pauseInstance, resumeInstance, restartInstance, completeInstance,
  duplicateInstance, setTag as setInstanceTag, elapsedRunningMs, elapsedTotalMs,
  advanceInBand, isMeasured, deriveProvenance, extendDuration, durationBasisMs, startInBandManually as startInBandManuallyPure,
  noInstancesInProgress,
} from "./instances.js";
import {
  autoAssignOnStart, assign, unassign, releaseOnComplete, forgetProbe, pruneAssignments, migrateClaim,
} from "./assignment.js";
import { evaluateAlarms, silenceEarliest, silenceById, dismissById } from "./alarms.js";

// Only read once, to migrate an old install's single claim onto a probe
// assignment (see getProbeAssignments); never written any more.
const LEGACY_CLAIM_SETTING_KEY = "claimHolderId";
const PROBE_ASSIGNMENTS_KEY = "probeAssignments";
const KNOWN_PROBES_KEY = "knownProbes";
const DATA_LOSS_THEME_SETTING_KEY = "dataLossAlarmTheme";
// One multiplier per recipe, not one global value — scaling today's loaf
// must never also scale an unrelated soup recipe that happens to be open at
// the same time. Stored under the generic settings store (keyed by recipe
// id) rather than on the recipe record itself, since the multiplier is
// spec'd as transient and explicitly NOT part of the recipe's own data.
const INGREDIENTS_MULTIPLIER_PREFIX = "ingredientsMultiplier:";
// Per-step completion tallies (RecipePage's tick marks), keyed by recipe id
// like the multiplier above — not on the recipe record itself, so instance
// lifecycle functions below can read/reset them from an instance's own
// recipeId/stepId without ever touching a recipe/step record (see
// doExtendDuration's comment: app.js's instance functions don't do that).
const COMPLETION_TICKS_PREFIX = "completionTicks:";
// Off by default: auto-clearing on every fresh install would surprise a user
// who never asked for it — this is an opt-in convenience, not a default
// behavior the app imposes.
const AUTO_CLEAR_TALLIES_SETTING_KEY = "autoClearTallies";
// One temperature graph per running instance (lib/graphHistory.js), in the
// settings store keyed by instance id — no schema change needed, and it
// keeps the graph's up-to-2,000 points out of the instance record, which is
// rewritten every tick.
const GRAPH_PREFIX = "graph:";
// Off by default: only some measuring-spoon sets have 1/6 and 1/12 (see
// quantity.js).
const SIXTHS_SETTING_KEY = "sixthsAndTwelfths";

/**
 * @param {object} [deps]
 * @param {object} [deps.backend] - storage backend; defaults to IndexedDB in
 *   the browser, MemoryBackend otherwise.
 * @param {() => number} [deps.now] - injectable clock; defaults to Date.now.
 * @param {() => string} [deps.uuid] - id generator, forwarded to Store.
 */
export function createAppController(deps = {}) {
  const backend =
    deps.backend || (typeof indexedDB !== "undefined" ? new IndexedDBBackend() : new MemoryBackend());
  const store = new Store({ backend, uuid: deps.uuid });
  const now = deps.now || (() => Date.now());

  // ---- Recipes / open set ----

  const createRecipe = (recipe) => store.createRecipe(recipe);
  const getRecipe = (id) => store.getRecipe(id);
  const listRecipes = () => store.listRecipes();
  const updateRecipe = (id, patch) => store.updateRecipe(id, patch);
  const deleteRecipe = async (id) => {
    const instances = await store.listInstancesForRecipe(id);
    await store.deleteRecipe(id);
    await releaseInstances(instances.map((i) => i.id));
    await clearGraphs(instances.map((i) => i.id));
  };
  const openRecipe = (id) => store.openRecipe(id);
  const listOpenRecipeIds = () => store.listOpenRecipeIds();
  // Tallies don't survive a close/reopen — a closed-then-reopened recipe is
  // meant to feel like starting fresh, not like resuming a session.
  const closeRecipe = async (id) => {
    const instances = await store.listInstancesForRecipe(id);
    await store.closeRecipe(id, now());
    await clearCompletionTicks(id);
    // Closing completes its instances wholesale, bypassing the per-instance
    // Complete path, so their probes (and graphs) have to be freed here.
    await releaseInstances(instances.map((i) => i.id));
    await clearGraphs(instances.map((i) => i.id));
  };

  // ---- Temperature graphs ----

  const getGraph = (instanceId) => store.getSetting(GRAPH_PREFIX + instanceId, null);
  const saveGraph = (instanceId, history) => store.setSetting(GRAPH_PREFIX + instanceId, history);
  // A graph belongs to a run in progress; once the instance is finished
  // there's nothing to draw it on.
  const clearGraphs = async (instanceIds) => {
    for (const id of instanceIds) await store.deleteSetting(GRAPH_PREFIX + id);
  };

  // ---- Probes: which are known, and which instance uses which ----

  const getKnownProbes = () => store.getSetting(KNOWN_PROBES_KEY, []);
  const saveKnownProbes = (list) => store.setSetting(KNOWN_PROBES_KEY, list);

  // `{ [instanceId]: probeId }`. null in storage means "never migrated": an
  // install from before multiple probes has a single claimHolderId instead,
  // which maps onto the one probe it could possibly have meant.
  async function getProbeAssignments() {
    const stored = await store.getSetting(PROBE_ASSIGNMENTS_KEY, null);
    if (stored !== null) return stored;
    const legacy = await store.getSetting(LEGACY_CLAIM_SETTING_KEY, null);
    const migrated = migrateClaim(legacy, (await getKnownProbes()).map((p) => p.id));
    await store.setSetting(PROBE_ASSIGNMENTS_KEY, migrated);
    await store.setSetting(LEGACY_CLAIM_SETTING_KEY, null);
    return migrated;
  }
  const saveProbeAssignments = (a) => store.setSetting(PROBE_ASSIGNMENTS_KEY, a);

  async function updateAssignments(fn) {
    const current = await getProbeAssignments();
    const next = fn(current);
    if (next !== current) await saveProbeAssignments(next);
    return next;
  }

  const assignProbe = (instanceId, probeId) => updateAssignments((a) => assign(a, instanceId, probeId));
  const unassignProbe = (instanceId) => updateAssignments((a) => unassign(a, instanceId));
  // Forgetting also removes it from the known list — the engine's manager
  // owns the live connection, this owns what survives a restart.
  async function forgetKnownProbe(probeId) {
    await updateAssignments((a) => forgetProbe(a, probeId));
    await saveKnownProbes((await getKnownProbes()).filter((p) => p.id !== probeId));
  }
  const releaseInstances = (instanceIds) =>
    updateAssignments((a) => instanceIds.reduce((acc, id) => releaseOnComplete(acc, id), a));
  // Drops assignments whose instance is gone or completed, whichever way that
  // happened. Cheap enough to run every refresh: it only writes when it prunes.
  const pruneProbeAssignments = (activeInstanceIds) => updateAssignments((a) => pruneAssignments(a, activeInstanceIds));

  // ---- Alarm themes ----

  const ensureDefaultTheme = () => store.ensureDefaultTheme();
  // The lost-BLE-connection alarm's theme is a single global setting, not a
  // per-alarm field — it isn't attached to any step, so there's nowhere else
  // for the user to choose it but here.
  const getDataLossAlarmTheme = () => store.getSetting(DATA_LOSS_THEME_SETTING_KEY, DEFAULT_THEME_ID);
  const setDataLossAlarmTheme = (themeId) => store.setSetting(DATA_LOSS_THEME_SETTING_KEY, themeId);

  // ---- Ingredients multiplier (per recipe, transient — see the constant above) ----

  const getIngredientsMultiplier = (recipeId) => store.getSetting(INGREDIENTS_MULTIPLIER_PREFIX + recipeId, 1);
  const setIngredientsMultiplier = (recipeId, value) => store.setSetting(INGREDIENTS_MULTIPLIER_PREFIX + recipeId, value);

  // ---- Completion tallies ----

  const getCompletionTicks = (recipeId) => store.getSetting(COMPLETION_TICKS_PREFIX + recipeId, {});
  const clearCompletionTicks = (recipeId) => store.setSetting(COMPLETION_TICKS_PREFIX + recipeId, {});
  const getAutoClearTallies = () => store.getSetting(AUTO_CLEAR_TALLIES_SETTING_KEY, false);
  const setAutoClearTallies = (value) => store.setSetting(AUTO_CLEAR_TALLIES_SETTING_KEY, value);
  const getSixthsAndTwelfths = () => store.getSetting(SIXTHS_SETTING_KEY, false);
  const setSixthsAndTwelfths = (value) => store.setSetting(SIXTHS_SETTING_KEY, value);

  async function incrementCompletionTick(recipeId, stepId) {
    const ticks = await getCompletionTicks(recipeId);
    await store.setSetting(COMPLETION_TICKS_PREFIX + recipeId, { ...ticks, [stepId]: (ticks[stepId] || 0) + 1 });
  }

  // ---- Instance lifecycle ----

  // `freeProbeIds`: the connected probes no instance is using — the caller
  // knows what is connected, this controller doesn't (see autoAssignOnStart).
  async function doStartInstance({ id, recipeId, stepId, stepAlarmDefs, isFirstStep = false, freeProbeIds = [] }) {
    // "Starting step 1 clears the tallies, but only when nothing else in the
    // recipe is mid-flight" — checked against instances as they stand right
    // now, before this one is created, so this new instance can never count
    // against itself. Gated on the opt-in "Auto clear tallies" setting —
    // off by default, so a fresh install never auto-clears anything the
    // user didn't ask for.
    if (isFirstStep && (await getAutoClearTallies())) {
      const existing = await store.listInstancesForRecipe(recipeId);
      if (noInstancesInProgress(existing)) await clearCompletionTicks(recipeId);
    }
    const instance = startInstance({ id, recipeId, stepId, stepAlarmDefs }, now());
    await store.createInstance(instance);
    await updateAssignments((a) => autoAssignOnStart(a, instance.id, freeProbeIds));
    return instance;
  }

  async function doPauseInstance(instanceId) {
    const instance = await store.getInstance(instanceId);
    const updated = pauseInstance(instance, now());
    await store.updateInstance(updated);
    return updated;
  }

  async function doResumeInstance(instanceId) {
    const instance = await store.getInstance(instanceId);
    const updated = resumeInstance(instance, now());
    await store.updateInstance(updated);
    return updated;
  }

  async function doRestartInstance(instanceId, stepAlarmDefs) {
    const instance = await store.getInstance(instanceId);
    const updated = restartInstance(instance, stepAlarmDefs, now());
    await store.updateInstance(updated);
    return updated;
  }

  async function doCompleteInstance(instanceId) {
    const instance = await store.getInstance(instanceId);
    const updated = completeInstance(instance, now());
    await store.updateInstance(updated);
    await releaseInstances([instanceId]);
    await clearGraphs([instanceId]);
    await incrementCompletionTick(instance.recipeId, instance.stepId);
    return updated;
  }

  async function doDuplicateInstance(instanceId, newId, stepAlarmDefs, freeProbeIds = []) {
    const instance = await store.getInstance(instanceId);
    const dup = duplicateInstance(instance, newId, stepAlarmDefs, now());
    await store.createInstance(dup);
    // "A new instance never takes a probe" — same rule as any other Start.
    await updateAssignments((a) => autoAssignOnStart(a, dup.id, freeProbeIds));
    return dup;
  }

  async function doSetTag(instanceId, tag) {
    const instance = await store.getInstance(instanceId);
    const updated = setInstanceTag(instance, tag);
    await store.updateInstance(updated);
    return updated;
  }

  // Temporary, per-instance duration extension (build-plan/spec addition:
  // "Extend"). instance.stepId is always this step's own id, so the
  // duration-reached alarm's id is derivable without fetching the recipe.
  //
  // `duration` (the step's own {ms, kind}) is supplied by the caller rather
  // than looked up here — app.js doesn't otherwise touch recipe/step records
  // at all, mirroring how tick() already receives duration/tempBand from its
  // own caller — and it's what's needed to extend a MISSED duration alarm
  // correctly: the new target must be computed from the instance's current
  // elapsed time, not from the original (already-passed) target.
  //
  // `isMissed` is likewise supplied by the caller rather than re-derived from
  // the instance's CURRENT alarm state here — by the time an extension is
  // actually confirmed, the alarm has already been dismissed (engine.js's
  // requestExtend dismisses/silences it up front, before the dialog even
  // opens, same as it always has), so `alarmState[alarmId].missed` has
  // already been cleared to false. The caller must capture whether it WAS
  // missed at the moment the user tapped Extend, before that happened.
  async function doStartInBandManually(instanceId) {
    const updated = startInBandManuallyPure(await store.getInstance(instanceId), now());
    await store.updateInstance(updated);
    return updated;
  }

  async function doExtendDuration(instanceId, extraMs, duration, isMissed = false) {
    const instance = await store.getInstance(instanceId);
    const alarmId = durationAlarmId(instance.stepId);
    const currentTimeBasisMs = durationBasisMs(instance, duration, now());
    const updated = extendDuration(instance, extraMs, alarmId, {
      isMissed,
      originalDurationMs: duration.ms,
      currentTimeBasisMs,
    });
    await store.updateInstance(updated);
    return updated;
  }

  // Silences the duration-reached alarm specifically — what the Extend
  // button does before opening its dialog, regardless of whether it's
  // actually sounding right now (silenceById is already a no-op otherwise).
  async function silenceDurationAlarm(instanceId) {
    const instance = await store.getInstance(instanceId);
    return silenceAlarm(instanceId, durationAlarmId(instance.stepId));
  }

  function isInBand(tempC, tempBand) {
    if (!tempBand || tempC == null) return false;
    return tempC >= tempBand.lowC && tempC <= tempBand.highC;
  }

  /**
   * One evaluation pass for a single instance: advances in-band accumulation
   * and evaluates alarms, then persists the result. This is the function a
   * periodic tick loop (and BLE measurement events) call — including, after a
   * restart, on the very first evaluation: recovery is not a special case,
   * it's just this same call with a larger gap since lastSampleAt.
   */
  // `claimed` = this instance has a probe assigned. The caller (engine.js)
  // resolves which probe and passes in ITS reading and freshness, so this
  // controller never needs to know probes exist.
  async function tick(instanceId, { stepAlarmDefs, hasTempInterest, tempBand, duration, tempC, readings = null, msSinceLastPacket, readingValid, dataLossSilenceAfterMs, claimed = false }) {
    const instance = await store.getInstance(instanceId);
    const measured = isMeasured({ claimed, msSinceLastPacket, readingValid });
    const inBand = measured ? isInBand(tempC, tempBand) : instance.lastKnownInBand;

    const t = now();
    const advanced = advanceInBand(instance, { measured, inBand }, t);
    const running = advanced.status === "running";
    // Time/duration alarms must never disagree with the progress bar about
    // when a duration is reached, so they share its exact basis.
    const timeBasisMs = durationBasisMs(advanced, duration, t);
    const { alarmState, newlyFired, sounding } = evaluateAlarms({
      stepAlarmDefs,
      hasTempInterest,
      alarmState: advanced.alarmState,
      timeBasisMs,
      isRunning: running,
      claimed,
      msSinceLastPacket,
      measured,
      tempC,
      readings,
      now: t,
      dataLossSilenceAfterMs,
    });

    const finalInstance = { ...advanced, alarmState };
    await store.updateInstance(finalInstance);
    const provenance = deriveProvenance({ measured, inBand });
    return { instance: finalInstance, provenance, newlyFired, sounding };
  }

  // Earliest-first — the thermometer button's rule, the one input with no
  // way to target a specific alarm.
  async function silence(instanceId) {
    const instance = await store.getInstance(instanceId);
    const { alarmState, silencedId } = silenceEarliest(instance.alarmState);
    await store.updateInstance({ ...instance, alarmState });
    return silencedId;
  }

  // Targeted — the notification-tap and in-app per-alarm Silence routes,
  // which are NOT earliest-first (build-plan §7 decision #2).
  async function silenceAlarm(instanceId, alarmId) {
    const instance = await store.getInstance(instanceId);
    const { alarmState, silencedId } = silenceById(instance.alarmState, alarmId);
    await store.updateInstance({ ...instance, alarmState });
    return silencedId;
  }

  // Clears a missed alarm's outstanding status — distinct from silencing,
  // since a missed alarm has nothing currently sounding to silence.
  async function dismissAlarm(instanceId, alarmId) {
    const instance = await store.getInstance(instanceId);
    const { alarmState, dismissedId } = dismissById(instance.alarmState, alarmId);
    await store.updateInstance({ ...instance, alarmState });
    return dismissedId;
  }

  return {
    store,
    createRecipe, getRecipe, listRecipes, updateRecipe, deleteRecipe,
    openRecipe, listOpenRecipeIds, closeRecipe,
    getKnownProbes, saveKnownProbes, getProbeAssignments, assignProbe, unassignProbe,
    forgetKnownProbe, releaseInstances, pruneProbeAssignments,
    ensureDefaultTheme, getDataLossAlarmTheme, setDataLossAlarmTheme,
    getIngredientsMultiplier, setIngredientsMultiplier,
    getCompletionTicks, clearCompletionTicks,
    getAutoClearTallies, setAutoClearTallies,
    getSixthsAndTwelfths, setSixthsAndTwelfths,
    getGraph, saveGraph, clearGraphs,
    startInstance: doStartInstance,
    pauseInstance: doPauseInstance,
    resumeInstance: doResumeInstance,
    restartInstance: doRestartInstance,
    completeInstance: doCompleteInstance,
    duplicateInstance: doDuplicateInstance,
    setTag: doSetTag,
    extendDuration: doExtendDuration,
    startInBandManually: doStartInBandManually,
    silenceDurationAlarm,
    elapsedRunningMs: (instance) => elapsedRunningMs(instance, now()),
    elapsedTotalMs: (instance) => elapsedTotalMs(instance, now()),
    tick,
    silence,
    silenceAlarm,
    dismissAlarm,
    validateRecipe,
  };
}
