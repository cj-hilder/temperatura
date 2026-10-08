// FTHERM — our own FeatherThermometer (docs/FeatherThermometer.ino). Pure:
// packet parsing and press-count baselining, plus the driver descriptor the
// probe manager connects with.

// From docs/FeatherThermometer.ino's header comment block.
export const SERVICE_UUID = "b7e1c0a0-4f3d-4a21-9f3e-6c1a2d5b7e01";
export const MEASUREMENT_CHAR_UUID = "b7e1c0a0-4f3d-4a21-9f3e-6c1a2d5b7e02";
export const DEVICE_NAME_PREFIX = "FTHERM";

const TEMP_INVALID_RAW = -32768; // 0x8000

/**
 * Parses the 8-byte MEASUREMENT packet.
 * [0..1] seq uint16 | [2..3] temp int16 (0.01C, -32768=invalid) | [4] battery
 * uint8 | [5] press count uint8 (wraps) | [6] flags (bit0 probe, bit1 button)
 * | [7] reserved. All little-endian.
 */
export function parseMeasurementPacket(buffer) {
  const view = new DataView(buffer);
  const seq = view.getUint16(0, true);
  const rawTemp = view.getInt16(2, true);
  const battery = view.getUint8(4);
  const pressCount = view.getUint8(5);
  const flags = view.getUint8(6);
  return {
    seq,
    tempC: rawTemp === TEMP_INVALID_RAW ? null : rawTemp / 100,
    battery,
    pressCount,
    probePresent: (flags & 0x01) !== 0,
    buttonHeld: (flags & 0x02) !== 0,
  };
}

// Fresh baseline state — call on every connect and every reconnect (a gap in
// the stream makes the raw press-count difference meaningless, per spec).
export function resetPressBaseline() {
  return { baseline: null };
}

/**
 * Diffs a packet's press count against the running baseline.
 * - First packet since reset: seed the baseline, act on nothing.
 * - A positive diff within an unbroken stream: that many presses.
 * - A negative diff (uint8 wrap, or a cold restart resetting the counter):
 *   treat as exactly one press, per spec — not the wrapped arithmetic value,
 *   because there is no way to know how many presses actually happened while
 *   disconnected, and attributing more than one would silence alarms for
 *   reasons the user never saw.
 * @returns {{state: {baseline: number}, presses: number}}
 */
export function applyPressBaseline(state, pressCount) {
  if (state.baseline === null) {
    return { state: { baseline: pressCount }, presses: 0 };
  }
  const diff = pressCount - state.baseline;
  const presses = diff > 0 ? diff : diff < 0 ? 1 : 0;
  return { state: { baseline: pressCount }, presses };
}

export const fthermDriver = {
  kind: "ftherm",
  label: "FTHERM",
  filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
  serviceUuid: SERVICE_UUID,
  charUuid: MEASUREMENT_CHAR_UUID,
  hasButton: true,
  // A steady ~1.3 Hz stream: silence means the data stopped.
  freshness: { type: "heartbeat", timeoutMs: 5000 },
  // A DataView over a Bluetooth value can have a non-zero byteOffset, so
  // copy out exactly its bytes rather than trusting `.buffer`.
  parse: (dataView) =>
    parseMeasurementPacket(dataView.buffer.slice(dataView.byteOffset, dataView.byteOffset + dataView.byteLength)),
};
