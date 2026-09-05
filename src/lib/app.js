// The controller. Follows Ride the Wind's createAppController({ backend, now,
// ... }) shape: injected backend/clock/thermometer, builds a Store
// internally, returns a flat method-per-operation object plus the raw store
// handle. No pub/sub — callers get results back from calls, same as RTW.
import { IndexedDBBackend, MemoryBackend, Store, DEFAULT_THEME_ID } from "./storage.js";
import { validateRecipe, durationAlarmId } from "./recipe.js";
import {
  startInstance, pauseInstance, resumeInstance, restartInstance, completeInstance,
  duplicateInstance, setTag as setInstanceTag, elapsedRunningMs, elapsedTotalMs,
  advanceInBand, isMeasured, deriveProvenance, extendDuration,
  acquireClaimOnStart, releaseClaimOnComplete, toggleClaim as toggleClaimHolder,
  noInstancesInProgress,
} from "./instances.js";
import { evaluateAlarms, silenceEarliest, silenceById, dismissById } from "./alarms.js";

const CLAIM_SETTING_KEY = "claimHolderId";
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

/**
 * @param {object} [deps]
 * @param {object} [deps.backend] - storage backend; defaults to IndexedDB in
 *   the browser, MemoryBackend otherwise.
 * @param {() => number} [deps.now] - injectable clock; defaults to Date.now.
 * @param {object} [deps.thermometer] - a WebBluetoothBackend/FakeThermometer.
 * @param {() => string} [deps.uuid] - id generator, forwarded to Store.
 */
export function createAppController(deps = {}) {
  const backend =
    deps.backend || (typeof indexedDB !== "undefined" ? new IndexedDBBackend() : new MemoryBackend());
  const store = new Store({ backend, uuid: deps.uuid });
  const now = deps.now || (() => Date.now());
  const thermometer = deps.thermometer || null;

  // ---- Recipes / open set ----

  const createRecipe = (recipe) => store.createRecipe(recipe);
  const getRecipe = (id) => store.getRecipe(id);
  const listRecipes = () => store.listRecipes();
  const updateRecipe = (id, patch) => store.updateRecipe(id, patch);
  const deleteRecipe = (id) => store.deleteRecipe(id);
  const openRecipe = (id) => store.openRecipe(id);
  const listOpenRecipeIds = () => store.listOpenRecipeIds();
  // Tallies don't survive a close/reopen — a closed-then-reopened recipe is
  // meant to feel like starting fresh, not like resuming a session.
  const closeRecipe = async (id) => {
    await store.closeRecipe(id, now());
    await clearCompletionTicks(id);
  };

  // ---- Claim ----

  const getClaimHolderId = () => store.getSetting(CLAIM_SETTING_KEY, null);

  async function toggleClaim(instanceId) {
    const current = await getClaimHolderId();
    const next = toggleClaimHolder(current, instanceId);
    await store.setSetting(CLAIM_SETTING_KEY, next);
    return next;
  }

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

  async function incrementCompletionTick(recipeId, stepId) {
    const ticks = await getCompletionTicks(recipeId);
    await store.setSetting(COMPLETION_TICKS_PREFIX + recipeId, { ...ticks, [stepId]: (ticks[stepId] || 0) + 1 });
  }

  // ---- Instance lifecycle ----

  async function doStartInstance({ id, recipeId, stepId, stepAlarmDefs, isFirstStep = false }) {
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
    const current = await getClaimHolderId();
    await store.setSetting(CLAIM_SETTING_KEY, acquireClaimOnStart(current, instance.id));
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
    const current = await getClaimHolderId();
    await store.setSetting(CLAIM_SETTING_KEY, releaseClaimOnComplete(current, instanceId));
    await incrementCompletionTick(instance.recipeId, instance.stepId);
    return updated;
  }

  async function doDuplicateInstance(instanceId, newId, stepAlarmDefs) {
    const instance = await store.getInstance(instanceId);
    const dup = duplicateInstance(instance, newId, stepAlarmDefs, now());
    await store.createInstance(dup);
    // "A new instance never takes the claim" — same rule as any other Start.
    const current = await getClaimHolderId();
    await store.setSetting(CLAIM_SETTING_KEY, acquireClaimOnStart(current, dup.id));
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
  async function doExtendDuration(instanceId, extraMs, duration, isMissed = false) {
    const instance = await store.getInstance(instanceId);
    const alarmId = durationAlarmId(instance.stepId);
    const currentTimeBasisMs =
      duration.kind === "inBand" ? instance.accumulatedInBandMs : elapsedRunningMs(instance, now());
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
  async function tick(instanceId, { stepAlarmDefs, hasTempInterest, tempBand, duration, tempC, msSinceLastPacket, readingValid, dataLossSilenceAfterMs }) {
    const instance = await store.getInstance(instanceId);
    const claimHolderId = await getClaimHolderId();
    const claimed = claimHolderId === instanceId;
    const measured = isMeasured({ claimed, msSinceLastPacket, readingValid });
    const inBand = measured ? isInBand(tempC, tempBand) : instance.lastKnownInBand;

    const t = now();
    const advanced = advanceInBand(instance, { measured, inBand, claimed }, t);
    const running = advanced.status === "running";
    // Time/duration alarms must never disagree with the progress bar about
    // when a duration is reached, so they share its exact basis: an
    // "in temperature band" duration counts accumulatedInBandMs (same value
    // the bar shows), everything else (no duration, or "fixed length", which
    // the spec pins as always-measured/never-in-doubt regardless of any
    // temperature band) counts plain running time.
    const timeBasisMs =
      duration?.kind === "inBand" ? advanced.accumulatedInBandMs : elapsedRunningMs(advanced, t);
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

  // ---- Thermometer ----

  const connectThermometer = (handlers) => thermometer?.connect(handlers);
  const disconnectThermometer = () => thermometer?.disconnect();
  const getLastPacketAt = () => thermometer?.getLastPacketAt() ?? null;

  return {
    store,
    createRecipe, getRecipe, listRecipes, updateRecipe, deleteRecipe,
    openRecipe, listOpenRecipeIds, closeRecipe,
    getClaimHolderId, toggleClaim,
    ensureDefaultTheme, getDataLossAlarmTheme, setDataLossAlarmTheme,
    getIngredientsMultiplier, setIngredientsMultiplier,
    getCompletionTicks, clearCompletionTicks,
    getAutoClearTallies, setAutoClearTallies,
    startInstance: doStartInstance,
    pauseInstance: doPauseInstance,
    resumeInstance: doResumeInstance,
    restartInstance: doRestartInstance,
    completeInstance: doCompleteInstance,
    duplicateInstance: doDuplicateInstance,
    setTag: doSetTag,
    extendDuration: doExtendDuration,
    silenceDurationAlarm,
    elapsedRunningMs: (instance) => elapsedRunningMs(instance, now()),
    elapsedTotalMs: (instance) => elapsedTotalMs(instance, now()),
    tick,
    silence,
    silenceAlarm,
    dismissAlarm,
    connectThermometer,
    disconnectThermometer,
    getLastPacketAt,
    validateRecipe,
  };
}
