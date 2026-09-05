import { msToHMS, hmsToMs } from "./lib/format.js";
import * as t from "./theme.js";

// The standard time-entry control: three boxes (hours, minutes, seconds)
// separated by colons, each showing 00 at zero — replaces the mixture of ad
// hoc minutes-only (step duration, time-alarm timing) and seconds-only
// number inputs the app used to have, so every duration is entered the same
// way everywhere. Always speaks milliseconds at its own boundary — a caller
// whose underlying field is natively some other unit (there are none left
// after this pass, but the shape stays useful) converts at the call site,
// not in here.
//
// Boxes are `type="text"` rather than `type="number"`: a number input
// normalizes away the leading zero as you type, which breaks the "always
// shows 00" look the spec asks for. onFocus selects the box's contents so a
// tap-and-type overwrites it in one go, the usual segmented-time-entry feel.
function Box({ value, max, onChange }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      style={{ ...t.input, width: 36, padding: "6px 2px", textAlign: "center" }}
      value={String(value).padStart(2, "0")}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        // Keep only the last two digits typed, so a box that already reads
        // "00" and gets a single keystroke becomes "0N", not "00N".
        const digits = e.target.value.replace(/\D/g, "").slice(-2);
        onChange(Math.min(max, digits === "" ? 0 : Number(digits)));
      }}
    />
  );
}

export default function TimeInput({ valueMs, onChangeMs }) {
  const { h, m, s } = msToHMS(valueMs);
  const set = (patch) => onChangeMs(hmsToMs({ h, m, s, ...patch }));

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Box value={h} max={999} onChange={(v) => set({ h: v })} />
      <span>:</span>
      <Box value={m} max={59} onChange={(v) => set({ m: v })} />
      <span>:</span>
      <Box value={s} max={59} onChange={(v) => set({ s: v })} />
    </span>
  );
}
