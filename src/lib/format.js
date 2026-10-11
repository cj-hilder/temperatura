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

// H:MM:SS once at least an hour has elapsed, otherwise M:SS — seconds
// precision throughout, unlike RTW's round-to-the-nearest-minute bike times,
// because a recipe step's time alarms can be short.
export function formatDuration(totalMs) {
  if (totalMs == null || Number.isNaN(totalMs) || totalMs < 0) return "";
  const totalSeconds = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
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

// Always-zero-padded H:MM:SS (e.g. "00:05:00"), unlike formatDuration's
// terser "5:00" — for the alarm overlay's "(time 00:05:00)" style detail,
// where a fixed width reads better in a list of mixed short/long alarms.
export function formatHMS(ms) {
  const { h, m, s } = msToHMS(ms);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Overdue (past the alarm/duration point) renders as "+H:MM:SS" rather than
// an empty string — a step keeps running past its duration until Complete is
// tapped, so "how far past" is meaningful, not an error state.
export function formatRemaining(remainingMs) {
  if (remainingMs == null || Number.isNaN(remainingMs)) return "";
  if (remainingMs < 0) return `+${formatDuration(-remainingMs)}`;
  return formatDuration(remainingMs);
}
