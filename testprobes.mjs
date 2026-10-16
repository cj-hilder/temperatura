import { createProbeManager, msSinceFresh } from './src/lib/probes/manager.js';
import { fthermDriver, SERVICE_UUID as FTHERM_SERVICE, MEASUREMENT_CHAR_UUID } from './src/lib/probes/ftherm.js';
import { bbqDriver, SERVICE_UUID as BBQ_SERVICE, NOTIFY_CHAR_UUID } from './src/lib/probes/bbq.js';
import { pickerOptions } from './src/lib/probes/index.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

// ---- a fake GATT: just enough surface for the manager, no browser needed ----
function fakeDevice({ id, kind, connectFailures = 0 }) {
  const service = kind === 'ftherm' ? FTHERM_SERVICE : BBQ_SERVICE;
  const charUuid = kind === 'ftherm' ? MEASUREMENT_CHAR_UUID : NOTIFY_CHAR_UUID;
  const characteristic = Object.assign(new EventTarget(), { async startNotifications() { return this; } });
  const dev = new EventTarget();
  let failuresLeft = connectFailures;
  dev.id = id;
  dev.connectCalls = 0;
  dev.gatt = {
    connected: false,
    async connect() {
      dev.connectCalls++;
      if (failuresLeft > 0) { failuresLeft--; throw new Error('connect failed'); }
      dev.gatt.connected = true;
      return dev.gatt;
    },
    disconnect() { dev.gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); },
    async getPrimaryService(uuid) {
      if (uuid !== service) throw new Error('NotFoundError');
      return { async getCharacteristic(c) { if (c !== charUuid) throw new Error('NotFoundError'); return characteristic; } };
    },
  };
  dev.drop = () => { dev.gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); };
  dev.emit = (bytes) => {
    const ev = new Event('characteristicvaluechanged');
    Object.defineProperty(ev, 'target', { value: { value: new DataView(new Uint8Array(bytes).buffer) } });
    characteristic.dispatchEvent(ev);
  };
  return dev;
}
function fthermPacket({ tempCenti = 2000, battery = 90, pressCount = 0, probePresent = true }) {
  const b = new ArrayBuffer(8), v = new DataView(b);
  v.setUint16(0, 1, true); v.setInt16(2, tempCenti, true); v.setUint8(4, battery); v.setUint8(5, pressCount); v.setUint8(6, probePresent ? 1 : 0);
  return [...new Uint8Array(b)];
}
const bbqBytes = (text) => [...new TextEncoder().encode(text)];

function harness({ permitted = [], picks = [], known = [] } = {}) {
  const log = { pickerOptions: [], presses: [], known: [], changes: 0, delays: 0 };
  let clock = 1000;
  const ble = {
    async getDevices() { return permitted; },
    async requestDevice(options) { log.pickerOptions.push(options); const d = picks.shift(); if (!d) throw new Error('User cancelled'); return d; },
  };
  const mgr = createProbeManager({
    getBluetooth: () => ble,
    now: () => clock,
    delay: async () => { log.delays++; },
    known,
    handlers: {
      onChange: () => log.changes++,
      onPresses: (id, n) => log.presses.push([id, n]),
      onKnownChanged: (list) => (log.known = list),
    },
  });
  return { mgr, log, tick: (ms) => { clock += ms; }, setClock: (v) => { clock = v; } };
}
const byId = (mgr, id) => mgr.snapshot().find((p) => p.id === id);

