import { describeStepAlarms, alarmDetail } from './src/stepDisplay.js';
import { createBlankStep, buildStepAlarmDefs } from './src/lib/recipe.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nalarmDetail — the alarm overlay\'s (kind value) qualifier:');
{
  ok('one-shot time alarm', alarmDetail({ kind: 'time', atMs: 5 * 60_000, repeat: false }, 1) === 'time 00:05:00');
  ok('duration-reached alarm reads the same as a one-shot time alarm',
    alarmDetail({ kind: 'duration', atMs: 3 * 60_000, repeat: false }, 1) === 'time 00:03:00');
  ok('repeating time alarm is numbered by its firedCount, even the first occurrence',
    alarmDetail({ kind: 'time', atMs: 5 * 60_000, repeat: true, intervalMs: 5 * 60_000 }, 1) === '#1 time 00:05:00');
  ok('the third repeat is numbered #3',
    alarmDetail({ kind: 'time', atMs: 5 * 60_000, repeat: true, intervalMs: 5 * 60_000 }, 3) === '#3 time 00:05:00');
  ok('heating temperature alarm', alarmDetail({ kind: 'temperature', direction: 'heating', thresholdC: 70 }, 1) === 'heating 70 deg');
  ok('cooling temperature alarm', alarmDetail({ kind: 'temperature', direction: 'cooling', thresholdC: 40 }, 1) === 'cooling 40 deg');
  ok('no def (e.g. the data-loss alarm) renders nothing', alarmDetail(null, 1) === null);
}

console.log('\ndescribeStepAlarms — canonical order: time asc, duration, heating asc, cooling desc, band:');
{
  const step = {
    ...createBlankStep('s1'),
    name: 'Ferment',
    duration: { ms: 20 * 60_000, kind: 'fixed' },
    durationReachedAlarm: { enabled: true, theme: null },
    tempBand: { lowC: 20, highC: 30 },
    timeAlarms: [
      { id: 't-late', name: 'Late', atMs: 15 * 60_000, repeat: false, intervalMs: null, theme: null },
      { id: 't-early', name: 'Early', atMs: 5 * 60_000, repeat: false, intervalMs: null, theme: null },
    ],
    tempAlarms: [
      { id: 'cool-low', name: 'Too cold', direction: 'cooling', thresholdC: 10, theme: null },
      { id: 'heat-high', name: 'Too hot', direction: 'heating', thresholdC: 80, theme: null },
      { id: 'cool-high', name: 'Cooling a bit', direction: 'cooling', thresholdC: 40, theme: null },
      { id: 'heat-low', name: 'Warming a bit', direction: 'heating', thresholdC: 30, theme: null },
    ],
  };
  const ids = describeStepAlarms(step).map((l) => l.id);
  ok('time (ascending) → duration → heating (ascending) → cooling (descending) → band-min → band-max',
    ids.join(',') === [
      't-early', 't-late',
      's1-duration-reached',
      'heat-low', 'heat-high',
      'cool-high', 'cool-low',
      's1-band-min', 's1-band-max',
    ].join(','));
}

console.log('\ndescribeStepAlarms — a "once" temperature alarm says so; nothing else changes:');
{
  const step = {
    ...createBlankStep('s1'),
    tempBand: { lowC: 20, highC: 30 },
    tempAlarms: [
      { id: 'once', name: 'Pan hot', direction: 'heating', thresholdC: 70, oneShot: true, theme: null },
      { id: 'every', name: 'Too hot', direction: 'heating', thresholdC: 80, oneShot: false, theme: null },
      { id: 'legacy', name: 'Old one', direction: 'cooling', thresholdC: 10, theme: null },
    ],
  };
  const text = Object.fromEntries(describeStepAlarms(step).map((l) => [l.id, l.text]));
  ok('a once alarm gets "(once)" appended', text.once === 'Pan hot — 70°C, heating (once)');
  ok('an every-time alarm reads as before', text.every === 'Too hot — 80°C, heating');
  ok('an older alarm with no oneShot field reads as every time', text.legacy === 'Old one — 10°C, cooling');
  ok('band alarms carry no "(once)"', !text['s1-band-min'].includes('(once)') && !text['s1-band-max'].includes('(once)'));
  const bandDefs = buildStepAlarmDefs(step).filter((d) => d.id.includes('-band-'));
  ok('band alarms are always every time (oneShot false)', bandDefs.length === 2 && bandDefs.every((d) => d.oneShot === false));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
