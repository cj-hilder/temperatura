import { parseBbqNotification, bbqDriver, SERVICE_UUID, NOTIFY_CHAR_UUID } from './src/lib/probes/bbq.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

const bytes = (text) => new TextEncoder().encode(text);
const withBattery = (pct, text) => Uint8Array.from([pct, ...bytes(text)]);

console.log('\nparseBbqNotification — real payloads from the nRF Connect logs (first byte = battery %):');
{
  const d = parseBbqNotification(bytes('d17.6'));
  ok('0x64 ("d") is 100% battery and 17.6 °C', d.battery === 100 && d.tempC === 17.6);
  const w = parseBbqNotification(bytes('W21.3'));
  ok('0x57 ("W") is 87% battery and 21.3 °C', w.battery === 87 && w.tempC === 21.3);
  const x = parseBbqNotification(bytes('X19.6'));
  ok('0x58 ("X") is 88% battery and 19.6 °C', x.battery === 88 && x.tempC === 19.6);
  ok('a valid reading means the probe is present, and there is no press count', w.probePresent === true && w.pressCount === null);
}

console.log('\nparseBbqNotification — the first byte is an integer, not a character:');
{
  ok('0% battery (a byte that is not printable text)', parseBbqNotification(withBattery(0, '21.5')).battery === 0);
  ok('1% battery', parseBbqNotification(withBattery(1, '21.5')).battery === 1);
  ok('50% battery (0x32 is the character "2" — must not be read as part of the temperature)', parseBbqNotification(withBattery(50, '21.5')).battery === 50
    && parseBbqNotification(withBattery(50, '21.5')).tempC === 21.5);
  ok('100% battery', parseBbqNotification(withBattery(100, '21.5')).battery === 100);
  ok('a digit-valued first byte (0x35 = 53%) is still battery, not temperature', parseBbqNotification(withBattery(53, '21.5')).battery === 53
    && parseBbqNotification(withBattery(53, '21.5')).tempC === 21.5);
  ok('a first byte over 100 is not a percentage: no battery reported, temperature still read',
    parseBbqNotification(withBattery(200, '21.5')).battery === null && parseBbqNotification(withBattery(200, '21.5')).tempC === 21.5);
}

console.log('\nparseBbqNotification — shapes beyond the logs, and garbage:');
{
  ok('negative temperature', parseBbqNotification(withBattery(90, '-3.5')).tempC === -3.5);
  ok('whole-number temperature', parseBbqNotification(withBattery(90, '21')).tempC === 21);
  ok('trailing whitespace tolerated', parseBbqNotification(withBattery(90, '21.5\n')).tempC === 21.5);
  const empty = parseBbqNotification(Uint8Array.from([90]));
  ok('a battery byte and no temperature is no data, probe not present, battery still known', empty.tempC === null && empty.probePresent === false && empty.battery === 90);
  const none = parseBbqNotification(new Uint8Array(0));
  ok('an empty payload is no data and no battery', none.tempC === null && none.battery === null);
  ok('non-numeric temperature is no data', parseBbqNotification(withBattery(90, 'abc')).tempC === null);
  ok('trailing junk is no data, not a half-parsed number', parseBbqNotification(withBattery(90, '21.5C')).tempC === null);
}

console.log('\nbbqDriver:');
{
  const raw = bytes('W21.3');
  const viaView = bbqDriver.parse(new DataView(raw.buffer));
  ok('parses a DataView: temperature and battery', viaView.tempC === 21.3 && viaView.battery === 87);
  // As the real value can arrive: a view at an offset within a larger buffer.
  const big = new Uint8Array(12);
  big.set(raw, 3);
  const viaOffset = bbqDriver.parse(new DataView(big.buffer, 3, raw.length));
  ok('parses a DataView with a byte offset', viaOffset.tempC === 21.3 && viaOffset.battery === 87);
  ok('UUIDs are the ones from the log', SERVICE_UUID === '18424398-7cbc-11e9-8f9e-2a86e4085a59' && NOTIFY_CHAR_UUID === '772ae377-b3d2-ff8e-1042-5481d1e03456');
  ok('picker filters on the advertised service, not the generic name', JSON.stringify(bbqDriver.filters) === JSON.stringify([{ services: [SERVICE_UUID] }]));
  ok('no button; freshness is link-based (notify-on-change)', bbqDriver.hasButton === false && bbqDriver.freshness.type === 'link');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