console.log('\nAdding probes through the picker — kind is identified from the service the device exposes:');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const { mgr, log } = harness({ picks: [ft, bbq] });
  const id1 = await mgr.addProbe();
  const id2 = await mgr.addProbe();
  ok('first pick is an FTHERM, named "FTHERM 1"', byId(mgr, id1).kind === 'ftherm' && byId(mgr, id1).name === 'FTHERM 1');
  ok('second pick is a BBQ, named "BBQ 1"', byId(mgr, id2).kind === 'bbq' && byId(mgr, id2).name === 'BBQ 1');
  ok('both are connected at once', byId(mgr, id1).connected && byId(mgr, id2).connected);
  ok('known probes were reported for persistence', log.known.length === 2 && log.known[0].id === 'dev-ft' && log.known[1].kind === 'bbq');
  const opts = log.pickerOptions[0];
  ok('picker offers both kinds (union of filters)', opts.filters.length === 2 && JSON.stringify(opts.filters) === JSON.stringify(pickerOptions().filters));
  ok('both services are in optionalServices', opts.optionalServices.includes(FTHERM_SERVICE) && opts.optionalServices.includes(BBQ_SERVICE));
}

console.log('\nA failed first attempt leaves no ghost probe behind:');
{
  const flaky = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const realGetService = flaky.gatt.getPrimaryService;
  let failing = true;
  // The link comes up and the service is found, but starting notifications fails.
  flaky.gatt.getPrimaryService = async (uuid) => {
    const svc = await realGetService(uuid);
    return {
      async getCharacteristic(c) {
        const ch = await svc.getCharacteristic(c);
        return {
          addEventListener: (...a) => ch.addEventListener(...a),
          removeEventListener: (...a) => ch.removeEventListener(...a),
          async startNotifications() { if (failing) throw new Error('GATT operation failed'); return ch.startNotifications(); },
        };
      },
    };
  };
  const { mgr, log } = harness({ picks: [flaky, flaky] });
  let threw = false;
  try { await mgr.addProbe(); } catch { threw = true; }
  ok('the failed attempt rejects', threw);
  ok('and registers nothing: no probe in the list, none persisted', mgr.snapshot().length === 0 && log.known.length === 0);
  ok('and does not leave the link open holding the probe\'s one connection slot', flaky.gatt.connected === false);

  failing = false;
  const id = await mgr.addProbe();
  ok('a later successful attempt creates exactly one probe, still named "BBQ 1"', mgr.snapshot().length === 1 && byId(mgr, id).name === 'BBQ 1' && byId(mgr, id).connected);
  ok('persisted once, after it actually connected', log.known.length === 1);
}

console.log('\nTwo FTHERMs get distinct default names:');
{
  const { mgr } = harness({ picks: [fakeDevice({ id: 'a', kind: 'ftherm' }), fakeDevice({ id: 'b', kind: 'ftherm' })] });
  await mgr.addProbe(); await mgr.addProbe();
  ok('"FTHERM 1" and "FTHERM 2"', mgr.snapshot().map((p) => p.name).join() === 'FTHERM 1,FTHERM 2');
}

console.log('\nTier 2 — a previously permitted probe reconnects by id, never "the first device":');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  // The FTHERM is first in the permitted list; asking for the BBQ must not touch it.
  const { mgr, log } = harness({
    permitted: [ft, bbq],
    known: [{ id: 'dev-ft', kind: 'ftherm', name: 'FTHERM 1' }, { id: 'dev-bbq', kind: 'bbq', name: 'BBQ 1' }],
  });
  ok('known probes start disconnected', mgr.snapshot().every((p) => p.state === 'disconnected'));
  await mgr.connect('dev-bbq');
  ok('the BBQ connected', byId(mgr, 'dev-bbq').connected);
  ok('the FTHERM (first in the list) was left alone', ft.connectCalls === 0 && byId(mgr, 'dev-ft').state === 'disconnected');
  ok('no picker was shown', log.pickerOptions.length === 0);
  const again = await mgr.connect('dev-bbq');
  ok('tier 1: connecting an already-connected probe does not reconnect it', again === 'dev-bbq' && bbq.connectCalls === 1);
}

