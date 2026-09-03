import { useState } from "react";
import PlatformSpike from "./PlatformSpike.jsx";
import BleReadout from "./BleReadout.jsx";

// Temporary: both of these are throwaway diagnostics standing in for the app
// until step 7 lands the real home/recipe/step UI. Kept as a switcher rather
// than replacing one with the other — step 6 (alarmPlayer.js/notify.js) will
// likely want to fire a real alarm against real BLE data at some point, which
// is exactly the union of what these two screens each prove separately.
export default function App() {
  const [tab, setTab] = useState("spike");
  return (
    <div>
      <nav style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #ccc", fontFamily: "sans-serif" }}>
        <button onClick={() => setTab("spike")} disabled={tab === "spike"}>Platform spike</button>{" "}
        <button onClick={() => setTab("ble")} disabled={tab === "ble"}>BLE readout</button>
      </nav>
      {tab === "spike" ? <PlatformSpike /> : <BleReadout />}
    </div>
  );
}
