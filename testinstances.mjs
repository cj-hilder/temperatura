import {
  startInstance, pauseInstance, resumeInstance, restartInstance, completeInstance,
  duplicateInstance, setTag, elapsedRunningMs, elapsedTotalMs, advanceInBand,
  isMeasured, deriveProvenance, extendDuration, noInstancesInProgress,
} from './src/lib/instances.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };
const close = (a, b, tol = 1) => Math.abs(a - b) <= tol;

console.log('\nStart / elapsed arithmetic:');
{
  let i = startInstance({ id: 'i1', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 1000);
  ok('status running on start', i.status === 'running');
  ok('elapsedRunningMs is 0 at start', elapsedRunningMs(i, 1000) === 0);
  ok('elapsedRunningMs advances with wall clock', elapsedRunningMs(i, 6000) === 5000);
  ok('elapsedTotalMs matches elapsedRunningMs with no pauses', elapsedTotalMs(i, 6000) === 5000);
}

console.log('\nPause/resume arithmetic (mirrors RTW\'s startedAt/pausedAt/accumulatedPausedMs):');
{
  let i = startInstance({ id: 'i2', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 0);
  i = pauseInstance(i, 3000); // ran 3s
  ok('status paused', i.status === 'paused');
  ok('pausedAt recorded', i.pausedAt === 3000);
  ok('elapsedRunningMs frozen while paused (excludes open pause)', elapsedRunningMs(i, 10000) === 3000);
  ok('elapsedTotalMs keeps advancing while paused', elapsedTotalMs(i, 10000) === 10000);

  i = resumeInstance(i, 8000); // paused for 5s
  ok('status running again', i.status === 'running');
  ok('accumulatedPausedMs captured the closed pause', i.accumulatedPausedMs === 5000);
  ok('elapsedRunningMs excludes the closed pause', elapsedRunningMs(i, 11000) === 6000); // 3s + 3s
}

console.log('\nRestart zeroes the accumulator and re-arms time alarms:');
{
  const timeDef = { id: 't1', kind: 'time', name: 'T', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  let i = startInstance({ id: 'i3', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [timeDef] }, 0);
  i = advanceInBand(i, { measured: true, inBand: true }, 5000);
  ok('accumulated some in-band time before restart', i.accumulatedInBandMs === 5000);
  // simulate the time alarm having fired
  i = { ...i, alarmState: { ...i.alarmState, t1: { firedCount: 1, sounding: true, firedAt: 1000 } } };

  i = restartInstance(i, [timeDef], 20000);
  ok('startedAt reset to restart time', i.startedAt === 20000);
  ok('accumulatedInBandMs zeroed', i.accumulatedInBandMs === 0);
  ok('accumulatedPausedMs zeroed', i.accumulatedPausedMs === 0);
  ok('latchedEstimate cleared', i.latchedEstimate === false);
  ok('time alarm re-armed (fresh runtime state)', i.alarmState.t1.firedCount === 0 && i.alarmState.t1.sounding === false);
}

console.log('\nDuplicate starts a fresh, independent instance:');
{
  let i = startInstance({ id: 'i4', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 0);
  i = setTag(i, 'Loaf 1');
  i = advanceInBand(i, { measured: true, inBand: true }, 5000);
  const dup = duplicateInstance(i, 'i5', [], 5000);
  ok('duplicate has a fresh id', dup.id === 'i5');
  ok('duplicate shares recipe/step', dup.recipeId === i.recipeId && dup.stepId === i.stepId);
  ok('duplicate has no tag', dup.tag === null);
  ok('duplicate has no accumulated time', dup.accumulatedInBandMs === 0);
  ok('original instance is unaffected', i.accumulatedInBandMs === 5000 && i.tag === 'Loaf 1');
}

console.log('\nComplete:');
{
  let i = startInstance({ id: 'i6', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 0);
  i = completeInstance(i, 9000);
  ok('status completed', i.status === 'completed');
  ok('completedAt recorded', i.completedAt === 9000);
}

console.log('\nIn-band accumulation under every provenance state:');
{
  // Measured, in band — advances, not latched.
  let i = startInstance({ id: 'p1', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i = advanceInBand(i, { measured: true, inBand: true }, 1000);
  ok('measured+inBand accumulates', i.accumulatedInBandMs === 1000);
  ok('measured accumulation does not latch', i.latchedEstimate === false);

  // Measured, out of band — does not advance.
  let i2 = startInstance({ id: 'p2', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i2 = advanceInBand(i2, { measured: true, inBand: false }, 1000);
  ok('measured+outOfBand does not accumulate', i2.accumulatedInBandMs === 0);

  // Assumed, counting (last known state was in-band, now unmeasured) — advances AND latches.
  let i3 = startInstance({ id: 'p3', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i3 = advanceInBand(i3, { measured: true, inBand: true }, 1000); // establish in-band
  i3 = advanceInBand(i3, { measured: false, inBand: false }, 3000); // lost data — carries forward "in band"
  ok('assumed+counting accumulates the elapsed span (2000ms) using the carried-forward state', i3.accumulatedInBandMs === 3000);
  ok('assumed+counting latches the estimate flag', i3.latchedEstimate === true);

  // Assumed, not counting (last known state was out-of-band, now unmeasured) — frozen, not latched
  // (spec: the latch only fires when in-band time is accumulated while assumed).
  let i4 = startInstance({ id: 'p4', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i4 = advanceInBand(i4, { measured: true, inBand: false }, 1000); // establish out-of-band
  i4 = advanceInBand(i4, { measured: false, inBand: false }, 3000); // lost data
  ok('assumed+notCounting does not accumulate', i4.accumulatedInBandMs === 0);
  ok('assumed+notCounting does not latch (no in-band time was accumulated)', i4.latchedEstimate === false);

  // Never any data at all — assumes in-band from the start, per spec.
  let i5 = startInstance({ id: 'p5', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i5 = advanceInBand(i5, { measured: false, inBand: false }, 4000); // first-ever evaluation, no data yet
  ok('no data ever: assumes in-band from the start', i5.accumulatedInBandMs === 4000);
  ok('no data ever: latches immediately', i5.latchedEstimate === true);

  // Claimed but not yet measured (a live connection exists, the first real
  // reading just hasn't arrived yet) — must NOT assume in-band, unlike the
  // unclaimed case above. Bug: starting a step well outside the band was
  // clocking up several seconds of in-band time before the first real
  // reading corrected it.
  let i6 = startInstance({ id: 'p6', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i6 = advanceInBand(i6, { measured: false, inBand: false, claimed: true }, 3000);
  ok('claimed but never yet measured: does NOT assume in-band', i6.accumulatedInBandMs === 0);
  ok('claimed but never yet measured: does not latch either', i6.latchedEstimate === false);

  // Once the first real measurement arrives (out of band, matching the bug
  // report), it takes over immediately and correctly — no leftover
  // erroneous accumulation from the unmeasured start.
  i6 = advanceInBand(i6, { measured: true, inBand: false, claimed: true }, 5000);
  ok('first real measurement (out of band) correctly accumulates nothing', i6.accumulatedInBandMs === 0);
  ok('everMeasured is now true', i6.everMeasured === true);

  // And once genuinely measured, a LATER gap is an ordinary continuation —
  // claim status stops mattering, exactly like the assumed+counting case above.
  i6 = advanceInBand(i6, { measured: true, inBand: true, claimed: true }, 6000); // now in band: +1000ms
  i6 = advanceInBand(i6, { measured: false, inBand: false, claimed: true }, 8000); // lost data — carries forward "in band": +2000ms
  ok('after real measurement, an unmeasured gap still carries forward normally', i6.accumulatedInBandMs === 3000);
  ok('and still latches, same as any other post-measurement gap', i6.latchedEstimate === true);

  // The unclaimed case is completely unaffected by everMeasured/claimed —
  // still assumes in-band immediately, exactly as i5 above.
  let i7 = startInstance({ id: 'p7', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i7 = advanceInBand(i7, { measured: false, inBand: false, claimed: false }, 4000);
  ok('unclaimed and never measured: still assumes in-band immediately', i7.accumulatedInBandMs === 4000);
}

console.log('\nOnce latched, the flag survives regaining the probe:');
{
  let i = startInstance({ id: 'l1', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i = advanceInBand(i, { measured: true, inBand: true }, 1000);
  i = advanceInBand(i, { measured: false, inBand: false }, 3000); // latches
  ok('latched after an assumed span', i.latchedEstimate === true);
  i = advanceInBand(i, { measured: true, inBand: true }, 4000); // probe regained
  ok('stays latched after regaining the probe', i.latchedEstimate === true);
}

console.log('\nIn-band accumulation is frozen while paused, and the paused span is excluded on resume:');
{
  let i = startInstance({ id: 'z1', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i = advanceInBand(i, { measured: true, inBand: true }, 1000);
  i = pauseInstance(i, 1000);
  const beforeResume = i.accumulatedInBandMs;
  // A sample arriving while paused must not move the accumulator.
  i = advanceInBand(i, { measured: true, inBand: true }, 5000);
  ok('advanceInBand is a no-op while paused', i.accumulatedInBandMs === beforeResume);
  i = resumeInstance(i, 9000); // paused 1000 -> 9000, 8s excluded
  i = advanceInBand(i, { measured: true, inBand: true }, 10000);
  ok('the paused span is excluded from accumulation after resume', i.accumulatedInBandMs === 2000); // 1000 (pre-pause) + 1000 (post-resume)
}

console.log('\nRecovery: a killed-and-relaunched app folds the whole gap using the same function:');
{
  let i = startInstance({ id: 'r1', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i = advanceInBand(i, { measured: true, inBand: true }, 1000); // running, in band, then "killed"
  ok('accumulated the pre-kill span while genuinely measured', i.accumulatedInBandMs === 1000 && i.latchedEstimate === false);
  const killedAt = 1000;
  const relaunchedAt = 61000; // 60s gap with the app closed
  // On relaunch there is no live BLE data yet — same call, bigger gap.
  i = advanceInBand(i, { measured: false, inBand: false }, relaunchedAt);
  ok(
    'the entire closed-app gap is folded in on top of the pre-kill span, carrying forward "in band"',
    i.accumulatedInBandMs === 1000 + (relaunchedAt - killedAt)
  );
  ok('recovery latches the estimate (the gap itself was assumed)', i.latchedEstimate === true);
}

console.log('\nRound-trip through storage (plain JSON, as IndexedDB would store it):');
{
  let i = startInstance({ id: 'j1', recipeId: 'r', stepId: 's', stepAlarmDefs: [] }, 0);
  i = advanceInBand(i, { measured: true, inBand: true }, 1000);
  i = advanceInBand(i, { measured: false, inBand: false }, 3000); // latches
  const roundTripped = JSON.parse(JSON.stringify(i));
  ok('latchedEstimate survives a JSON round trip', roundTripped.latchedEstimate === true);
  ok('accumulatedInBandMs survives a JSON round trip', roundTripped.accumulatedInBandMs === i.accumulatedInBandMs);
}

console.log('\nisMeasured / deriveProvenance:');
{
  ok('measured requires claim + fresh packet + valid reading', isMeasured({ claimed: true, msSinceLastPacket: 100, readingValid: true }) === true);
  ok('not measured when unclaimed', isMeasured({ claimed: false, msSinceLastPacket: 100, readingValid: true }) === false);
  ok('not measured past the 5s timeout', isMeasured({ claimed: true, msSinceLastPacket: 5000, readingValid: true }) === false);
  ok('not measured with no packet ever', isMeasured({ claimed: true, msSinceLastPacket: null, readingValid: true }) === false);
  ok('not measured with an invalid reading', isMeasured({ claimed: true, msSinceLastPacket: 100, readingValid: false }) === false);

  ok('measured+inBand -> measured-in-band', deriveProvenance({ measured: true, inBand: true }) === 'measured-in-band');
  ok('measured+outOfBand -> measured-out-of-band', deriveProvenance({ measured: true, inBand: false }) === 'measured-out-of-band');
  ok('assumed+counting -> assumed-counting', deriveProvenance({ measured: false, inBand: true }) === 'assumed-counting');
  ok('assumed+notCounting -> assumed-not-counting', deriveProvenance({ measured: false, inBand: false }) === 'assumed-not-counting');
}

console.log('\nextendDuration — a temporary, per-instance addition to the step\'s own duration:');
{
  let i = startInstance({ id: 'i9', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [
    { id: 's1-duration-reached', kind: 'duration', name: 'Duration reached', atMs: 60000, repeat: false, intervalMs: null, theme: null },
    { id: 'temp1', kind: 'temperature', name: 'Hot', thresholdC: 50, direction: 'heating', theme: null },
  ] }, 0);
  ok('starts with no extension', i.durationExtensionMs === 0);

  i = extendDuration(i, 5 * 60000, 's1-duration-reached');
  ok('adds the extra ms', i.durationExtensionMs === 5 * 60000);

  i = extendDuration(i, 2 * 60000, 's1-duration-reached');
  ok('a second extension is cumulative', i.durationExtensionMs === 7 * 60000);

  // Simulate the alarm having already fired for the un-extended duration.
  i.alarmState['s1-duration-reached'] = { firedCount: 1, sounding: true, firedAt: 12345 };
  i = extendDuration(i, 60000, 's1-duration-reached');
  ok('re-arms the named alarm so it can fire again at the new threshold',
    i.alarmState['s1-duration-reached'].firedCount === 0 &&
    i.alarmState['s1-duration-reached'].sounding === false &&
    i.alarmState['s1-duration-reached'].firedAt === null);
  ok('does not touch an unrelated alarm\'s state', i.alarmState.temp1 !== undefined);

  const before = JSON.stringify(i.alarmState.temp1);
  i = extendDuration(i, 60000, 'unknown-id-not-in-alarm-state');
  ok('re-arming an id with no matching entry is a harmless no-op', JSON.stringify(i.alarmState.temp1) === before);

  const withoutId = extendDuration(i, 60000);
  ok('extendDuration works with no id to re-arm at all', withoutId.durationExtensionMs === i.durationExtensionMs + 60000);
}

console.log('\nextendDuration — a normal (not missed) rearm also clears missed on the target alarm:');
{
  let i = startInstance({ id: 'i9b', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 0);
  i.alarmState['s1-duration-reached'] = { firedCount: 1, sounding: false, missed: true, firedAt: 12345 };
  i = extendDuration(i, 60000, 's1-duration-reached');
  ok('extending clears missed even on the ordinary (not-isMissed-flagged) path', i.alarmState['s1-duration-reached'].missed === false);
}

console.log('\nextendDuration — a MISSED duration alarm extends from now, not from the stale original target:');
{
  // The spec's own worked example: a duration reached long enough ago that
  // silence-after has elapsed and it's sitting missed. Concretely: a 60-
  // minute duration, now 120 minutes of elapsed time in (i.e. missed 60
  // minutes ago), extended by 5 minutes. Naively adding 5 min to the
  // original 60-min target (durationExtensionMs += 5min => new target 65
  // min) would already be 55 minutes in the past — pointless. Extending
  // "from now" instead must produce a target of 120+5 = 125 minutes, which
  // is a total addition of 125-60 = 65 minutes — the spec's own "+5 min is
  // effectively +65 min" example, exactly.
  let i = startInstance({ id: 'i10', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 0);
  i.alarmState['s1-duration-reached'] = { firedCount: 1, sounding: false, missed: true, firedAt: 3_600_000 };

  const originalDurationMs = 60 * 60_000; // 60 minutes
  const currentTimeBasisMs = 120 * 60_000; // 120 minutes elapsed right now
  const extraMs = 5 * 60_000; // +5 minutes requested

  i = extendDuration(i, extraMs, 's1-duration-reached', { isMissed: true, originalDurationMs, currentTimeBasisMs });

  ok('the effective addition is +65 minutes, not +5', i.durationExtensionMs === 65 * 60_000);
  ok('the new target (original + extension) lands exactly extraMs ahead of currentTimeBasisMs',
    originalDurationMs + i.durationExtensionMs === currentTimeBasisMs + extraMs);
  ok('re-arms the alarm so it can fire again at the new target', i.alarmState['s1-duration-reached'].firedCount === 0 && i.alarmState['s1-duration-reached'].sounding === false);
  ok('clears missed', i.alarmState['s1-duration-reached'].missed === false);
}

console.log('\nextendDuration — extending a SECOND time while missed again recomputes from now, not cumulatively with the first missed-extension:');
{
  let i = startInstance({ id: 'i11', recipeId: 'r1', stepId: 's1', stepAlarmDefs: [] }, 0);
  i.alarmState['s1-duration-reached'] = { firedCount: 1, sounding: false, missed: true, firedAt: 0 };

  // First missed-extend, per above: target becomes 65 minutes.
  i = extendDuration(i, 5 * 60_000, 's1-duration-reached', {
    isMissed: true, originalDurationMs: 60 * 60_000, currentTimeBasisMs: 60 * 60_000,
  });
  ok('first missed-extension: target is now +5 min from that moment (65 min)', i.durationExtensionMs === 5 * 60_000);

  // It gets missed again, and much later (200 min in) is extended again by
  // 10 min. This must land at 210 min total, NOT stack on top of the first
  // extension's 65-min target.
  i.alarmState['s1-duration-reached'] = { firedCount: 2, sounding: false, missed: true, firedAt: 65 * 60_000 };
  i = extendDuration(i, 10 * 60_000, 's1-duration-reached', {
    isMissed: true, originalDurationMs: 60 * 60_000, currentTimeBasisMs: 200 * 60_000,
  });
  ok('second missed-extension recomputes absolutely: new target is 210 min, an effective +150 min total, not +10 on top of +5',
    60 * 60_000 + i.durationExtensionMs === 210 * 60_000);
}

console.log('\nnoInstancesInProgress — completion tally auto-reset\'s "is the recipe idle" check:');
{
  ok('true when there are no instances at all', noInstancesInProgress([]));
  ok('true when every instance is completed', noInstancesInProgress([
    { status: 'completed' }, { status: 'completed' },
  ]));
  ok('false when any instance is running', noInstancesInProgress([
    { status: 'completed' }, { status: 'running' },
  ]) === false);
  ok('false when any instance is paused (paused still counts as in-progress)', noInstancesInProgress([
    { status: 'paused' },
  ]) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