console.log('\nTier 3 — falls back to the picker, restricted to that probe\'s kind:');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const { mgr, log } = harness({ permitted: [], picks: [ft], known: [{ id: 'dev-ft', kind: 'ftherm', name: 'FTHERM 1' }] });
  await mgr.connect('dev-ft');
  ok('picker shown once with only that kind\'s filter', log.pickerOptions.length === 1 && JSON.stringify(log.pickerOptions[0].filters) === JSON.stringify(fthermDriver.filters));
  ok('connected', byId(mgr, 'dev-ft').connected);

  // A cancelled picker leaves the probe disconnected and rethrows.
  const { mgr: m2 } = harness({ permitted: [], picks: [], known: [{ id: 'x', kind: 'bbq', name: 'BBQ 1' }] });
  let threw = false;
  try { await m2.connect('x'); } catch { threw = true; }
  ok('a cancelled picker rethrows and leaves the probe disconnected (not stuck "connecting")', threw && byId(m2, 'x').state === 'disconnected');
}

console.log('\nReconnecting through the picker when Chrome has issued a NEW device id (Android, no getDevices):');
{
  // Last session this BBQ was "dev-bbq-old"; this session the picker hands
  // back the same physical probe as "dev-bbq-new".
  const bbq = fakeDevice({ id: 'dev-bbq-new', kind: 'bbq' });
  const { mgr, log } = harness({ permitted: [], picks: [bbq], known: [{ id: 'dev-bbq-old', kind: 'bbq', name: 'Wireless' }] });
  const got = await mgr.connect('dev-bbq-old');
  ok('Connect on "Wireless" connects Wireless itself', got === 'dev-bbq-old' && byId(mgr, 'dev-bbq-old').connected && byId(mgr, 'dev-bbq-old').name === 'Wireless');
  ok('no new "BBQ 1" was created', mgr.snapshot().length === 1);
  ok('the new device id is remembered for next time, under the same probe', log.known.length === 1 && log.known[0].id === 'dev-bbq-old' && log.known[0].deviceId === 'dev-bbq-new');
  bbq.emit(bbqBytes('W21.3'));
  ok('its readings arrive under the same probe', byId(mgr, 'dev-bbq-old').sample.tempC === 21.3);
}

console.log('\n...and a later session with getDevices finds it by its remembered device id:');
{
  const bbq = fakeDevice({ id: 'dev-bbq-new', kind: 'bbq' });
  const { mgr, log } = harness({ permitted: [bbq], known: [{ id: 'dev-bbq-old', kind: 'bbq', name: 'Wireless', deviceId: 'dev-bbq-new' }] });
  await mgr.connect('dev-bbq-old');
  ok('tier 2 matches on deviceId, no picker', byId(mgr, 'dev-bbq-old').connected && log.pickerOptions.length === 0);
}

console.log('\nA stale duplicate from an earlier session gives up the device id it was holding:');
{
  // "BBQ 2" was created by the old behaviour this session for the same probe.
  const bbq = fakeDevice({ id: 'dev-now', kind: 'bbq' });
  const { mgr, log } = harness({
    permitted: [], picks: [bbq],
    known: [{ id: 'orig', kind: 'bbq', name: 'Wireless' }, { id: 'dev-now', kind: 'bbq', name: 'BBQ 2' }],
  });
  await mgr.connect('orig');
  ok('Connect on "Wireless" wins over the duplicate that held the id', byId(mgr, 'orig').connected && !byId(mgr, 'dev-now').connected);
  const dup = log.known.find((k) => k.id === 'dev-now');
  ok('the duplicate keeps its name (to be forgotten) but no longer claims the device', dup.name === 'BBQ 2' && dup.deviceId === null);
  ok('Wireless now holds that device id', log.known.find((k) => k.id === 'orig').deviceId === 'dev-now');
}

