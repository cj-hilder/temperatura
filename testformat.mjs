import { formatTemperature, formatDuration, formatElapsed, formatRemaining, msToHMS, hmsToMs, formatHMS, parseTemperatureText, msToDHMS, dhmsToMs, timeBoxChange } from './src/lib/format.js';

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

console.log('\nformatHMS:');
{
  ok('zero is fully zero-padded', formatHMS(0) === '00:00:00');
  ok('minutes and seconds, hours still shown as 00', formatHMS(5 * 60_000) === '00:05:00');
  ok('hours are zero-padded too, unlike formatDuration', formatHMS(2 * 3_600_000 + 5 * 60_000 + 3_000) === '02:05:03');
  ok('seconds only', formatHMS(45_000) === '00:00:45');
}

console.log('\nparseTemperatureText — the temperature entry box:');
{
  const p = parseTemperatureText;
  ok('an emptied box is empty text and no value — never a committed 0', p('').text === '' && p('').value === null);
  ok('typing 5 into an emptied box is "5", not "05"', p('5').text === '5' && p('5').value === 5);
  ok('decimals', p('37.5').value === 37.5);
  ok('negative', p('-18').value === -18 && p('-18').text === '-18');
  ok('a lone minus is kept as typed but is not a value yet', p('-').text === '-' && p('-').value === null);
  ok('a lone point is not a value yet', p('.').value === null);
  ok('"5." is 5 while the decimal is still being typed', p('5.').text === '5.' && p('5.').value === 5);
  ok('a comma counts as the decimal point', p('37,5').text === '37.5' && p('37,5').value === 37.5);
  ok('a second point is dropped', p('3.7.5').text === '3.75');
  ok('a minus anywhere but the front is dropped', p('3-7').text === '37');
  ok('letters and spaces are dropped', p(' 4a2°').text === '42');
}

const HOUR = 3_600_000, DAY = 24 * HOUR, MIN = 60_000;

console.log('\nDays — display: unchanged under 24 h; from a day, days in front and no seconds:');
{
  ok('23:59:59 is still H:MM:SS', formatDuration(DAY - 1000) === '23:59:59');
  ok('exactly a day', formatDuration(DAY) === '1d 0:00');
  ok('3 days 4 h 5 min 37 s drops the seconds', formatDuration(3 * DAY + 4 * HOUR + 5 * MIN + 37_000) === '3d 4:05');
  ok('minutes stay zero-padded', formatDuration(2 * DAY + 3 * MIN) === '2d 0:03');
  ok('months are just a lot of days', formatDuration(95 * DAY + 12 * HOUR) === '95d 12:00');
  ok('overdue by days', formatRemaining(-(DAY + 30 * MIN)) === '+1d 0:30');
  ok('overlay fixed width under a day is unchanged', formatHMS(5 * MIN) === '00:05:00');
  ok('overlay fixed width from a day: "3d 04:05", no seconds', formatHMS(3 * DAY + 4 * HOUR + 5 * MIN + 37_000) === '3d 04:05');
}

console.log('\nDays — entry:');
{
  ok('msToDHMS splits days out of the hours', JSON.stringify(msToDHMS(2 * DAY + 3 * HOUR + 4 * MIN + 5000)) === JSON.stringify({ d: 2, h: 3, m: 4, s: 5 }));
  ok('dhmsToMs is its inverse', dhmsToMs({ d: 2, h: 3, m: 4, s: 5 }) === 2 * DAY + 3 * HOUR + 4 * MIN + 5000);
  ok('under a day there are no days', msToDHMS(5 * HOUR).d === 0);
  const r = timeBoxChange(0, 'h', 36);
  ok('36 typed into hours rolls over to 1 day 12 hours', JSON.stringify(msToDHMS(r.ms)) === JSON.stringify({ d: 1, h: 12, m: 0, s: 0 }) && r.rolledIntoDays);
  const r2 = timeBoxChange(DAY + 5 * HOUR, 'h', 30);
  ok('…adding to days already there (1 d 5 h, hours set to 30 → 2 d 6 h)', JSON.stringify(msToDHMS(r2.ms)) === JSON.stringify({ d: 2, h: 6, m: 0, s: 0 }));
  ok('23 hours does not roll over', !timeBoxChange(0, 'h', 23).rolledIntoDays && msToDHMS(timeBoxChange(0, 'h', 23).ms).h === 23);
  ok('typing days keeps the hours, minutes and seconds', JSON.stringify(msToDHMS(timeBoxChange(4 * HOUR + 30_000, 'd', 14).ms)) === JSON.stringify({ d: 14, h: 4, m: 0, s: 30 }));
  ok('seconds can still be entered on a multi-day value', msToDHMS(timeBoxChange(DAY, 's', 7).ms).s === 7);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
