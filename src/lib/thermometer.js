// The BLE seam: packet parsing (pure), press-count baselining (pure), and two
// implementations of one interface — WebBluetoothBackend (real) and
// FakeThermometer (for tests) — mirroring storage.js's Backend split.
//
// Interface both share: connect(handlers) / disconnect(), where handlers is
// { onMeasurement(sample), onDisconnect() }.
//
// The 5-second data-loss watchdog is deliberately NOT an internal timer here.
// A periodic tick loop already has to exist elsewhere (time alarms need
// re-checking against the wall clock even with no new BLE packet), so the
// watchdog is just "is now - lastPacketAt >= 5000", computed by whoever
// already runs that tick, against the plain `lastPacketAt` timestamp this
// module exposes — one timer, not two racing ones.

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

// ---- FakeThermometer — for tests, and for the eventual UI dev/demo path ----

export function createFakeThermometer() {
  let handlers = null;
  let connected = false;
  let lastPacketAt = null;

  return {
    async connect(h) {
      handlers = h;
      connected = true;
    },
    disconnect() {
      const wasConnected = connected;
      connected = false;
      handlers?.onDisconnect?.();
      if (wasConnected) handlers = null;
    },
    isConnected: () => connected,
    getLastPacketAt: () => lastPacketAt,
    // Test-only control surface — not part of the shared interface.
    _emit(sample, now = Date.now()) {
      if (!connected) throw new Error("FakeThermometer: not connected");
      lastPacketAt = now;
      handlers.onMeasurement(sample);
    },
    _emitRaw(buffer, now) {
      this._emit(parseMeasurementPacket(buffer), now);
    },
  };
}

// ---- WebBluetoothBackend — the real adapter ----
//
// Three-tier connect (already-connected / previously-paired retry / picker)
// and bounded reconnect-with-backoff, following ble-hr-tool's app.js pattern
// (build-plan §3), adapted to this service/characteristic pair. Cannot be
// exercised in Node — no navigator.bluetooth — so this is unit-tested only up
// to the packet-parsing and baselining functions above; the connect/reconnect
// flow itself needs the real Feather and a phone (deferred, see build plan).

const RECONNECT_ATTEMPTS = 3;
const RECONNECT_INTERVAL_MS = 3000;
const PAIRED_RETRY_ATTEMPTS = 3;
const PAIRED_RETRY_INTERVAL_MS = 3000;

export function createWebBluetoothBackend({ bluetooth } = {}) {
  const ble = bluetooth || (typeof navigator !== "undefined" ? navigator.bluetooth : undefined);
  let device = null;
  let handlers = null;
  let lastPacketAt = null;
  let reconnecting = false;

  function onNotification(event) {
    const sample = parseMeasurementPacket(event.target.value.buffer);
    lastPacketAt = Date.now();
    handlers?.onMeasurement?.(sample);
  }

  async function subscribe(server) {
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(MEASUREMENT_CHAR_UUID);
    await characteristic.startNotifications();
    characteristic.removeEventListener("characteristicvaluechanged", onNotification);
    characteristic.addEventListener("characteristicvaluechanged", onNotification);
  }

  function onGattDisconnected() {
    handlers?.onDisconnect?.();
    if (!reconnecting) attemptReconnect();
  }

  async function attemptReconnect() {
    reconnecting = true;
    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      try {
        const server = await device.gatt.connect();
        await subscribe(server);
        reconnecting = false;
        return;
      } catch {
        if (attempt < RECONNECT_ATTEMPTS) await new Promise((r) => setTimeout(r, RECONNECT_INTERVAL_MS));
      }
    }
    reconnecting = false;
    // A long press is a legitimate power-off — give up and start clean.
    device = null;
  }

  async function connect(h) {
    handlers = h;

    // 1. Already connected — nothing to do.
    if (device && device.gatt.connected) return;

    // 2. Previously paired: use this call's gesture to drive gatt.connect()
    // directly, retrying since the Feather may take a few seconds to start
    // advertising again after a disconnect.
    if (ble?.getDevices) {
      try {
        const devices = await ble.getDevices();
        if (devices.length > 0) {
          const candidate = devices[0];
          for (let attempt = 1; attempt <= PAIRED_RETRY_ATTEMPTS; attempt++) {
            try {
              const server = await candidate.gatt.connect();
              await subscribe(server);
              device = candidate;
              device.addEventListener("gattserverdisconnected", onGattDisconnected);
              return;
            } catch {
              if (attempt < PAIRED_RETRY_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, PAIRED_RETRY_INTERVAL_MS));
              }
            }
          }
        }
      } catch {
        // Fall through to the picker.
      }
    }

    // 3. Picker — clear a stale non-connected reference first, since some
    // browsers block the picker while an abandoned reference is held.
    if (device && !device.gatt.connected) device = null;
    device = await ble.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [SERVICE_UUID],
    });
    device.addEventListener("gattserverdisconnected", onGattDisconnected);
    const server = await device.gatt.connect();
    await subscribe(server);
  }

  function disconnect() {
    reconnecting = false;
    if (device?.gatt?.connected) device.gatt.disconnect();
    device = null;
  }

  return { connect, disconnect, isConnected: () => !!device?.gatt?.connected, getLastPacketAt: () => lastPacketAt };
}