console.log('\nPicking a device that is live right now as another probe does not take it over:');
{
  const live = fakeDevice({ id: 'dev-a', kind: 'bbq' });
  const { mgr } = harness({ permitted: [], picks: [live, live], known: [{ id: 'dev-a', kind: 'bbq', name: 'Left' }, { id: 'other', kind: 'bbq', name: 'Right' }] });
  await mgr.connect('dev-a'); // Left connects (tier 3, same id)
  const got = await mgr.connect('other'); // the user picks the same, already-connected device for Right
  ok('the connect resolves to the probe already using it', got === 'dev-a');
  ok('Right is not stuck "connecting" and Left is untouched', byId(mgr, 'other').state === 'disconnected' && byId(mgr, 'dev-a').connected);
}

console.log('\nAdd probe still adds a NEW probe for an unknown device:');
{
  const { mgr } = harness({ picks: [fakeDevice({ id: 'dev-x', kind: 'bbq' })], known: [{ id: 'orig', kind: 'bbq', name: 'Wireless' }] });
  const id = await mgr.addProbe();
  ok('a second probe, "BBQ 1"', id === 'dev-x' && mgr.snapshot().length === 2 && byId(mgr, id).name === 'BBQ 1');
}

console.log('\nSamples, battery and presses per probe:');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const { mgr, log } = harness({ picks: [ft, bbq] });
  await mgr.addProbe(); await mgr.addProbe();

  ft.emit(fthermPacket({ tempCenti: 2150, battery: 87, pressCount: 5 }));
  bbq.emit(bbqBytes('W21.3'));
  ok('FTHERM sample carries temperature and battery', byId(mgr, 'dev-ft').sample.tempC === 21.5 && byId(mgr, 'dev-ft').sample.battery === 87);
  ok('BBQ sample carries temperature and battery (first byte "W" = 87%)', byId(mgr, 'dev-bbq').sample.tempC === 21.3 && byId(mgr, 'dev-bbq').sample.battery === 87);
  ok('the first FTHERM packet only seeds the press baseline', log.presses.length === 0);
  ft.emit(fthermPacket({ pressCount: 7 }));
  ok('two presses reported with the probe they came from', log.presses.length === 1 && log.presses[0][0] === 'dev-ft' && log.presses[0][1] === 2);
  bbq.emit(bbqBytes('W21.4'));
  ok('a BBQ never reports presses', log.presses.length === 1);
  bbq.emit([0xff, 0xfe]);
  ok('a garbled notification becomes "no data", not a crash', byId(mgr, 'dev-bbq').sample.tempC === null);
  ft.emit([1, 2, 3]);
  ok('a truncated FTHERM packet is ignored, keeping the last sample', byId(mgr, 'dev-ft').sample.tempC === 20);
  // The alarm re-arm rule walks every reading, so each probe keeps its recent
  // ones, numbered; only real temperature readings count.
  const ftReadings = byId(mgr, 'dev-ft').readings;
  ok('recent readings are kept per probe, oldest first, numbered', ftReadings.length === 2
    && ftReadings[0].n === 1 && ftReadings[0].tempC === 21.5 && ftReadings[1].n === 2 && ftReadings[1].tempC === 20);
  // (21.35: the BBQ's filter averages 21.4 with the 21.3 before it — readings
  // are the filtered values, the same ones everything else sees.)
  ok('...and a "no data" notification is not a reading', byId(mgr, 'dev-bbq').readings.map((r) => r.tempC).join() === '21.3,21.35');
  for (let i = 0; i < 40; i++) ft.emit(fthermPacket({ tempCenti: 2000 + i }));
  const kept = byId(mgr, 'dev-ft').readings;
  ok('only the most recent 32 are kept, numbering carrying on', kept.length === 32 && kept[31].n === 42 && kept[0].n === 11);
}

