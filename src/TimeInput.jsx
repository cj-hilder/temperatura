import { useState } from "react";
import { msToDHMS, timeBoxChange } from "./lib/format.js";
import * as t from "./theme.js";

const DAY_MS = 24 * 3_600_000;

// The standard time-entry control: boxes for hours, minutes and seconds
// separated by colons, each showing 00 at zero — replaces the mixture of ad
// hoc minutes-only (step duration, time-alarm timing) and seconds-only
// number inputs the app used to have, so every duration is entered the same
// way everywhere. Always speaks milliseconds at its own boundary — a caller
// whose underlying field is natively some other unit converts at the call
// site, not in here.
//
// Boxes are `type="text"` rather than `type="number"`: a number input
// normalizes away the leading zero as you type, which breaks the "always
// shows 00" look the spec asks for. onFocus selects the box's contents so a
// tap-and-type overwrites it in one go, the usual segmented-time-entry feel.
function Box({ value, max, digits = 2, onChange }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      style={{ ...t.input, width: digits === 2 ? 36 : 46, padding: "6px 2px", textAlign: "center" }}
      value={String(value).padStart(2, "0")}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        // Keep only the last `digits` digits typed, so a box that already
        // reads "00" and gets a single keystroke becomes "0N", not "00N".
        const typed = e.target.value.replace(/\D/g, "").slice(-digits);
        onChange(Math.min(max, typed === "" ? 0 : Number(typed)));
      }}
    />
  );
}

// Days: steps can last for days or months, but nearly all are minutes or
// hours, so the days box stays out of the way until it's needed. It appears
// when the value is a day or more, when the hours box is pushed past 23 (36 h
// rolls over into 1 d 12 h — see timeBoxChange), or when "+ days" is tapped;
// once revealed it stays for the life of this control, so it can't vanish
// from under someone halfway through typing a number of days.
export default function TimeInput({ valueMs, onChangeMs }) {
  const [revealed, setRevealed] = useState(false);
  const showDays = revealed || valueMs >= DAY_MS;
  const { d, h, m, s } = msToDHMS(valueMs);
  const set = (field, value) => {
    const { ms, rolledIntoDays } = timeBoxChange(valueMs, field, value);
    if (rolledIntoDays) setRevealed(true);
    onChangeMs(ms);
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {showDays && (
        <>
          <Box value={d} max={999} digits={3} onChange={(v) => set("d", v)} />
          <span style={{ marginRight: 4 }}>d</span>
        </>
      )}
      {/* Up to 99, so 24 or more can be typed — and then rolls over into days. */}
      <Box value={h} max={99} onChange={(v) => set("h", v)} />
      <span>:</span>
      <Box value={m} max={59} onChange={(v) => set("m", v)} />
      <span>:</span>
      <Box value={s} max={59} onChange={(v) => set("s", v)} />
      {!showDays && (
        <button
          type="button"
          style={{ border: "none", background: "transparent", color: t.colors.textMuted, fontSize: 12, padding: "0 4px", cursor: "pointer", textDecoration: "underline" }}
          onClick={() => setRevealed(true)}
        >
          + days
        </button>
      )}
    </span>
  );
}
