// The probe manager: one independent GATT connection per probe. Follows the
// three-tier connect and bounded reconnect of ble-hr-tool (build-plan §3),
// but per probe — the old single-device code took `getDevices()[0]`, which is
// simply wrong once more than one device has been permitted.
//
// A probe's identity is its own `id` (what assignments, names and the UI hang
// off), NOT Web Bluetooth's `device.id`, which is kept separately as
// `deviceId`. On Android Chrome without the persistent-permissions backend
// there is no getDevices(), so every reconnect goes through the picker — and
// the picker hands back a NEW device.id each session for the same physical
// probe. Keying probes by device.id therefore turned every reconnect into a
// fresh "BBQ 2", "BBQ 3"…. Instead, Connect on a named probe binds whatever
// device the user picks to that probe, updating its deviceId.
//
// `getBluetooth`, `now` and `delay` are injected so Node tests can drive the
// whole thing with a fake GATT; `getBluetooth` is a function, not a captured
// object, so `navigator.bluetooth` is looked up at the moment of use rather
// than once at construction.
import { applyPressBaseline, resetPressBaseline } from "./ftherm.js";
import { DRIVERS, driverForKind, pickerOptions } from "./index.js";

const RECONNECT_ATTEMPTS = 3;
// How many recent readings each probe keeps for the alarm re-arm rule
// (alarms.js), which must see every reading although alarms are evaluated
// only once per tick. An FTHERM sends ~1.3 per second, so this is many
// ticks' worth of slack.
const RECENT_READINGS = 32;
const RECONNECT_INTERVAL_MS = 3000;
const PAIRED_RETRY_ATTEMPTS = 3;
const PAIRED_RETRY_INTERVAL_MS = 3000;

/**
 * Milliseconds since this probe's data was last "fresh" — the one number
 * alarms.js and isMeasured() take as msSinceLastPacket, so neither has to
 * know probes differ. null = never fresh.
 *
 * A steady-stream probe (FTHERM) is fresh while packets keep arriving. A
 * notify-on-change probe (BBQ) goes quiet whenever the value is steady —
 * 40 s+ was observed — so for it silence means "unchanged", and only the
 * link dropping means "lost": it reads 0 while connected, then counts up from
 * the moment of disconnect.
 */
export function msSinceFresh(probe, driver, nowMs) {
  if (driver.freshness.type === "link") {
    if (probe.state === "connected") return 0;
    return probe.disconnectedAt != null ? nowMs - probe.disconnectedAt : null;
  }
  return probe.lastPacketAt != null ? nowMs - probe.lastPacketAt : null;
}

