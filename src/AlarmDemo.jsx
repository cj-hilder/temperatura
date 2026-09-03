import { useEffect, useRef, useState } from "react";
import { useKeepAlive } from "./lib/useKeepAlive.js";
import { createAppController } from "./lib/app.js";
import { MemoryBackend } from "./lib/storage.js";
import { playAlarm, stopAlarm, decodeSound } from "./lib/alarmPlayer.js";
import { createNotifyRouter } from "./lib/notify.js";

// Throwaway per build-plan §5 step 6: proves alarmPlayer.js + notify.js
// against REAL alarms.js/instances.js output, replacing the platform spike's
// hardcoded fake-alarm tag and placeholder beep. Deleted wholesale when
// step 7 lands the real UI.

const RECIPE_ID = "demo-recipe";
const STEP_ID = "demo-step";
const INSTANCE_ID = "demo-instance";
const VIBRATE_PATTERN = [300, 100, 300];
const DATA_LOSS_ALARM_ID = "__dataLoss";

const STEP_ALARM_DEFS = [
  { id: "temp1", kind: "temperature", name: "Too hot", thresholdC: 30, direction: "heating", theme: null },
  { id: "time1", kind: "time", name: "Check", atMs: 10000, repeat: true, intervalMs: 10000, theme: null },
];

function alarmTitle(id) {
  if (id === DATA_LOSS_ALARM_ID) return "Data loss";
  return STEP_ALARM_DEFS.find((d) => d.id === id)?.name ?? id;
}

