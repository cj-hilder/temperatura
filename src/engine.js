import { useCallback, useEffect, useRef, useState } from "react";
import { createAppController } from "./lib/app.js";
import { IndexedDBBackend } from "./lib/storage.js";
import { useKeepAlive } from "./lib/useKeepAlive.js";
import { createWebBluetoothBackend, resetPressBaseline, applyPressBaseline } from "./lib/thermometer.js";
import { playAlarm, stopAlarm } from "./lib/alarmPlayer.js";
import { createNotifyRouter } from "./lib/notify.js";
import { buildStepAlarmDefs } from "./lib/recipe.js";
import { earliestSoundingAcrossInstances } from "./lib/alarms.js";
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

  // ---- SW ALARM_SILENCED (notification tap) ----
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event) => {
      if (event.data?.type !== "ALARM_SILENCED") return;
      const sep = event.data.tag.indexOf(":");
      if (sep < 0) return;
      silenceAlarm(event.data.tag.slice(0, sep), event.data.tag.slice(sep + 1));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [silenceAlarm]);

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

        const allSounding = [];
        for (const instance of active) {
          // Isolated per instance too: one bad instance must not stop the
          // rest from ticking or stop the notify router from seeing them.
          try {
            const recipe = recipesRef.current[instance.recipeId];
            const step = recipe?.steps.find((s) => s.id === instance.stepId);
            if (!recipe || !step) continue;

            const stepAlarmDefs = buildStepAlarmDefs(step);
            const hasTempInterest = !!(step.tempBand || step.tempAlarms.length > 0);
            const result = await app.tick(instance.id, {
              stepAlarmDefs,
              hasTempInterest,
              tempBand: step.tempBand,
              tempC,
              msSinceLastPacket,
              readingValid,
            });

            const stillSounding = new Set(result.sounding.map((id) => compositeTag(instance.id, id)));
            for (const fired of result.newlyFired) {
              const tag = compositeTag(instance.id, fired.id);
              const ctx = keepAliveRef.current.audioRef.current?.ctx;
              if (ctx) playAlarm(ctx, tag, { buffer: null, rampSeconds: 2 });
              soundingTagsRef.current.add(tag);
            }
            for (const tag of [...soundingTagsRef.current]) {
              if (tag.startsWith(`${instance.id}:`) && !stillSounding.has(tag)) {
                stopAlarm(tag);
                soundingTagsRef.current.delete(tag);
              }
            }
            for (const alarmId of result.sounding) {
              allSounding.push({
                id: compositeTag(instance.id, alarmId),
                title: recipe.name,
                body: alarmName(step, alarmId),
                vibrate: VIBRATE_PATTERN,
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
    completeInstance,
    closeRecipe,
  };
}
