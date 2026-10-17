// Display formatting. Pure — no DOM, no clock. Deliberately much smaller than
// Ride the Wind's format.js: there is no unit-settings toggle in this spec
// (one fixed palette, °C only), so RTW's settings-injection machinery
// (setFormatSettings/DEFAULT_UNITS) is left out rather than ported unused.

export function formatTemperature(celsius) {
  if (celsius == null || Number.isNaN(celsius)) return "";
  // One decimal place, not RTW's whole-degree choice — temperature alarms
  // fire and re-arm on the reading rounded to 0.1 °C (alarms.js
  // thresholdSide), so this is exactly the value they judge.
  return `${celsius.toFixed(1)}°C`;
}

/**
 * What a temperature entry box keeps while the user types, and the number it
 * means. `text` is the typing so far, cleaned to an optional leading minus,
 * digits and one decimal point (a comma counts as the point, for keyboards
 * that offer only that). `value` is null while the text isn't a number yet —
 * "", "-", "." — so the box can show exactly what was typed without the
 * caller committing a 0 (committing 0 for an emptied box is what used to put
 * a stray leading zero in front of the next digit typed).
 */
export function parseTemperatureText(raw) {
  let text = "";
  let seenPoint = false;
  for (const ch of String(raw).replace(/,/g, ".")) {
    if (ch >= "0" && ch <= "9") text += ch;
    else if (ch === "-" && text === "") text = "-";
    else if (ch === "." && !seenPoint) { seenPoint = true; text += "."; }
  }
  const value = /\d/.test(text) ? Number(text) : null;
  return { text, value: Number.isFinite(value) ? value : null };
}

const DAY_MS = 24 * 3_600_000;
const pad2 = (n) => String(n).padStart(2, "0");

// H:MM:SS once at least an hour has elapsed, otherwise M:SS — seconds
// precision, unlike RTW's round-to-the-nearest-minute bike times, because a
// recipe step's time alarms can be short. From a day up, a day count goes in
// front and the seconds go: steps can run for days or months, and a ticking
// seconds digit on those is clutter ("3d 4:05" = 3 days 4 h 5 min).
export function formatDuration(totalMs) {
  if (totalMs == null || Number.isNaN(totalMs) || totalMs < 0) return "";
  const totalSeconds = Math.floor(totalMs / 1000);
  const d = Math.floor(totalSeconds / 86_400);
  const h = Math.floor((totalSeconds % 86_400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}:${pad2(m)}`;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${m}:${pad2(s)}`;
}

export function formatElapsed(totalMs) {
  return formatDuration(totalMs);
}

// The standard time-entry control's own conversion pair — every duration
// entered anywhere in the app (a step's duration, a time alarm's trigger
// point, a repeat interval, an Extend) goes through these two, so hours,
// minutes and seconds always mean the same thing everywhere, unlike the
// mixture of ad hoc minutes-only and seconds-only fields this replaced.
export function msToHMS(ms) {
  const totalSeconds = Math.max(0, Math.round((ms ?? 0) / 1000));
  return {
    h: Math.floor(totalSeconds / 3600),
    m: Math.floor((totalSeconds % 3600) / 60),
    s: totalSeconds % 60,
  };
}

export function hmsToMs({ h, m, s }) {
  return ((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000;
}

// The same pair with days split out of the hours (h is then 0–23) — what the
// time-entry control shows once it has a days box.
export function msToDHMS(ms) {
  const { h, m, s } = msToHMS(ms);
  return { d: Math.floor(h / 24), h: h % 24, m, s };
}

export function dhmsToMs({ d, h, m, s }) {
  return (Number(d) || 0) * DAY_MS + hmsToMs({ h, m, s });
}

/**
 * One box of the time-entry control changed: the new duration, and whether
 * the days box must now be shown. Hours of 24 or more roll over into days
 * (36 h → 1 d 12 h), which is also how the days box appears for someone who
 * just keeps typing hours. Kept here, pure, so the rule is tested without a
 * browser.
 */
export function timeBoxChange(valueMs, field, value) {
  const parts = { ...msToDHMS(valueMs), [field]: value };
  const ms = dhmsToMs(parts);
  return { ms, rolledIntoDays: field === "h" && value >= 24 };
}

// Always-zero-padded H:MM:SS (e.g. "00:05:00"), unlike formatDuration's
// terser "5:00" — for the alarm overlay's "(time 00:05:00)" style detail,
// where a fixed width reads better in a list of mixed short/long alarms.
// From a day up it follows formatDuration's rule: days in front, no seconds
// ("3d 04:05").
export function formatHMS(ms) {
  if ((ms ?? 0) >= DAY_MS) {
    const { d, h, m } = msToDHMS(Math.floor(ms / 60_000) * 60_000);
    return `${d}d ${pad2(h)}:${pad2(m)}`;
  }
  const { h, m, s } = msToHMS(ms);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

// Overdue (past the alarm/duration point) renders as "+H:MM:SS" rather than
// an empty string — a step keeps running past its duration until Complete is
// tapped, so "how far past" is meaningful, not an error state.
export function formatRemaining(remainingMs) {
  if (remainingMs == null || Number.isNaN(remainingMs)) return "";
  if (remainingMs < 0) return `+${formatDuration(-remainingMs)}`;
  return formatDuration(remainingMs);
}
