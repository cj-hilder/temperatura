import { BatteryIcon } from "./icons.jsx";
import * as t from "./theme.js";

// Battery reads 0-100 straight off the fuel gauge (MAX17048 via the
// Feather's firmware) — 15% is the threshold the To Do list specifies for
// turning the icon red, not derived from anything the gauge itself reports.
const LOW_BATTERY_PERCENT = 15;

// The one "Current temperature" line, shared by Home/Recipe/Step so the
// battery display (added after all three already had their own copy of this
// line from Phase A) doesn't triple the same red-at-15% logic. Callers keep
// owning their own connected/claimed visibility gate — this only renders the
// line's own content once they've decided to show it at all.
export default function CurrentTemperatureLine({ sample }) {
  const low = sample.battery != null && sample.battery <= LOW_BATTERY_PERCENT;
  return (
    <div style={{ padding: "10px 16px", fontSize: 14, color: t.colors.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>Current temperature: {sample.tempC == null ? "no data" : `${sample.tempC.toFixed(1)}°C`}</span>
      {sample.battery != null && (
        <BatteryIcon percent={sample.battery} title={`Battery ${sample.battery}%`} style={{ color: low ? t.colors.accentRed : t.colors.textMuted }} />
      )}
    </div>
  );
}