console.log('\nData freshness — heartbeat vs link:');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const { mgr, tick, setClock } = harness({ picks: [ft, bbq] });
  setClock(10_000);
  await mgr.addProbe(); await mgr.addProbe();
  ft.emit(fthermPacket({ tempCenti: 2000 }));
  bbq.emit(bbqBytes('W21.3'));
  tick(60_000); // a full minute of silence from both
  ok('FTHERM: a minute of silence is a minute stale', mgr.msSinceFresh('dev-ft') === 60_000);
  ok('BBQ: a minute of silence while connected is still fresh (it only notifies on change)', mgr.msSinceFresh('dev-bbq') === 0);
  bbq.drop();
  tick(7_000);
  ok('BBQ: once the link drops it goes stale, counted from the disconnect', byId(mgr, 'dev-bbq').connected === false && mgr.msSinceFresh('dev-bbq') === 7_000);
  ok('a never-connected probe has never been fresh', msSinceFresh({ state: 'disconnected', disconnectedAt: null, lastPacketAt: null }, bbqDriver, 5) === null
    && msSinceFresh({ state: 'disconnected', disconnectedAt: null, lastPacketAt: null }, fthermDriver, 5) === null);
  ok('pure rule: link probe disconnected 7s ago', msSinceFresh({ state: 'disconnected', disconnectedAt: 3000 }, bbqDriver, 10_000) === 7000);
  ok('pure rule: heartbeat probe, last packet 2s ago, regardless of state', msSinceFresh({ state: 'connected', lastPacketAt: 8000 }, fthermDriver, 10_000) === 2000);
}

console.log('\nReconnect — per probe, bounded, and independent:');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const { mgr, log } = harness({ picks: [ft, bbq] });
  await mgr.addProbe(); await mgr.addProbe();
  ft.emit(fthermPacket({ pressCount: 4 }));

  ft.drop();
  await new Promise((r) => setTimeout(r, 0));
  ok('an unexpected drop reconnects the same probe automatically', byId(mgr, 'dev-ft').connected === true);
  ok('the other probe was never affected', byId(mgr, 'dev-bbq').connected === true && bbq.connectCalls === 1);
  ft.emit(fthermPacket({ pressCount: 9 }));
  ok('the press baseline was re-seeded on reconnect (4→9 is not applied across the gap)', log.presses.length === 0);
  ft.emit(fthermPacket({ pressCount: 10 }));
  ok('presses resume within the new unbroken stream', log.presses.length === 1 && log.presses[0][1] === 1);

  // Fails once, then succeeds on the second attempt.
  const flaky = fakeDevice({ id: 'flaky', kind: 'bbq', connectFailures: 0 });
  const h2 = harness({ picks: [flaky] });
  await h2.mgr.addProbe();
  let fails = 1;
  const realConnect = flaky.gatt.connect;
  flaky.gatt.connect = async () => { if (fails-- > 0) throw new Error('nope'); return realConnect(); };
  flaky.drop();
  await new Promise((r) => setTimeout(r, 0));
  ok('a failed first attempt is retried after a delay and then succeeds', byId(h2.mgr, 'flaky').connected === true && h2.log.delays === 1);

  // Never comes back: gives up after a bounded number of attempts.
  const dead = fakeDevice({ id: 'dead', kind: 'bbq' });
  const h3 = harness({ picks: [dead] });
  await h3.mgr.addProbe();
  dead.gatt.connect = async () => { throw new Error('gone'); };
  dead.drop();
  await new Promise((r) => setTimeout(r, 0));
  ok('gives up after 3 attempts', byId(h3.mgr, 'dead').state === 'gave up' && h3.log.delays === 2);
}