export default function AlarmDemo() {
  const keepAlive = useKeepAlive();
  const appRef = useRef(null);
  if (!appRef.current) {
    appRef.current = createAppController({ backend: new MemoryBackend(), now: () => Date.now() });
  }
  const routerRef = useRef(null);
  const soundingRef = useRef([]); // previous tick's sounding ids, for stop bookkeeping
  const tickTimerRef = useRef(null);
  const customBufferRef = useRef(null); // decoded AudioBuffer from the file picker, if any
  const tempCRef = useRef(20); // setInterval captures a stale closure over state, not refs

  const [keepAliveStarted, setKeepAliveStarted] = useState(false);
  const [started, setStarted] = useState(false);
  const [tempC, setTempCValue] = useState(20);
  const [sounding, setSounding] = useState([]); // [{id, title, body, vibrate}]
  const [log, setLog] = useState([]);
  const [soundLabel, setSoundLabel] = useState("synthesized default");

  const setTempC = (v) => {
    tempCRef.current = v;
    setTempCValue(v);
  };

  const addLog = (line) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 20));
  };

  const handleSilence = async (alarmId) => {
    await appRef.current.silenceAlarm(INSTANCE_ID, alarmId);
    stopAlarm(alarmId);
    soundingRef.current = soundingRef.current.filter((id) => id !== alarmId);
    setSounding((prev) => prev.filter((a) => a.id !== alarmId));
    addLog(`silenced: ${alarmTitle(alarmId)}`);
  };

  // Silencing from the notification (app hidden) arrives as a postMessage —
  // same effect as the in-app Silence button, per spec ("identical in effect").
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event) => {
      if (event.data?.type === "ALARM_SILENCED") handleSilence(event.data.tag);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const handleStartKeepAlive = async () => {
    await keepAlive.start();
    // Must request permission inside this same user gesture.
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
  };

  const doTick = async () => {
    const result = await appRef.current.tick(INSTANCE_ID, {
      stepAlarmDefs: STEP_ALARM_DEFS,
      hasTempInterest: true,
      tempBand: null,
      tempC: tempCRef.current,
      msSinceLastPacket: 0,
      readingValid: true,
    });

    for (const fired of result.newlyFired) {
      const ctx = keepAlive.audioRef.current?.ctx;
      if (ctx) playAlarm(ctx, fired.id, { buffer: customBufferRef.current, rampSeconds: 2 });
      addLog(`fired: ${fired.name}`);
    }

    for (const id of soundingRef.current) {
      if (!result.sounding.includes(id)) stopAlarm(id);
    }
    soundingRef.current = result.sounding;

    const soundingAlarms = result.sounding.map((id) => ({
      id,
      title: "Temperatura",
      body: alarmTitle(id),
      vibrate: VIBRATE_PATTERN,
    }));
    routerRef.current?.tick(soundingAlarms);
    setSounding(soundingAlarms);
  };

  const handleStart = async () => {
    await appRef.current.createRecipe({ id: RECIPE_ID, name: "Demo", description: "", notes: [], servings: "", ingredients: [], steps: [] });
    await appRef.current.startInstance({ id: INSTANCE_ID, recipeId: RECIPE_ID, stepId: STEP_ID, stepAlarmDefs: STEP_ALARM_DEFS });
    setStarted(true);
    addLog("instance started");
    tickTimerRef.current = setInterval(doTick, 1000);
  };

  const handleStop = () => {
    clearInterval(tickTimerRef.current);
    tickTimerRef.current = null;
    for (const id of soundingRef.current) stopAlarm(id);
    soundingRef.current = [];
    routerRef.current?.stop();
    setStarted(false);
    setSounding([]);
  };

  const handleFilePick = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const ctx = keepAlive.audioRef.current?.ctx;
    if (!ctx) {
      addLog("start keep-alive first");
      return;
    }
    const buf = await file.arrayBuffer();
    const decoded = await decodeSound(ctx, buf);
    if (decoded) {
      customBufferRef.current = decoded;
      setSoundLabel(`${file.name} (${decoded.duration.toFixed(1)}s)`);
      addLog(`decoded ${file.name}`);
    } else {
      addLog(`decode failed for ${file.name} — falling back to synthesized default`);
    }
  };

  const handleGarbageTest = async () => {
    const ctx = keepAlive.audioRef.current?.ctx;
    if (!ctx) {
      addLog("start keep-alive first");
      return;
    }
    const garbage = new TextEncoder().encode("not audio data").buffer;
    const decoded = await decodeSound(ctx, garbage);
    addLog(decoded ? "unexpected: garbage decoded" : "garbage bytes correctly failed to decode — fallback engaged");
  };

  return (
    <div style={{ padding: "1rem", fontFamily: "sans-serif" }}>
      <h1>Temperatura — real alarm demo</h1>
      <p>Proves alarmPlayer.js + notify.js against real alarms.js/instances.js output.</p>

      <section style={{ marginBottom: "1.5rem" }}>
        <button onClick={handleStartKeepAlive} disabled={keepAliveStarted}>Start keep-alive</button>
        <p>Keep-alive: {keepAliveStarted ? "running" : "not started"}</p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <label>
          Temperature (°C):{" "}
          <input type="number" value={tempC} onChange={(e) => setTempC(Number(e.target.value))} />
        </label>{" "}
        <button onClick={handleStart} disabled={!keepAliveStarted || started}>Start instance</button>{" "}
        <button onClick={handleStop} disabled={!started}>Stop</button>
        <p>"Too hot" fires above 30°C, re-arms below 28°C. "Check" repeats every 10s while running.</p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Sound source: {soundLabel}</h2>
        <input type="file" accept="audio/mpeg" onChange={handleFilePick} disabled={!keepAliveStarted} />{" "}
        <button onClick={handleGarbageTest} disabled={!keepAliveStarted}>Test decode-failure fallback</button>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Sounding alarms</h2>
        {sounding.length === 0 && <p>None</p>}
        <ul>
          {sounding.map((a) => (
            <li key={a.id}>
              {a.body}{" "}
              <button onClick={() => handleSilence(a.id)}>Silence</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Event log</h2>
        <ul>{log.map((line, i) => <li key={i}>{line}</li>)}</ul>
      </section>
    </div>
  );
}
