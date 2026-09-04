// The controller. Follows Ride the Wind's createAppController({ backend, now,
// ... }) shape: injected backend/clock/thermometer, builds a Store
// internally, returns a flat method-per-operation object plus the raw store
// handle. No pub/sub — callers get results back from calls, same as RTW.
import { IndexedDBBackend, MemoryBackend, Store } from "./storage.js";
import { validateRecipe } from "./recipe.js";
import {
  startInstance, pauseInstance, resumeInstance, restartInstance, completeInstance,
  duplicateInstance, setTag as setInstanceTag, elapsedRunningMs, elapsedTotalMs,
  advanceInBand, isMeasured, deriveProvenance,
  acquireClaimOnStart, releaseClaimOnComplete, toggleClaim as toggleClaimHolder,
} from "./instances.js";
import { evaluateAlarms, silenceEarliest, silenceById } from "./alarms.js";

const CLAIM_SETTING_KEY = "claimHolderId";

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
  const closeRecipe = (id) => store.closeRecipe(id, now());

  // ---- Claim ----

  const getClaimHolderId = () => store.getSetting(CLAIM_SETTING_KEY, null);

  async function toggleClaim(instanceId) {
    const current = await getClaimHolderId();
    const next = toggleClaimHolder(current, instanceId);
    await store.setSetting(CLAIM_SETTING_KEY, next);
    return next;
  }

  // ---- Instance lifecycle ----

  async function doStartInstance({ id, recipeId, stepId, stepAlarmDefs }) {
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
  async function tick(instanceId, { stepAlarmDefs, hasTempInterest, tempBand, duration, tempC, msSinceLastPacket, readingValid }) {
    const instance = await store.getInstance(instanceId);
    const claimHolderId = await getClaimHolderId();
    const claimed = claimHolderId === instanceId;
    const measured = isMeasured({ claimed, msSinceLastPacket, readingValid });
    const inBand = measured ? isInBand(tempC, tempBand) : instance.lastKnownInBand;

    const t = now();
    const advanced = advanceInBand(instance, { measured, inBand }, t);
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

  // ---- Thermometer ----

  const connectThermometer = (handlers) => thermometer?.connect(handlers);
  const disconnectThermometer = () => thermometer?.disconnect();
  const getLastPacketAt = () => thermometer?.getLastPacketAt() ?? null;

  return {
    store,
    createRecipe, getRecipe, listRecipes, updateRecipe, deleteRecipe,
    openRecipe, listOpenRecipeIds, closeRecipe,
    getClaimHolderId, toggleClaim,
    startInstance: doStartInstance,
    pauseInstance: doPauseInstance,
    resumeInstance: doResumeInstance,
    restartInstance: doRestartInstance,
    completeInstance: doCompleteInstance,
    duplicateInstance: doDuplicateInstance,
    setTag: doSetTag,
    elapsedRunningMs: (instance) => elapsedRunningMs(instance, now()),
    elapsedTotalMs: (instance) => elapsedTotalMs(instance, now()),
    tick,
    silence,
    silenceAlarm,
    connectThermometer,
    disconnectThermometer,
    getLastPacketAt,
    validateRecipe,
  };
}