console.log('\nThe BBQ dip filter, wired through the manager (and only for the BBQ):');
{
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const { mgr, tick, setClock } = harness({ picks: [bbq, ft] });
  setClock(0);
  await mgr.addProbe(); await mgr.addProbe();
  const bbqTemp = () => byId(mgr, 'dev-bbq').sample.tempC;
  const sendBbq = (t) => bbq.emit([90, ...bbqBytes(String(t))]);

  sendBbq(20); tick(1000); sendBbq(20); tick(1000);
  sendBbq(18.4); // a dip
  ok('a dip never reaches the sample (held at 20)', bbqTemp() === 20);
  ok('the raw value is kept alongside for diagnostics', byId(mgr, 'dev-bbq').sample.rawTempC === 18.4);
  ok('battery from the first byte still comes through', byId(mgr, 'dev-bbq').sample.battery === 90);
  tick(1600); sendBbq(20);
  ok('recovery restores it', bbqTemp() === 20);

  // A genuine drop followed by silence (it only notifies on change).
  tick(1000); sendBbq(18.4);
  ok('a suspected dip is held at first', bbqTemp() === 20);
  tick(5001);
  ok('with no follow-up it is accepted once the timeout passes — resolved on read, no packet needed', bbqTemp() === 18.4);

  // An FTHERM with the same kind of drop is untouched.
  ft.emit(fthermPacket({ tempCenti: 2000 }));
  ft.emit(fthermPacket({ tempCenti: 1700 }));
  ok('an FTHERM reading is never filtered', byId(mgr, 'dev-ft').sample.tempC === 17 && byId(mgr, 'dev-ft').sample.rawTempC === undefined);

  // Reconnect resets the filter: no stale held value survives the gap.
  sendBbq(20); tick(1000); sendBbq(18.4); // holding again
  bbq.drop();
  await new Promise((r) => setTimeout(r, 0));
  sendBbq(15.0);
  ok('after a reconnect the first reading is taken as-is, nothing stale is held over', bbqTemp() === 15);
}

console.log('\nA BBQ that went away to charge: bounded retries give up, then Connect brings it back without the picker:');
{
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const { mgr, log } = harness({ permitted: [bbq], picks: [bbq] });
  await mgr.addProbe();
  const realConnect = bbq.gatt.connect;
  bbq.gatt.connect = async () => { throw new Error('charging — not advertising'); };
  bbq.drop();
  await new Promise((r) => setTimeout(r, 0));
  ok('while it charges the retries give up', byId(mgr, 'dev-bbq').state === 'gave up');
  bbq.gatt.connect = realConnect; // charging stopped, advertising again
  const pickersBefore = log.pickerOptions.length;
  await mgr.connect('dev-bbq');
  ok('Connect reconnects it by id', byId(mgr, 'dev-bbq').connected === true);
  ok('without showing the picker', log.pickerOptions.length === pickersBefore);
  bbq.emit([100, ...bbqBytes('21.5')]);
  ok('and it reports again, with battery from the first byte', byId(mgr, 'dev-bbq').sample.battery === 100 && byId(mgr, 'dev-bbq').sample.tempC === 21.5);
}

console.log('\nDisconnect and forget:');
{
  const ft = fakeDevice({ id: 'dev-ft', kind: 'ftherm' });
  const bbq = fakeDevice({ id: 'dev-bbq', kind: 'bbq' });
  const { mgr, log } = harness({ picks: [ft, bbq] });
  await mgr.addProbe(); await mgr.addProbe();

  mgr.disconnect('dev-ft');
  await new Promise((r) => setTimeout(r, 0));
  ok('a deliberate disconnect stays disconnected (no auto-reconnect)', byId(mgr, 'dev-ft').state === 'disconnected' && ft.gatt.connected === false);
  ok('other probes untouched', byId(mgr, 'dev-bbq').connected === true);

  mgr.rename('dev-bbq', '  Oven probe  ');
  ok('rename trims and persists', byId(mgr, 'dev-bbq').name === 'Oven probe' && log.known.find((k) => k.id === 'dev-bbq').name === 'Oven probe');
  mgr.rename('dev-bbq', '   ');
  ok('a blank rename is ignored', byId(mgr, 'dev-bbq').name === 'Oven probe');

  mgr.forget('dev-bbq');
  ok('forget removes it and disconnects it', mgr.snapshot().length === 1 && bbq.gatt.connected === false);
  ok('forget reports the shorter known list', log.known.length === 1 && log.known[0].id === 'dev-ft');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
