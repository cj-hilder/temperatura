import { BatteryIcon } from "./icons.jsx";
import * as t from "./theme.js";

// Battery reads 0-100 straight off the fuel gauge (MAX17048 via the
// Feather's firmware) — 15% is the threshold the To Do list specifies for
// turning the icon red, not derived from anything the gauge itself reports.
const LOW_BATTERY_PERCENT = 15;

// The "current temperature" line, shared by Home/Recipe/Step so the battery
// display doesn't triple the same red-at-15% logic. Callers keep owning their
// own visibility gate — this only renders the line's own content.
//
// One line per probe: `probeName` says whose reading it is. `sample` can be
// null — a connected probe that hasn't reported yet (a BBQ only notifies when
// its value changes) reads "no data", same as a probe with nothing attached.
// A probe that reports no battery level (BBQ) simply shows no icon.
export default function CurrentTemperatureLine({ sample, probeName }) {
  const battery = sample?.battery ?? null;
  const low = battery != null && battery <= LOW_BATTERY_PERCENT;
  const temp = sample?.tempC == null ? "no data" : `${sample.tempC.toFixed(1)}°C`;
  return (
    <div style={{ padding: "10px 16px", fontSize: 14, color: t.colors.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>{probeName ? `${probeName}: ${temp}` : `Current temperature: ${temp}`}</span>
      {battery != null && (
        <BatteryIcon percent={battery} title={`Battery ${battery}%`} style={{ color: low ? t.colors.accentRed : t.colors.textMuted }} />
      )}
    </div>
  );
}
