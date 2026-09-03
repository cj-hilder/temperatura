// Display formatting. Pure — no DOM, no clock. Deliberately much smaller than
// Ride the Wind's format.js: there is no unit-settings toggle in this spec
// (one fixed palette, °C only), so RTW's settings-injection machinery
// (setFormatSettings/DEFAULT_UNITS) is left out rather than ported unused.

export function formatTemperature(celsius) {
  if (celsius == null || Number.isNaN(celsius)) return "";
  // One decimal place, not RTW's whole-degree choice — the alarm deadband is
  // 2°C and band edges are worth showing more precisely than a weather app's
  // rounding needs.
  return `${celsius.toFixed(1)}°C`;
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

// Overdue (past the alarm/duration point) renders as "+H:MM:SS" rather than
// an empty string — a step keeps running past its duration until Complete is
// tapped, so "how far past" is meaningful, not an error state.
export function formatRemaining(remainingMs) {
  if (remainingMs == null || Number.isNaN(remainingMs)) return "";
  if (remainingMs < 0) return `+${formatDuration(-remainingMs)}`;
  return formatDuration(remainingMs);
}
