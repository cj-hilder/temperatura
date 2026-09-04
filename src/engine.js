import { useCallback, useEffect, useRef, useState } from "react";
import { createAppController } from "./lib/app.js";
import { IndexedDBBackend, DEFAULT_THEME_ID } from "./lib/storage.js";
import { useKeepAlive } from "./lib/useKeepAlive.js";
import { createWebBluetoothBackend, resetPressBaseline, applyPressBaseline } from "./lib/thermometer.js";
import { playAlarm, stopAlarm, decodeSound, resolvePlaybackParams } from "./lib/alarmPlayer.js";
import { createNotifyRouter } from "./lib/notify.js";
import { buildStepAlarmDefs, durationAlarmId } from "./lib/recipe.js";
import { earliestSoundingAcrossInstances, themeIdForFiredAlarm, themeIdForAlarmId } from "./lib/alarms.js";
import { alarmName } from "./stepDisplay.js";

// Promotes AlarmDemo.jsx's wiring (keep-alive, thermometer, tick loop,
// alarmPlayer, notify) from one hardcoded fake instance to every real running
// instance across every open recipe. This is the one place that knows about
// multiple instances, which makes it the one place responsible for two
// things no single-instance module can own:
//
//  1. Composite alarm tags. alarms.js's ids ("temp1", "__dataLoss") are only
//     unique WITHIN one step. Two parallel instances of the same step would
//     both produce "temp1" — used bare as a notification tag or an
//     alarmPlayer voice id, one instance's alarm would silently replace or
//     tear down the other's. Every tag crossing into alarmPlayer/notify/the
//     SW is `${instanceId}:${alarmId}`; alarms.js/instances.js never see it.
//
//  2. Earliest-first across instances. The thermometer button is one shared
//     physical input, not scoped to whichever instance is on screen —
//     silencing needs to compare fire order across every running instance's
//     alarm state, which is exactly what earliestSoundingAcrossInstances is
//     for (alarms.js's own silenceEarliest only looks within one instance).
const VIBRATE_PATTERN = [300, 100, 300];
const TICK_INTERVAL_MS = 1000;

function compositeTag(instanceId, alarmId) {
  return `${instanceId}:${alarmId}`;
}

