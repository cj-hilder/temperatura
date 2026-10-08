import {
  parseMeasurementPacket, resetPressBaseline, applyPressBaseline, fthermDriver,
} from './src/lib/probes/ftherm.js';
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

console.log('\nfthermDriver.parse — the driver reads a DataView, even one with a byte offset:');
{
  const packet = buildPacket({ seq: 7, tempCenti: 1999, battery: 55, pressCount: 9, probePresent: true });
  // Embed the 8 bytes at an offset inside a bigger buffer, as a Bluetooth
  // value can arrive — `.buffer` alone would read the wrong bytes.
  const big = new Uint8Array(16);
  big.set(new Uint8Array(packet), 4);
  const s = fthermDriver.parse(new DataView(big.buffer, 4, 8));
  ok('temperature read from the right bytes', s.tempC === 19.99);
  ok('battery and press count read from the right bytes', s.battery === 55 && s.pressCount === 9);
  ok('FTHERM has a button and a heartbeat freshness rule', fthermDriver.hasButton === true && fthermDriver.freshness.type === 'heartbeat');
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
