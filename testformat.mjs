import { formatTemperature, formatDuration, formatElapsed, formatRemaining, msToHMS, hmsToMs } from './src/lib/format.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nformatTemperature:');
{
  ok('one decimal place', formatTemperature(21.5) === '21.5°C');
  ok('rounds to one decimal', formatTemperature(21.549) === '21.5°C');
  ok('negative temperature', formatTemperature(-3.2) === '-3.2°C');
  ok('zero', formatTemperature(0) === '0.0°C');
  ok('null renders empty', formatTemperature(null) === '');
  ok('NaN renders empty', formatTemperature(NaN) === '');
}

console.log('\nformatDuration:');
{
  ok('zero', formatDuration(0) === '0:00');
  ok('under a minute', formatDuration(45_000) === '0:45');
  ok('seconds are zero-padded', formatDuration(65_000) === '1:05');
  ok('several minutes', formatDuration(5 * 60_000 + 30_000) === '5:30');
  ok('just under an hour', formatDuration(59 * 60_000 + 59_000) === '59:59');
  ok('exactly an hour switches to H:MM:SS', formatDuration(60 * 60_000) === '1:00:00');
  ok('hours + minutes + seconds', formatDuration(2 * 3_600_000 + 5 * 60_000 + 3_000) === '2:05:03');
  ok('minutes are zero-padded once hours are shown', formatDuration(3_600_000 + 30_000) === '1:00:30');
  ok('negative renders empty', formatDuration(-1000) === '');
  ok('null renders empty', formatDuration(null) === '');
  ok('formatElapsed is the same as formatDuration', formatElapsed(65_000) === formatDuration(65_000));
}

console.log('\nformatRemaining:');
{
  ok('positive remaining is a plain duration', formatRemaining(65_000) === '1:05');
  ok('zero remaining', formatRemaining(0) === '0:00');
  ok('overdue renders with a + prefix', formatRemaining(-65_000) === '+1:05');
  ok('null renders empty', formatRemaining(null) === '');
}

console.log('\nmsToHMS:');
{
  ok('zero', JSON.stringify(msToHMS(0)) === JSON.stringify({ h: 0, m: 0, s: 0 }));
  ok('seconds only', JSON.stringify(msToHMS(45_000)) === JSON.stringify({ h: 0, m: 0, s: 45 }));
  ok('minutes and seconds', JSON.stringify(msToHMS(5 * 60_000 + 30_000)) === JSON.stringify({ h: 0, m: 5, s: 30 }));
  ok('hours, minutes, and seconds', JSON.stringify(msToHMS(2 * 3_600_000 + 5 * 60_000 + 3_000)) === JSON.stringify({ h: 2, m: 5, s: 3 }));
  ok('rounds to the nearest whole second', JSON.stringify(msToHMS(1_499)) === JSON.stringify({ h: 0, m: 0, s: 1 }));
  ok('negative clamps to zero', JSON.stringify(msToHMS(-5000)) === JSON.stringify({ h: 0, m: 0, s: 0 }));
  ok('null treated as zero', JSON.stringify(msToHMS(null)) === JSON.stringify({ h: 0, m: 0, s: 0 }));
}

console.log('\nhmsToMs:');
{
  ok('zero', hmsToMs({ h: 0, m: 0, s: 0 }) === 0);
  ok('seconds only', hmsToMs({ h: 0, m: 0, s: 45 }) === 45_000);
  ok('minutes and seconds', hmsToMs({ h: 0, m: 5, s: 30 }) === 5 * 60_000 + 30_000);
  ok('hours, minutes, and seconds', hmsToMs({ h: 2, m: 5, s: 3 }) === 2 * 3_600_000 + 5 * 60_000 + 3_000);
  ok('missing fields default to zero', hmsToMs({ m: 5 }) === 5 * 60_000);
  ok('round-trips through msToHMS', hmsToMs(msToHMS(7384_000)) === 7384_000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
