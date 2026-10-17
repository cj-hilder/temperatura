import { describeStepAlarms, alarmDetail, stepTimers, computeStepProgress } from './src/stepDisplay.js';
import { startInstance, advanceInBand } from './src/lib/instances.js';
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

const runInstance = () => {
  // 0–3 s out of band, 3–5 s in band, 5–8 s out again: 8 s elapsed, 5 s since
  // entering, 2 s in band.
  let i = startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0);
  i = advanceInBand(i, { measured: true, inBand: false, claimed: true }, 3000);
  i = advanceInBand(i, { measured: true, inBand: true, claimed: true }, 5000);
  return advanceInBand(i, { measured: true, inBand: false, claimed: true }, 8000);
};
const banded = (duration) => ({ ...createBlankStep('s1'), tempBand: { lowC: 20, highC: 30 }, duration });
const describe = (timers) => timers.map((t) => (t.bold ? `[${t.text}]` : t.text) + (t.estimate ? ' ≈' : '')).join(' · ');

console.log('\nstepTimers — elapsed only without a band; all three with one, the duration\'s own in bold:');
{
  const i = runInstance();
  ok('no band: just elapsed, not bold', describe(stepTimers(i, { ...createBlankStep('s1') }, 8000)) === '0:08 elapsed');
  ok('band, no duration: elapsed in bold', describe(stepTimers(i, banded(null), 8000)) === '[0:08 elapsed] · 0:05 since entering band · 0:02 in band');
  ok('band, fixed length: elapsed in bold', describe(stepTimers(i, banded({ kind: 'fixed', ms: 60000 }), 8000)) === '[0:08 elapsed] · 0:05 since entering band · 0:02 in band');
  ok('band, time since entering band: that one in bold', describe(stepTimers(i, banded({ kind: 'sinceBand', ms: 60000 }), 8000)) === '0:08 elapsed · [0:05 since entering band] · 0:02 in band');
  ok('band, time spent in band: that one in bold', describe(stepTimers(i, banded({ kind: 'inBand', ms: 60000 }), 8000)) === '0:08 elapsed · 0:05 since entering band · [0:02 in band]');

  const fresh = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: true, inBand: false, claimed: true }, 4000);
  ok('before the band is reached: no misleading 0:00', stepTimers(fresh, banded(null), 4000)[1].text === 'band not reached yet');

  const assumed = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: false, inBand: true, claimed: false }, 4000);
  ok('an assumed entry marks both band timers as estimates', describe(stepTimers(assumed, banded(null), 4000)) === '[0:04 elapsed] · 0:04 since entering band ≈ · 0:04 in band ≈');
}

console.log('\ncomputeStepProgress — a "time since entering band" duration:');
{
  const noProbe = { probeFor: () => null };
  const waiting = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: true, inBand: false, claimed: true }, 4000);
  const measuredOut = { probeFor: () => ({ sample: { tempC: 10, probePresent: true }, msSinceLastPacket: 0, probe: {} }) };
  const p0 = computeStepProgress(waiting, banded({ kind: 'sinceBand', ms: 60000 }), measuredOut, 4000);
  ok('before entering: nothing counted, waiting for temperature', p0.elapsedMs === 0 && p0.provenance === 'measured-out-of-band');

  const i = runInstance();
  const p = computeStepProgress(i, banded({ kind: 'sinceBand', ms: 60000 }), measuredOut, 8000);
  ok('after entering: counts time since entering, and reads solid even though out of band now', p.elapsedMs === 5000 && p.provenance === 'measured-in-band' && p.remainingMs === 55000);
  ok('a measured entry is not an estimate', p.latchedEstimate === false);

  const assumed = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: false, inBand: true, claimed: false }, 4000);
  ok('an assumed entry is an estimate', computeStepProgress(assumed, banded({ kind: 'sinceBand', ms: 60000 }), noProbe, 4000).latchedEstimate === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