export function useAppEngine() {
  const keepAlive = useKeepAlive();
  // useKeepAlive() returns a fresh object every render (only its internal
  // refs are stable), so mirror it into a ref for effects that must NOT
  // re-run on every render just because this identity changed — see the tick
  // loop below, which used to list `keepAlive` as a dependency and would
  // tear down and recreate its setInterval on every render. Real BLE
  // measurements arrive roughly every 750ms, faster than the 1s tick
  // interval, so the interval was being cleared before it ever fired once:
  // no tick, no alarm evaluation, no sound, no notification — total silence,
  // despite everything else in the app working normally.
  const keepAliveRef = useRef(keepAlive);
  keepAliveRef.current = keepAlive;
  const appRef = useRef(null);
  if (!appRef.current) {
    appRef.current = createAppController({ backend: new IndexedDBBackend() });
  }
  const app = appRef.current;

  const thermometerRef = useRef(null);
  const pressStateRef = useRef(resetPressBaseline());
  const routerRef = useRef(null);
  const soundingTagsRef = useRef(new Set()); // composite tags with an active alarmPlayer voice
  const recipesRef = useRef({}); // recipeId -> recipe, for the tick loop's step lookups
  const latestSampleRef = useRef(null);
  const lastPacketAtRef = useRef(null);

  const [keepAliveStarted, setKeepAliveStarted] = useState(false);
  const [connectionState, setConnectionState] = useState("disconnected");
  const [latestSample, setLatestSample] = useState(null);
  const [lastPacketAt, setLastPacketAt] = useState(null);
  const [claimHolderId, setClaimHolderId] = useState(null);
  const [openRecipes, setOpenRecipes] = useState([]); // [{recipe, instances: [instance, ...]}]
  // Which instance's "Extend duration" dialog is open, if any — driven from
  // two places (the step page's own Extend button, and a notification's
  // Extend action arriving via the SW message listener below), so it lives
  // here rather than as local state on any one page, and App.jsx renders the
  // dialog as a top-level overlay regardless of which screen is showing.
  const [pendingExtend, setPendingExtend] = useState(null); // { instanceId } | null

  const refresh = useCallback(async () => {
    const openIds = await app.listOpenRecipeIds();
    const recipes = (await Promise.all(openIds.map((id) => app.getRecipe(id)))).filter(Boolean);
    const allInstances = await app.store.listInstances();
    recipesRef.current = Object.fromEntries(recipes.map((r) => [r.id, r]));
    setOpenRecipes(
      recipes.map((recipe) => ({
        recipe,
        // IndexedDB's getAll() orders by key (id), not insertion order — sort
        // by startedAt so "the new one" is reliably last (e.g. after
        // Duplicate) and swiping between parallel instances is chronological.
        instances: allInstances
          .filter((i) => i.recipeId === recipe.id && i.status !== "completed")
          .sort((a, b) => a.startedAt - b.startedAt),
      }))
    );
    setClaimHolderId(await app.getClaimHolderId());
  }, [app]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A fresh install has no themes; seed the bundled default once so it's
  // always resolvable as a fallback, whether or not the user ever opens
  // Settings.
  useEffect(() => {
    app.ensureDefaultTheme();
  }, [app]);

  // ---- keep-alive + notification permission (same user gesture, per spec) ----
  const startKeepAlive = useCallback(async () => {
    await keepAlive.start();
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    setKeepAliveStarted(!!keepAlive.audioRef.current?.ctx);
    routerRef.current = createNotifyRouter({
      vibrate: (pattern) => {
        if ("vibrate" in navigator) navigator.vibrate(pattern);
      },
      postToSW: (alarm) => {
        navigator.serviceWorker.controller?.postMessage({
          type: "ALARM_NOTIFY",
          tag: alarm.id,
          title: alarm.title,
          body: alarm.body,
          vibrate: alarm.vibrate,
          canExtend: alarm.canExtend,
        });
      },
    });
  }, [keepAlive]);

  // ---- silencing ----

  function stopAndForget(instanceId, alarmId) {
    const tag = compositeTag(instanceId, alarmId);
    stopAlarm(tag);
    soundingTagsRef.current.delete(tag);
  }

  // Silences every currently-sounding alarm on one instance. Needed anywhere
  // an instance is completed other than through its own explicit Silence
  // button: once completed it drops out of the tick loop's `active` list, so
  // nothing would ever call stopAlarm() for it again and a sounding voice
  // would play forever. Spec also says completing means "no more of the
  // step's alarms will trigger," which a still-sounding alarm violates in
  // spirit even before that leak.
  async function stopAllSounding(instanceId) {
    const instance = await app.store.getInstance(instanceId);
    const soundingIds = instance
      ? Object.entries(instance.alarmState)
          .filter(([, s]) => s.sounding)
          .map(([id]) => id)
      : [];
    for (const alarmId of soundingIds) {
      await app.silenceAlarm(instanceId, alarmId);
      stopAndForget(instanceId, alarmId);
    }
  }

  // In-app per-alarm Silence button and the notification's Silence action —
  // both target a specific alarm, per spec (only the thermometer button is
  // earliest-first).
  const silenceAlarm = useCallback(
    async (instanceId, alarmId) => {
      await app.silenceAlarm(instanceId, alarmId);
      stopAndForget(instanceId, alarmId);
      await refresh();
    },
    [app, refresh]
  );

  // "Extend" (step page button or a notification's Extend action): silence
  // the duration-reached alarm if it's sounding, then open the dialog.
  // Nothing about the duration itself changes yet — that's confirmExtend's
  // job, so a cancelled dialog leaves the instance untouched.
  const requestExtend = useCallback(
    async (instanceId) => {
      const instance = await app.store.getInstance(instanceId);
      if (!instance) return;
      const alarmId = durationAlarmId(instance.stepId);
      await app.silenceAlarm(instanceId, alarmId);
      stopAndForget(instanceId, alarmId);
      await refresh();
      setPendingExtend({ instanceId });
    },
    [app, refresh]
  );

  const confirmExtend = useCallback(
    async (extraMinutes) => {
      if (!pendingExtend) return;
      await app.extendDuration(pendingExtend.instanceId, extraMinutes * 60_000);
      setPendingExtend(null);
      await refresh();
    },
    [app, refresh, pendingExtend]
  );

  const cancelExtend = useCallback(() => setPendingExtend(null), []);

  const completeInstance = useCallback(
    async (instanceId) => {
      await stopAllSounding(instanceId);
      await app.completeInstance(instanceId);
      await refresh();
    },
    [app, refresh]
  );

  // Closing a recipe completes every running instance of its steps
  // (store.closeRecipe) — same leak, same fix, applied to every instance
  // being closed rather than just one.
  const closeRecipe = useCallback(
    async (recipeId) => {
      const instances = await app.store.listInstancesForRecipe(recipeId);
      for (const instance of instances) {
        if (instance.status !== "completed") await stopAllSounding(instance.id);
      }
      await app.closeRecipe(recipeId);
      await refresh();
    },
    [app, refresh]
  );

  // Thermometer button: earliest-first across every running instance.
  const silenceEarliestGlobal = useCallback(async () => {
    const allInstances = await app.store.listInstances();
    const running = allInstances.filter((i) => i.status !== "completed");
    const target = earliestSoundingAcrossInstances(
      running.map((i) => ({ instanceId: i.id, alarmState: i.alarmState }))
    );
    if (!target) return; // presses are swallowed when nothing is sounding
    await app.silenceAlarm(target.instanceId, target.alarmId);
    stopAndForget(target.instanceId, target.alarmId);
    await refresh();
  }, [app, refresh]);

  // ---- thermometer connect/disconnect ----

  const connectThermometer = useCallback(async () => {
    if (!thermometerRef.current) thermometerRef.current = createWebBluetoothBackend();
    setConnectionState("connecting");
    pressStateRef.current = resetPressBaseline();
    try {
      await thermometerRef.current.connect({
        onMeasurement: (sample) => {
          const { state, presses } = applyPressBaseline(pressStateRef.current, sample.pressCount);
          pressStateRef.current = state;
          latestSampleRef.current = sample;
          const at = Date.now();
          lastPacketAtRef.current = at;
          setLatestSample(sample);
          setLastPacketAt(at);
          for (let i = 0; i < presses; i++) silenceEarliestGlobal();
        },
        onDisconnect: () => setConnectionState("disconnected"),
        onReconnecting: (attempt, max) => setConnectionState(`reconnecting (${attempt}/${max})`),
        onReconnected: () => {
          pressStateRef.current = resetPressBaseline();
          setConnectionState("connected");
        },
        onReconnectGaveUp: () => setConnectionState("gave up"),
      });
      setConnectionState("connected");
    } catch {
      setConnectionState("disconnected");
    }
  }, [silenceEarliestGlobal]);

  const disconnectThermometer = useCallback(() => {
    thermometerRef.current?.disconnect();
    setConnectionState("disconnected");
  }, []);

  // ---- SW ALARM_SILENCED / ALARM_EXTEND_REQUESTED (notification tap) ----
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event) => {
      const sep = event.data?.tag?.indexOf(":") ?? -1;
      if (sep < 0) return;
      const instanceId = event.data.tag.slice(0, sep);
      if (event.data.type === "ALARM_SILENCED") {
        silenceAlarm(instanceId, event.data.tag.slice(sep + 1));
      } else if (event.data.type === "ALARM_EXTEND_REQUESTED") {
        // The tag's alarm half is always the duration alarm here — the SW
        // only ever offers "extend" on a duration-reached notification (see
        // canExtend below) — so requestExtend only needs the instance id.
        requestExtend(instanceId);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [silenceAlarm, requestExtend]);

  // ---- the shared 1-second tick loop, over every running/paused instance ----
  useEffect(() => {
    const timer = setInterval(async () => {
      // refresh() MUST run every cycle no matter what — it's the only thing
      // that makes the UI's elapsed-time display advance at all (there is no
      // independent re-render timer; pages recompute elapsed from Date.now()
      // but only ever do that when React re-renders them). Without this
      // try/finally, a single instance whose tick throws (a bad/legacy
      // record, a lookup miss, anything) would abort the whole cycle before
      // reaching refresh() — freezing the display AND silencing every
      // instance's alarms, every single cycle, forever, with no visible
      // error unless someone happens to be watching devtools.
      try {
        const allInstances = await app.store.listInstances();
        const active = allInstances.filter((i) => i.status === "running" || i.status === "paused");
        if (active.length === 0) {
          routerRef.current?.tick([]);
          return;
        }

        const sample = latestSampleRef.current;
        const packetAt = lastPacketAtRef.current;
        const msSinceLastPacket = packetAt != null ? Date.now() - packetAt : null;
        const readingValid = !!(sample && sample.probePresent && sample.tempC != null);
        const tempC = sample?.tempC ?? null;

        // Read once per cycle, not once per alarm — every instance/alarm this
        // tick shares the same theme map and data-loss theme id, so this is
        // one read pair regardless of how many are running.
        const themesById = new Map((await app.store.listAlarmThemes()).map((t) => [t.id, t]));
        const dataLossThemeId = await app.getDataLossAlarmTheme();
        const themeIds = { dataLossThemeId, defaultThemeId: DEFAULT_THEME_ID };

        const allSounding = [];
        for (const instance of active) {
          // Isolated per instance too: one bad instance must not stop the
          // rest from ticking or stop the notify router from seeing them.
          try {
            const recipe = recipesRef.current[instance.recipeId];
            const step = recipe?.steps.find((s) => s.id === instance.stepId);
            if (!recipe || !step) continue;

            const stepAlarmDefs = buildStepAlarmDefs(step, { durationExtensionMs: instance.durationExtensionMs || 0 });
            const hasTempInterest = !!(step.tempBand || step.tempAlarms.length > 0);
            const result = await app.tick(instance.id, {
              stepAlarmDefs,
              hasTempInterest,
              tempBand: step.tempBand,
              duration: step.duration,
              tempC,
              msSinceLastPacket,
              readingValid,
            });

            const stillSounding = new Set(result.sounding.map((id) => compositeTag(instance.id, id)));
            for (const fired of result.newlyFired) {
              const tag = compositeTag(instance.id, fired.id);
              const ctx = keepAliveRef.current.audioRef.current?.ctx;
              if (ctx) {
                const theme = themesById.get(themeIdForFiredAlarm(fired, themeIds));
                const soundBuf = theme ? await app.store.getSound(theme.id) : null;
                // Decoding only happens here, on an actual fire — rare
                // compared to the once-a-second tick — so this is not a
                // per-tick cost.
                const buffer = soundBuf ? await decodeSound(ctx, soundBuf) : null;
                if (soundBuf && !buffer) console.error(`theme "${theme.id}" sound failed to decode — falling back to the built-in tone`);
                const { rampSeconds, repeatIntervalSeconds } = resolvePlaybackParams(theme);
                playAlarm(ctx, tag, { buffer, rampSeconds, repeatIntervalSeconds });
              }
              soundingTagsRef.current.add(tag);
            }
            for (const tag of [...soundingTagsRef.current]) {
              if (tag.startsWith(`${instance.id}:`) && !stillSounding.has(tag)) {
                stopAlarm(tag);
                soundingTagsRef.current.delete(tag);
              }
            }
            for (const alarmId of result.sounding) {
              const theme = themesById.get(themeIdForAlarmId(alarmId, stepAlarmDefs, themeIds));
              const { vibrate } = resolvePlaybackParams(theme);
              allSounding.push({
                id: compositeTag(instance.id, alarmId),
                title: recipe.name,
                body: alarmName(step, alarmId),
                vibrate: vibrate ? VIBRATE_PATTERN : [],
                // Only a duration-reached notification offers Extend — the
                // one alarm kind "add more time" is actually meaningful for.
                canExtend: alarmId === durationAlarmId(step.id),
              });
            }
          } catch (err) {
            console.error(`tick failed for instance ${instance.id}`, err);
          }
        }
        routerRef.current?.tick(allSounding);
      } catch (err) {
        console.error("tick loop failed", err);
      } finally {
        refresh();
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(timer);
    // Deliberately NOT depending on `keepAlive` — see keepAliveRef's comment
    // above. `app` and `refresh` are stable for the life of this hook instance.
  }, [app, refresh]);

  return {
    app,
    refresh,
    keepAliveStarted,
    startKeepAlive,
    connectionState,
    connectThermometer,
    disconnectThermometer,
    latestSample,
    lastPacketAt,
    claimHolderId,
    openRecipes,
    silenceAlarm,
    silenceEarliestGlobal,
    completeInstance,
    closeRecipe,
    pendingExtend,
    requestExtend,
    confirmExtend,
    cancelExtend,
    // For SettingsPage's pick-time decode/duration check — must reuse this
    // exact context, not a fresh one, per useKeepAlive.js's own rationale.
    getAudioContext: () => keepAliveRef.current.audioRef.current?.ctx,
  };
}
