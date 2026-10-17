import { describeStepAlarms, alarmDetail, stepTimers, computeStepProgress, progressBarStyle, provenanceLabel } from './src/stepDisplay.js';
import { startInstance, advanceInBand, startInBandManually } from './src/lib/instances.js';
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

  const noProbe = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: false, inBand: false }, 4000);
  ok('no probe: the band is never assumed reached', describe(stepTimers(noProbe, banded(null), 4000)) === '[0:04 elapsed] · band not reached yet · 0:00 in band');

  let lost = runInstance(); // in band 3–5 s, then out
  lost = advanceInBand(lost, { measured: true, inBand: true }, 9000); // back in band
  lost = advanceInBand(lost, { measured: false, inBand: false }, 12000); // data lost while in band
  ok('in band carried on without data is marked an estimate', describe(stepTimers(lost, banded(null), 12000)) === '[0:12 elapsed] · 0:09 since entering band · 0:06 in band ≈');
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

  const never = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: false, inBand: false }, 4000);
  const pn = computeStepProgress(never, banded({ kind: 'sinceBand', ms: 60000 }), noProbe, 4000);
  ok('no probe: nothing counted, hatched "waiting for temperature — no data"', pn.elapsedMs === 0 && pn.provenance === 'assumed-not-counting');
  const pl = computeStepProgress(i, banded({ kind: 'sinceBand', ms: 60000 }), noProbe, 8000);
  ok('entered, then data lost: still counting, drawn hatched to show no data is coming in', pl.elapsedMs === 5000 && pl.provenance === 'assumed-counting');
  ok('…and "since entering" is never an estimate', pl.latchedEstimate === false);

  const pi = computeStepProgress(never, banded({ kind: 'inBand', ms: 60000 }), noProbe, 4000);
  ok('time spent in band with no probe: hatched, not counting', pi.elapsedMs === 0 && pi.provenance === 'assumed-not-counting');
}

console.log('\nprogressBarStyle — no data shows as hatching even with nothing counted:');
{
  const colors = { gradientEnd: 'BLUE', border: 'GREY' };
  const hatched = (v) => v.startsWith('repeating-linear-gradient');
  const measured = progressBarStyle('measured-out-of-band', colors);
  ok('measured: solid fill and plain track', measured.fillStyle === 'BLUE' && measured.trackStyle === 'GREY');
  const noData = progressBarStyle('assumed-not-counting', colors);
  ok('no data, nothing counted: the track itself is hatched (a 0% fill would show nothing)', hatched(noData.trackStyle) && noData.trackStyle.includes('GREY'));
  ok('…and the fill is hatched too', hatched(noData.fillStyle) && noData.advancing === false);
  ok('no data but counting: hatched track and fill, advancing', hatched(progressBarStyle('assumed-counting', colors).trackStyle) && progressBarStyle('assumed-counting', colors).advancing);
}

console.log('\nManual in band — the bar and its caption:');
{
  const noProbe = { probeFor: () => null };
  let i = advanceInBand(startInstance({ id: 'i', recipeId: 'r', stepId: 's1', stepAlarmDefs: [] }, 0), { measured: false, inBand: false }, 2000);
  i = startInBandManually(i, 2000);
  i = advanceInBand(i, { measured: false, inBand: false }, 7000);
  const p = computeStepProgress(i, banded({ kind: 'inBand', ms: 60000 }), noProbe, 7000);
  ok('counting, hatched (still no data)', p.elapsedMs === 5000 && p.provenance === 'assumed-counting' && p.manualInBand);
  ok('captioned "in band — set by hand"', provenanceLabel(p.provenance, { manual: p.manualInBand }) === 'in band — set by hand');
  ok('an ordinary carried-on in band has no caption', provenanceLabel('assumed-counting') === null);
  const ps = computeStepProgress(i, banded({ kind: 'sinceBand', ms: 60000 }), noProbe, 7000);
  ok('a since-entering-band step entered when the timer was started by hand', ps.elapsedMs === 5000 && ps.provenance === 'assumed-counting');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