export function createProbeManager({
  getBluetooth,
  now = () => Date.now(),
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  drivers = DRIVERS,
  known = [],
  handlers = {},
}) {
  const probes = new Map(); // probeId -> record
  const emit = () => handlers.onChange?.();
  const persistKnown = () => handlers.onKnownChanged?.(knownList());

  function defaultName(kind) {
    const label = driverForKind(kind, drivers).label;
    const taken = new Set([...probes.values()].map((p) => p.name));
    let n = 1;
    while (taken.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }

  // `deviceId` absent = a probe saved before the two were separated, when its
  // id WAS its device.id.
  function createRecord({ id, kind, name, deviceId }, { register = true } = {}) {
    const rec = {
      id, kind, name,
      deviceId: deviceId === undefined ? id : deviceId, // null = not bound to any device id
      device: null,
      state: "disconnected", // disconnected | connecting | connected | reconnecting (n/m) | gave up
      sample: null,
      // The last RECENT_READINGS readings, oldest first, each numbered by a
      // counter that only ever goes up, so an evaluator can tell which it has
      // already seen.
      readings: [],
      readingCount: 0,
      lastPacketAt: null,
      disconnectedAt: null,
      pressState: resetPressBaseline(),
      userDisconnect: false,
      reconnecting: false,
      // Per-probe, stateful, optional: some probes' readings need cleaning
      // before anything downstream sees them (see spikeFilter.js).
      filter: driverForKind(kind, drivers).createFilter?.() ?? null,
    };
    // Stable function identities, so add/removeEventListener dedupe properly.
    rec.onValue = (event) => handleValue(rec, event.target.value);
    rec.onGatt = () => onGattDisconnected(rec);
    if (register) probes.set(id, rec);
    return rec;
  }

  const knownList = () => [...probes.values()].map(({ id, kind, name, deviceId }) => ({ id, kind, name, deviceId }));
  const byDeviceId = (deviceId) => [...probes.values()].find((p) => p.deviceId === deviceId) ?? null;
  // Construction must not call handlers (a React caller creates this during
  // render, where setting state is not allowed), so seeding is silent.
  for (const k of known) createRecord(k);
  const setKnown = (list) => {
    for (const k of list) if (!probes.has(k.id)) createRecord(k);
    emit();
  };

  function handleValue(rec, dataView) {
    const driver = driverForKind(rec.kind, drivers);
    let sample;
    try {
      sample = driver.parse(dataView);
    } catch {
      return; // a truncated/garbled notification is no information, not a reading of "nothing"
    }
    if (rec.filter && sample.tempC != null) {
      sample = { ...sample, rawTempC: sample.tempC, tempC: rec.filter.push(sample.tempC, now()) };
    }
    rec.sample = sample;
    if (sample.tempC != null) {
      rec.readingCount++;
      rec.readings.push({ n: rec.readingCount, tempC: sample.tempC, at: now() });
      if (rec.readings.length > RECENT_READINGS) rec.readings.shift();
    }
    rec.lastPacketAt = now();
    if (driver.hasButton && sample.pressCount != null) {
      const { state, presses } = applyPressBaseline(rec.pressState, sample.pressCount);
      rec.pressState = state;
      if (presses > 0) handlers.onPresses?.(rec.id, presses);
    }
    emit();
  }

  async function subscribe(rec, server) {
    const driver = driverForKind(rec.kind, drivers);
    const service = await server.getPrimaryService(driver.serviceUuid);
    const characteristic = await service.getCharacteristic(driver.charUuid);
    await characteristic.startNotifications();
    characteristic.removeEventListener("characteristicvaluechanged", rec.onValue);
    characteristic.addEventListener("characteristicvaluechanged", rec.onValue);
  }

  function markConnected(rec, device) {
    rec.device = device;
    device.addEventListener("gattserverdisconnected", rec.onGatt);
    rec.state = "connected";
    rec.disconnectedAt = null;
    // Every (re)connect re-seeds the press baseline: a gap makes the raw
    // difference meaningless (see applyPressBaseline).
    rec.pressState = resetPressBaseline();
    rec.filter?.reset();
    rec.userDisconnect = false;
    rec.reconnecting = false;
    emit();
  }

  function onGattDisconnected(rec) {
    rec.disconnectedAt = now();
    rec.state = "disconnected";
    emit();
    if (!rec.userDisconnect && !rec.reconnecting) attemptReconnect(rec);
  }

  async function attemptReconnect(rec) {
    rec.reconnecting = true;
    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      if (rec.userDisconnect) { rec.reconnecting = false; return; }
      rec.state = `reconnecting (${attempt}/${RECONNECT_ATTEMPTS})`;
      emit();
      try {
        const server = await rec.device.gatt.connect();
        await subscribe(rec, server);
        markConnected(rec, rec.device);
        return;
      } catch {
        if (attempt < RECONNECT_ATTEMPTS) await delay(RECONNECT_INTERVAL_MS);
      }
    }
    // A long press on an FTHERM is a legitimate power-off — give up and start clean.
    rec.reconnecting = false;
    rec.device = null;
    rec.state = "gave up";
    emit();
  }

  // A device the user just picked: find out which kind of probe it is by
  // which of the known services it actually exposes, since the picker
  // doesn't say which of its filters matched.
  async function identifyKind(server) {
    for (const d of drivers) {
      try {
        await server.getPrimaryService(d.serviceUuid);
        return d.kind;
      } catch {
        // not this kind
      }
    }
    throw new Error("Not a supported probe.");
  }

  /**
   * Which record a freshly-picked device becomes. A device already known by
   * its deviceId is that probe — unless the user picked it from a specific
   * probe's Connect (`forRec`): then the pick IS that probe (the deviceId is
   * only a guess that goes stale across sessions; the user's choice is not),
   * except when the device is live right now as another probe — taking it
   * over would silently cut that probe off.
   */
  function recordForPick(device, kind, forRec) {
    const known = byDeviceId(device.id);
    if (forRec && forRec.kind === kind && (!known || known === forRec || known.state !== "connected")) return forRec;
    return known;
  }

  async function adoptPickedDevice(device, forRec = null) {
    const server = await device.gatt.connect();
    try {
      const kind = await identifyKind(server);
      const existing = recordForPick(device, kind, forRec);
      // A brand-new probe is only REGISTERED (and persisted) once it has
      // actually connected and subscribed. Registering it first left a
      // "ghost" record behind whenever a first attempt failed part-way — a
      // never-connected duplicate the user then saw next to the real one.
      const rec = existing ?? createRecord({ id: device.id, kind, name: defaultName(kind), deviceId: device.id }, { register: false });
      if (existing) {
        existing.state = "connecting";
        emit();
      }
      try {
        await subscribe(rec, server);
      } catch (err) {
        if (existing) { existing.state = "disconnected"; emit(); }
        throw err;
      }
      if (!existing) {
        probes.set(rec.id, rec);
        persistKnown();
      } else if (rec.deviceId !== device.id) {
        // Rebinding: whichever record held this device id before was a stale
        // duplicate of this probe from an earlier session. It keeps its name
        // (the user can Forget it) but no longer claims the device.
        const stale = byDeviceId(device.id);
        if (stale) stale.deviceId = null;
        rec.deviceId = device.id;
        persistKnown();
      }
      markConnected(rec, device);
      return rec.id;
    } catch (err) {
      device.gatt.disconnect?.(); // don't leave a half-open link holding the probe's one connection slot
      throw err;
    }
  }

  async function pick(kind, forRec = null) {
    const all = pickerOptions(drivers);
    const options = kind ? { filters: driverForKind(kind, drivers).filters, optionalServices: all.optionalServices } : all;
    const device = await getBluetooth().requestDevice(options);
    return adoptPickedDevice(device, forRec);
  }

  // Add a new probe via the picker (one device per call, each needing its own
  // user gesture).
  const addProbe = () => pick(null);

  /**
   * Tier 1: already connected → nothing to do. Tier 2: previously permitted →
   * drive gatt.connect() on the device with this probe's deviceId, no picker.
   * Tier 3: picker — the device picked becomes this probe (see
   * recordForPick). Returns the id actually connected, which is only ever a
   * different probe's when the device picked is already live as that probe.
   */
  async function connect(probeId) {
    const rec = probes.get(probeId);
    if (!rec) throw new Error(`Unknown probe "${probeId}".`);
    if (rec.state === "connected" && rec.device?.gatt?.connected) return probeId;

    rec.userDisconnect = false;
    rec.state = "connecting";
    emit();
    try {
      const ble = getBluetooth();
      if (ble?.getDevices) {
        try {
          const candidate = rec.deviceId ? (await ble.getDevices()).find((d) => d.id === rec.deviceId) : null;
          if (candidate) {
            for (let attempt = 1; attempt <= PAIRED_RETRY_ATTEMPTS; attempt++) {
              try {
                const server = await candidate.gatt.connect();
                await subscribe(rec, server);
                markConnected(rec, candidate);
                return probeId;
              } catch {
                if (attempt < PAIRED_RETRY_ATTEMPTS) await delay(PAIRED_RETRY_INTERVAL_MS);
              }
            }
          }
        } catch {
          // fall through to the picker
        }
      }
      return await pick(rec.kind, rec);
    } catch (err) {
      if (rec.state !== "connected") rec.state = "disconnected";
      emit();
      throw err;
    } finally {
      // The picked device may have been a different probe; this one is not
      // stuck "connecting" either way.
      if (rec.state === "connecting") { rec.state = "disconnected"; emit(); }
    }
  }

  function disconnect(probeId) {
    const rec = probes.get(probeId);
    if (!rec) return;
    rec.userDisconnect = true;
    if (rec.device?.gatt?.connected) rec.device.gatt.disconnect();
    rec.disconnectedAt = now();
    rec.state = "disconnected";
    emit();
  }

  function forget(probeId) {
    disconnect(probeId);
    probes.delete(probeId);
    persistKnown();
    emit();
  }

  function rename(probeId, name) {
    const rec = probes.get(probeId);
    const trimmed = String(name ?? "").trim();
    if (!rec || !trimmed) return;
    rec.name = trimmed;
    persistKnown();
    emit();
  }

  // The sample as of NOW: a reading the filter was holding may have timed out
  // with no new notification to trigger anything, so it is resolved here, on
  // read, rather than only when a packet arrives.
  function currentSample(rec) {
    if (rec.filter && rec.sample?.tempC != null) {
      const tempC = rec.filter.current(now());
      if (tempC !== rec.sample.tempC) rec.sample = { ...rec.sample, tempC };
    }
    return rec.sample;
  }

  const snapshot = () =>
    [...probes.values()].map((rec) => {
      const driver = driverForKind(rec.kind, drivers);
      return {
        id: rec.id, kind: rec.kind, label: driver.label, name: rec.name, state: rec.state,
        connected: rec.state === "connected",
        sample: currentSample(rec), readings: [...rec.readings], lastPacketAt: rec.lastPacketAt, disconnectedAt: rec.disconnectedAt,
        hasButton: driver.hasButton,
      };
    });

  const msSince = (probeId, nowMs = now()) => {
    const rec = probes.get(probeId);
    return rec ? msSinceFresh(rec, driverForKind(rec.kind, drivers), nowMs) : null;
  };

  return { setKnown, addProbe, connect, disconnect, forget, rename, snapshot, msSinceFresh: msSince };
}
