import { useEffect, useRef, useState } from "react";
import { createWebBluetoothBackend, applyPressBaseline, resetPressBaseline } from "./lib/thermometer.js";

// Throwaway per build-plan §5 step 5: verifies packet parsing and press
// counting against the real Feather before anything is wired to alarms.
// Deleted wholesale when step 7 lands the real UI.

const MAX_LOG_LINES = 20;

export default function BleReadout() {
  const backendRef = useRef(null);
  const pressStateRef = useRef(resetPressBaseline());
  const lastPacketAtRef = useRef(null);

  const [state, setState] = useState("disconnected");
  const [sample, setSample] = useState(null);
  const [sessionPresses, setSessionPresses] = useState(0);
  const [msSinceLastPacket, setMsSinceLastPacket] = useState(null);
  const [log, setLog] = useState([]);

  const addLog = (line) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, MAX_LOG_LINES));
  };

  // Ticks the "time since last packet" display — a plain interval, not a
  // second timer racing the backend's own logic (there isn't one; the
  // backend just exposes the timestamp, see thermometer.js's header comment).
  useEffect(() => {
    const id = setInterval(() => {
      if (lastPacketAtRef.current != null) setMsSinceLastPacket(Date.now() - lastPacketAtRef.current);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const resetPressTracking = () => {
    pressStateRef.current = resetPressBaseline();
    setSessionPresses(0);
  };

  const handleMeasurement = (s) => {
    const { state: nextPressState, presses } = applyPressBaseline(pressStateRef.current, s.pressCount);
    pressStateRef.current = nextPressState;
    if (presses > 0) setSessionPresses((n) => n + presses);
    lastPacketAtRef.current = Date.now();
    setSample(s);
  };

  const handleConnect = async () => {
    if (!backendRef.current) backendRef.current = createWebBluetoothBackend();
    setState("connecting");
    resetPressTracking();
    try {
      await backendRef.current.connect({
        onMeasurement: handleMeasurement,
        onDisconnect: () => {
          addLog("disconnected");
          setState("disconnected");
        },
        onReconnecting: (attempt, max) => {
          addLog(`reconnecting (attempt ${attempt}/${max})`);
          setState(`reconnecting (attempt ${attempt}/${max})`);
        },
        onReconnected: () => {
          addLog("reconnected — press baseline reset");
          resetPressTracking();
          setState("connected");
        },
        onReconnectGaveUp: () => {
          addLog("gave up reconnecting");
          setState("gave up");
        },
      });
      addLog("connected");
      setState("connected");
    } catch (err) {
      addLog(`connect failed: ${err.message}`);
      setState("disconnected");
    }
  };

  const handleDisconnect = () => {
    backendRef.current?.disconnect();
    addLog("disconnected (manual)");
    setState("disconnected");
  };

  return (
    <div style={{ padding: "1rem", fontFamily: "sans-serif" }}>
      <h1>Temperatura — BLE readout</h1>
      <p>Verifies packet parsing and press counting against the real Feather before anything is wired to alarms.</p>

      <section style={{ marginBottom: "1.5rem" }}>
        <button onClick={handleConnect} disabled={state === "connected" || state.startsWith("reconnecting")}>Connect</button>{" "}
        <button onClick={handleDisconnect} disabled={state === "disconnected"}>Disconnect</button>
        <p>State: {state}</p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Latest packet</h2>
        <ul>
          <li>Sequence: {sample?.seq ?? "—"}</li>
          <li>Temperature: {sample?.tempC == null ? "no reading" : `${sample.tempC.toFixed(2)}°C`}</li>
          <li>Battery: {sample?.battery ?? "—"}%</li>
          <li>Raw press count: {sample?.pressCount ?? "—"}</li>
          <li>Probe present: {sample ? String(sample.probePresent) : "—"}</li>
          <li>Button held: {sample ? String(sample.buttonHeld) : "—"}</li>
          <li>Time since last packet: {msSinceLastPacket == null ? "—" : `${msSinceLastPacket}ms`}</li>
        </ul>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Presses this session: {sessionPresses}</h2>
        <p>Resets on connect and on every successful reconnect.</p>
      </section>

      <section>
        <h2>Event log</h2>
        <ul>
          {log.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}
