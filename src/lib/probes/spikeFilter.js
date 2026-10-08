// Dip filter for the BBQ probe. Its readings periodically come in low by
// about 1.6 °C for exactly one notification (never two in a row), then
// recover — in the nRF logs 16.1 sat between 17.7s. Left alone, every dip
// would cross band edges and fire a temperature alarm for a temperature the
// food never had.
//
// Pure: time comes in as a parameter, no timers. `push` is fed each reading;
// `current` is polled (the tick loop does) so a held reading can time out
// without any event arriving.
//
// 1. A reading more than THRESHOLD below the previous one, right after a
//    non-suspect reading, is suspected a dip: keep showing the previous value.
// 2. The reading straight after a suspected dip is never itself suspected —
//    so a genuine sustained drop gets through on its second reading.
// 3. Every unsuspected reading is displayed as the average of it and the last
//    one used: light smoothing that costs little responsiveness.
// 4. The probe only notifies when its value CHANGES (40 s+ of silence with a
//    steady temperature was observed). A genuine drop is therefore followed by
//    nothing, not by a confirming reading — so a held reading that nothing has
//    contradicted within HOLD_TIMEOUT_MS is accepted as real, or the display
//    would stay stuck on the old value indefinitely. (A real dip's correction
//    arrived ~1.6 s later in the logs, comfortably inside that.)
//
// THRESHOLD sits above ordinary reading-to-reading change (0.1–0.3 °C seen)
// and below the dips (1.6–1.7 seen), tolerating a warming probe (which makes
// the visible drop smaller than the true one). Strict ">" so float noise
// right on the boundary never matters.
export const SPIKE_THRESHOLD_C = 0.9;
export const HOLD_TIMEOUT_MS = 5000;

export function createSpikeFilter({ threshold = SPIKE_THRESHOLD_C, holdTimeoutMs = HOLD_TIMEOUT_MS } = {}) {
  let previous = null; // the last raw reading, suspect or not
  let lastUsed = null;
  let holding = false;
  let heldAt = null;
  let shown = null;

  function accept() {
    holding = false;
    lastUsed = previous;
    shown = previous;
  }

  return {
    push(current, now) {
      if (previous === null) {
        lastUsed = current;
        shown = current;
      } else if (previous - current > threshold && !holding) {
        holding = true;
        heldAt = now;
        lastUsed = previous;
        shown = previous;
      } else {
        holding = false;
        shown = (lastUsed + current) / 2;
        lastUsed = current;
      }
      previous = current;
      return shown;
    },

    // What to display right now. Promotes a held reading nothing has
    // contradicted in time.
    current(now) {
      if (holding && now - heldAt > holdTimeoutMs) accept();
      return shown;
    },

    // A reconnect is a gap in the stream: nothing held across it can be trusted.
    reset() {
      previous = lastUsed = shown = heldAt = null;
      holding = false;
    },
  };
}
