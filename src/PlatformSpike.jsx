import { useEffect, useRef, useState } from "react";
import { useKeepAlive } from "./lib/useKeepAlive.js";

// Throwaway per build-plan §5 step 2: proves keep-alive + a fake alarm +
// the full notification round trip work together with the screen off, on
// this exact phone/Chrome/Android combination, before any real logic exists
// to build on top of it. Deleted wholesale when step 7 lands the real UI.

const ALARM_TAG = "platform-spike-alarm";
const VIBRATE_PATTERN = [300, 100, 300];
const REPOST_INTERVAL_MS = 5000;

export default function PlatformSpike() {
  const keepAlive = useKeepAlive();
  const [status, setStatus] = useState({ wakeLock: false, audio: "unknown", mediaSession: "unknown" });
  const [notifPermission, setNotifPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const [sounding, setSounding] = useState(false);

  const soundingRef = useRef(false);
  const repostTimerRef = useRef(null);
  const beepRef = useRef(null); // { osc, gain } — separate from the keep-alive's silent drone

  // Reflect a silence that arrived from the notification (app was hidden)
  // back into this page's own state and UI.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event) => {
      if (event.data?.type === "ALARM_SILENCED" && event.data.tag === ALARM_TAG) {
        stopSounding();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const refreshStatus = () => {
    setStatus({
      wakeLock: !!keepAlive.wakeRef.current,
      audio: keepAlive.audioRef.current?.ctx?.state || "not started",
      mediaSession: "mediaSession" in navigator ? navigator.mediaSession.playbackState : "unsupported",
    });
  };

  const handleStartKeepAlive = async () => {
    await keepAlive.start();
    // Must request permission inside this same user gesture — a background
    // permission prompt is never shown (see ble-hr-tool app.js:1473-1475).
    if ("Notification" in window && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    }
    refreshStatus();
  };

  const startBeep = () => {
    const ctx = keepAlive.audioRef.current?.ctx;
    if (!ctx || beepRef.current) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, ctx.currentTime); // audible, unlike the keep-alive drone
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.connect(gain);
    osc.start();
    beepRef.current = { osc, gain };
  };

  const stopBeep = () => {
    if (!beepRef.current) return;
    try { beepRef.current.osc.stop(); } catch {}
    try { beepRef.current.gain.disconnect(); } catch {}
    beepRef.current = null;
  };

  const postAlarmNotify = () => {
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: "ALARM_NOTIFY",
      tag: ALARM_TAG,
      title: "Temperatura",
      body: "Fake alarm firing (platform spike)",
      vibrate: VIBRATE_PATTERN,
    });
  };

  const fireAlarm = () => {
    if (soundingRef.current) return;
    soundingRef.current = true;
    setSounding(true);
    startBeep();

    if (document.visibilityState === "visible") {
      if ("vibrate" in navigator) navigator.vibrate(VIBRATE_PATTERN);
    } else {
      postAlarmNotify();
    }

    // Re-posts only matter while hidden (visible has the on-screen Silence
    // button and needs no nagging notification) — this only proves anything
    // if keep-alive is genuinely holding this timer alive in the background.
    repostTimerRef.current = setInterval(() => {
      if (document.visibilityState !== "visible") postAlarmNotify();
    }, REPOST_INTERVAL_MS);
  };

  const stopSounding = () => {
    soundingRef.current = false;
    setSounding(false);
    stopBeep();
    if (repostTimerRef.current) {
      clearInterval(repostTimerRef.current);
      repostTimerRef.current = null;
    }
  };

  const silenceInApp = () => {
    stopSounding();
    // Covers the case where a notification is already up from an earlier
    // hidden spell — nothing left to silence via notificationclick.
    navigator.serviceWorker.controller?.postMessage({ type: "ALARM_SILENCE_ACK", tag: ALARM_TAG });
  };

  return (
    <div style={{ padding: "1rem", fontFamily: "sans-serif" }}>
      <h1>Temperatura — platform spike</h1>
      <p>Proves keep-alive + a fake alarm + the notification round trip survive the screen being off.</p>

      <section style={{ marginBottom: "1.5rem" }}>
        <button onClick={handleStartKeepAlive}>Start keep-alive</button>
        <ul>
          <li>Wake lock: {status.wakeLock ? "held" : "not held"}</li>
          <li>Audio context: {status.audio}</li>
          <li>Media session: {status.mediaSession}</li>
          <li>Notification permission: {notifPermission}</li>
        </ul>
      </section>

      <section>
        <button onClick={fireAlarm} disabled={sounding}>Fire fake alarm</button>{" "}
        <button onClick={silenceInApp} disabled={!sounding}>Silence</button>
        <p>{sounding ? "Sounding…" : "Silent"}</p>
      </section>
    </div>
  );
}
