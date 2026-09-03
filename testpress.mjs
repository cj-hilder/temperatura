import {
  parseMeasurementPacket, resetPressBaseline, applyPressBaseline, createFakeThermometer,
} from './src/lib/thermometer.js';
import { silenceEarliest } from './src/lib/alarms.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

function buildPacket({ seq = 0, tempCenti = 0, battery = 100, pressCount = 0, probePresent = true, buttonHeld = false }) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint16(0, seq, true);
  view.setInt16(2, tempCenti, true);
  view.setUint8(4, battery);
  view.setUint8(5, pressCount);
  view.setUint8(6, (probePresent ? 0x01 : 0) | (buttonHeld ? 0x02 : 0));
  view.setUint8(7, 0);
  return buf;
}

console.log('\nparseMeasurementPacket — byte layout and temperature sentinel:');
{
  const p = parseMeasurementPacket(buildPacket({ seq: 42, tempCenti: 2150, battery: 87, pressCount: 3, probePresent: true, buttonHeld: false }));
  ok('seq decoded', p.seq === 42);
  ok('temperature decoded (0.01C units)', p.tempC === 21.5);
  ok('battery decoded', p.battery === 87);
  ok('press count decoded', p.pressCount === 3);
  ok('probe-present flag decoded', p.probePresent === true);
  ok('button-held flag decoded', p.buttonHeld === false);

  const negative = parseMeasurementPacket(buildPacket({ tempCenti: -320 }));
  ok('negative temperature decoded correctly', negative.tempC === -3.2);

  const invalid = parseMeasurementPacket(buildPacket({ tempCenti: -32768 }));
  ok('the 0x8000 sentinel decodes to null (no reading)', invalid.tempC === null);

  const noProbe = parseMeasurementPacket(buildPacket({ probePresent: false, buttonHeld: true }));
  ok('probe-absent + button-held flags both decode independently', noProbe.probePresent === false && noProbe.buttonHeld === true);
}

console.log('\nPress-count baselining:');
{
  let state = resetPressBaseline();
  let r = applyPressBaseline(state, 10); // first packet after connect
  state = r.state;
  ok('the first packet after connect seeds the baseline and acts on nothing', r.presses === 0 && state.baseline === 10);

  r = applyPressBaseline(state, 12); // two presses within an unbroken stream
  state = r.state;
  ok('diffs only between consecutive packets in a stream', r.presses === 2);

  r = applyPressBaseline(state, 12); // no change
  ok('no presses reported when the count is unchanged', r.presses === 0);
  state = r.state;

  // A reconnect must re-seed rather than diff across the gap.
  state = resetPressBaseline();
  r = applyPressBaseline(state, 250); // first packet after the gap — could be +238 since the old baseline, must not be applied
  state = r.state;
  ok('seeding again after a gap acts on nothing, regardless of the raw value', r.presses === 0 && state.baseline === 250);

  r = applyPressBaseline(state, 2); // wrap: 250 -> 2 is a negative diff
  ok('a wrap (negative diff) is treated as exactly one press', r.presses === 1);
  state = r.state;

  // A cold restart resets the firmware's counter, which also looks like a
  // negative diff from the app's point of view — same handling.
  r = applyPressBaseline(state, 0);
  ok('a cold-restart reset (also a negative diff) is treated as exactly one press', r.presses === 1);
}

console.log('\nFakeThermometer:');
{
  const therm = createFakeThermometer();
  let measurements = [];
  let disconnects = 0;
  await therm.connect({ onMeasurement: (s) => measurements.push(s), onDisconnect: () => disconnects++ });
  ok('reports connected after connect()', therm.isConnected() === true);

  therm._emit({ seq: 1, tempC: 20, battery: 90, pressCount: 0, probePresent: true, buttonHeld: false }, 1000);
  ok('delivers an emitted measurement to the handler', measurements.length === 1 && measurements[0].tempC === 20);
  ok('tracks lastPacketAt from the emitted sample', therm.getLastPacketAt() === 1000);

  therm.disconnect();
  ok('reports disconnected after disconnect()', therm.isConnected() === false);
  ok('fires onDisconnect exactly once', disconnects === 1);

  let threw = false;
  try { therm._emit({ tempC: 1 }); } catch { threw = true; }
  ok('emitting while disconnected throws (a test-harness guard, not app behaviour)', threw);
}

console.log('\nPresses swallowed when nothing is sounding:');
{
  // Baseline diffing hands off a press count to the silence queue; if nothing
  // is sounding, silenceEarliest is a no-op regardless of how many presses
  // arrive — this is what "swallowed" means in practice.
  let alarmState = {};
  let state = resetPressBaseline();
  let r = applyPressBaseline(state, 5);
  state = r.state;
  r = applyPressBaseline(state, 7); // 2 presses, nothing sounding
  let silencedCount = 0;
  for (let i = 0; i < r.presses; i++) {
    const result = silenceEarliest(alarmState);
    alarmState = result.alarmState;
    if (result.silencedId) silencedCount++;
  }
  ok('presses are swallowed (no-op) when no alarm is sounding', silencedCount === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
