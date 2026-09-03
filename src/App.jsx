import { useState } from "react";
import PlatformSpike from "./PlatformSpike.jsx";
import BleReadout from "./BleReadout.jsx";
import AlarmDemo from "./AlarmDemo.jsx";

// Temporary: all three of these are throwaway diagnostics standing in for the
// app until step 7 lands the real home/recipe/step UI. Kept as a switcher
// rather than replacing one with the next, since each still proves something
// distinct — keep-alive/notifications, real BLE data, and now real alarm
// playback/routing.
export default function App() {
  const [tab, setTab] = useState("spike");
  return (
    <div>
      <nav style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #ccc", fontFamily: "sans-serif" }}>
        <button onClick={() => setTab("spike")} disabled={tab === "spike"}>Platform spike</button>{" "}
        <button onClick={() => setTab("ble")} disabled={tab === "ble"}>BLE readout</button>{" "}
        <button onClick={() => setTab("alarm")} disabled={tab === "alarm"}>Alarm demo</button>
      </nav>
      {tab === "spike" && <PlatformSpike />}
      {tab === "ble" && <BleReadout />}
      {tab === "alarm" && <AlarmDemo />}
    </div>
  );
}
