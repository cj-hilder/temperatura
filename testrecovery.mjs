import { createAppController } from './src/lib/app.js';
import { MemoryBackend } from './src/lib/storage.js';
import { createBlankStep, buildStepAlarmDefs, durationAlarmId } from './src/lib/recipe.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nKill mid-instance while running, resume: the gap counts as running + in-band time:');
{
  // ONE shared backend across "app restarts" — that's what makes recovery
  // testable, same technique as Ride the Wind's testrecovery.mjs.
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });

  const app1 = mkApp();
  const recipe = await app1.createRecipe({ name: 'Ferment', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const stepAlarmDefs = [];
  const tempBand = { lowC: 20, highC: 30 };

  const instance = await app1.startInstance({ id: 'inst-1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs, freeProbeIds: ['probe-1'] });
  ok('starting with exactly one free connected probe auto-assigns it', (await app1.getProbeAssignments())['inst-1'] === 'probe-1');

  clock += 1000;
  await app1.tick('inst-1', { stepAlarmDefs, hasTempInterest: true, tempBand, tempC: 25, msSinceLastPacket: 100, readingValid: true, claimed: true });
  ok('running with a live in-band reading accumulates', (await app1.store.getInstance('inst-1')).accumulatedInBandMs === 1000);

  // "App killed" — no clean shutdown, just stop using app1. 60s pass with the
  // app closed, then a fresh controller is constructed against the SAME
  // backend, simulating relaunch.
  clock += 60000;
  const app2 = mkApp();
  const reloaded = await app2.store.getInstance('inst-1');
  ok('the instance itself survived (same backend)', reloaded.status === 'running');

  // On relaunch there's no live BLE connection yet — same tick() call, no data.
  const result = await app2.tick('inst-1', { stepAlarmDefs, hasTempInterest: true, tempBand, tempC: null, msSinceLastPacket: null, readingValid: false, claimed: true });
  ok('the entire closed-app gap is folded in as in-band time (carried-forward state)', result.instance.accumulatedInBandMs === 1000 + 60000, result.instance.accumulatedInBandMs);
  ok('the gap being unmeasured latches the estimate flag', result.instance.latchedEstimate === true);
  ok('elapsedRunningMs also reflects the whole gap (no pauses involved)', app2.elapsedRunningMs(result.instance) === 61000);
}

console.log('\nKilled while paused: resumes paused, and the whole gap becomes paused time:');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });

  const app1 = mkApp();
  const recipe = await app1.createRecipe({ name: 'Rise', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app1.startInstance({ id: 'inst-2', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });

  clock += 30000; // ran for 30s
  await app1.pauseInstance('inst-2');
  ok('pausedAt persisted immediately', (await app1.store.getInstance('inst-2')).pausedAt === 30000);

  // Killed while paused. 5 minutes pass with the app closed.
  clock += 5 * 60 * 1000;
  const app2 = mkApp();
  const reloaded = await app2.store.getInstance('inst-2');
  ok('reloads still paused', reloaded.status === 'paused');
  ok('elapsedRunningMs excludes the still-open pause (including the closed-app portion of it)', app2.elapsedRunningMs(reloaded) === 30000);

  const resumed = await app2.resumeInstance('inst-2');
  ok('resuming folds the ENTIRE gap (pre-kill + closed-app) into accumulatedPausedMs', resumed.accumulatedPausedMs === 5 * 60 * 1000);
  ok('status running again after resume', resumed.status === 'running');
}

console.log('\nLatched estimate flag survives a restart:');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const stepAlarmDefs = [];
  const tempBand = { lowC: 20, highC: 30 };

  const app1 = mkApp();
  const recipe = await app1.createRecipe({ name: 'Tofu', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  // inst-3 is never given a probe (no freeProbeIds, and tick() below isn't
  // told it is claimed) — historically a dummy instance had to take the claim first (first instance
  // always does), which would defeat the point: the "assumes in-band from
  // the start" default only applies pre-measurement when unclaimed.
  await app1.startInstance({ id: 'inst-dummy', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  await app1.startInstance({ id: 'inst-3', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });

  // Never claimed by this instance, so every tick is "assumed" — this
  // exercises the "assumes in-band from the start" + latch path.
  clock += 2000;
  await app1.tick('inst-3', { stepAlarmDefs, hasTempInterest: false, tempBand, tempC: null, msSinceLastPacket: null, readingValid: false });
  ok('latched after an unclaimed/no-data tick', (await app1.store.getInstance('inst-3')).latchedEstimate === true);

  // Restart — the app itself, via a fresh controller against the same backend.
  const app2 = mkApp();
  const reloaded = await app2.store.getInstance('inst-3');
  ok('latchedEstimate survived the restart', reloaded.latchedEstimate === true);
}

console.log('\nProbe assignment survives a restart, and is released on Complete:');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });

  const app1 = mkApp();
  const recipe = await app1.createRecipe({ name: 'Bread', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app1.startInstance({ id: 'inst-4', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], freeProbeIds: ['probe-1'] });
  ok('probe assigned on start', (await app1.getProbeAssignments())['inst-4'] === 'probe-1');

  const app2 = mkApp();
  ok('the assignment survives a restart', (await app2.getProbeAssignments())['inst-4'] === 'probe-1');

  await app2.completeInstance('inst-4');
  ok('completing the instance releases its probe', Object.keys(await app2.getProbeAssignments()).length === 0);
}

console.log('\nDuration-reached alarm basis matches the progress bar\'s own metric, not a single universal clock:');
{
  // A "fixed length" duration is spec-pinned as always measured, never in
  // doubt — its duration-reached alarm must keep counting plain running time
  // even if the step also happens to carry a temperature band, exactly like
  // its progress bar does.
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Roast', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const duration = { ms: 5000, kind: 'fixed' };
  const tempBand = { lowC: 20, highC: 30 };
  const stepAlarmDefs = [{ id: 'd1', kind: 'duration', name: 'Duration reached', atMs: 5000, repeat: false, intervalMs: null, theme: null }];

  await app.startInstance({ id: 'inst-fixed', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });
  clock += 5000;
  const result = await app.tick('inst-fixed', {
    stepAlarmDefs, hasTempInterest: true, tempBand, duration,
    tempC: 99, msSinceLastPacket: 100, readingValid: true, // way out of band throughout
  });
  ok('fixed-length duration-reached alarm fires on running time, unaffected by being out of band',
    result.newlyFired.some((f) => f.id === 'd1'));
}

{
  // An "in temperature band" duration's alarm must use the exact same
  // accumulatedInBandMs the progress bar shows — time spent out of band
  // doesn't count towards it, however much wall-clock time has passed.
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Ferment', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const duration = { ms: 4000, kind: 'inBand' };
  const tempBand = { lowC: 20, highC: 30 };
  const stepAlarmDefs = [{ id: 'd2', kind: 'duration', name: 'Duration reached', atMs: 4000, repeat: false, intervalMs: null, theme: null }];

  await app.startInstance({ id: 'inst-inband', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });

  clock += 2000; // in band
  let result = await app.tick('inst-inband', {
    stepAlarmDefs, hasTempInterest: true, tempBand, duration,
    tempC: 25, msSinceLastPacket: 100, readingValid: true, claimed: true,
  });
  ok('2s in-band: not yet reached (needs 4s in-band)', result.newlyFired.length === 0);

  clock += 2000; // out of band — running time now at 4000ms, but in-band time still only 2000ms
  result = await app.tick('inst-inband', {
    stepAlarmDefs, hasTempInterest: true, tempBand, duration,
    tempC: 99, msSinceLastPacket: 100, readingValid: true, claimed: true,
  });
  ok('4s running but only 2s in-band: does not fire on running time', result.newlyFired.length === 0);

  clock += 2000; // back in band — in-band time now 4000ms
  result = await app.tick('inst-inband', {
    stepAlarmDefs, hasTempInterest: true, tempBand, duration,
    tempC: 25, msSinceLastPacket: 100, readingValid: true, claimed: true,
  });
  ok('fires once accumulated in-band time (not running time) reaches the threshold',
    result.newlyFired.some((f) => f.id === 'd2'));
}

console.log('\nExtend: temporary per-instance duration extension, end to end through app.js:');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Bread', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const step = { ...createBlankStep('step-1'), duration: { ms: 5000, kind: 'fixed' }, durationReachedAlarm: { enabled: true, theme: null } };
  const alarmId = durationAlarmId(step.id);

  await app.startInstance({ id: 'inst-extend', recipeId: recipe.id, stepId: step.id, stepAlarmDefs: buildStepAlarmDefs(step) });

  clock = 5000;
  let stepAlarmDefs = buildStepAlarmDefs(step, { durationExtensionMs: (await app.store.getInstance('inst-extend')).durationExtensionMs });
  let result = await app.tick('inst-extend', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration: step.duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  ok('fires at the original duration', result.newlyFired.some((f) => f.id === alarmId));
  ok('sounding after firing', result.sounding.includes(alarmId));

  const silenced = await app.silenceDurationAlarm('inst-extend');
  ok('silenceDurationAlarm silences it without needing to know the alarm id', silenced === alarmId);

  const extended = await app.extendDuration('inst-extend', 3000, step.duration);
  ok('extendDuration records the extra ms on the instance', extended.durationExtensionMs === 3000);
  ok('extendDuration re-arms the duration alarm', extended.alarmState[alarmId].firedCount === 0);

  // Still short of the new, extended threshold (5000 + 3000 = 8000).
  clock = 6000;
  stepAlarmDefs = buildStepAlarmDefs(step, { durationExtensionMs: extended.durationExtensionMs });
  result = await app.tick('inst-extend', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration: step.duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  ok('does not fire again before the extended threshold', result.newlyFired.length === 0);

  // Past the extended threshold.
  clock = 8000;
  result = await app.tick('inst-extend', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration: step.duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  ok('fires again once the extended threshold is reached', result.newlyFired.some((f) => f.id === alarmId));

  // Extending again is cumulative, not a replacement.
  await app.extendDuration('inst-extend', 1000, step.duration);
  const twiceExtended = await app.store.getInstance('inst-extend');
  ok('a second extension adds on top of the first', twiceExtended.durationExtensionMs === 4000);
}

console.log('\nStarting an instance that uses a probe, well outside the band does not clock up erroneous in-band time:');
{
  // The reported bug: on real hardware, the thermometer already being
  // claimed and connected doesn't mean the FIRST packet has arrived yet —
  // BLE connect/discover/first-notification can take a few real seconds.
  // During that gap, an instance must not assume in-band just because it
  // hasn't been told otherwise yet.
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Ferment', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const tempBand = { lowC: 20, highC: 30 };
  const duration = { ms: 60_000, kind: 'inBand' };

  await app.startInstance({ id: 'inst-outside', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  ok('(no probe assigned here, but tick() is told it is claimed below)', true);

  // A few ticks with no packet yet — connection still warming up.
  for (let i = 0; i < 4; i++) {
    clock += 1000;
    await app.tick('inst-outside', {
      stepAlarmDefs: [], hasTempInterest: true, tempBand, duration,
      tempC: null, msSinceLastPacket: null, readingValid: false, claimed: true,
    });
  }
  let instance = await app.store.getInstance('inst-outside');
  ok('claimed but never yet measured: zero in-band time accumulated', instance.accumulatedInBandMs === 0);
  ok('not latched either — this was never actually without a thermometer', instance.latchedEstimate === false);

  // The first real packet arrives — well outside the band, matching the bug report.
  clock += 1000;
  await app.tick('inst-outside', {
    stepAlarmDefs: [], hasTempInterest: true, tempBand, duration,
    tempC: 5, msSinceLastPacket: 100, readingValid: true, claimed: true,
  });
  instance = await app.store.getInstance('inst-outside');
  ok('first real (out-of-band) measurement: still zero accumulated — no leftover erroneous time', instance.accumulatedInBandMs === 0);
}

console.log('\nIngredients multiplier: per-recipe, not part of the recipe record, survives a restart:');
{
  const backend = new MemoryBackend();
  const mkApp = () => createAppController({ backend, now: () => 0 });
  const app1 = mkApp();
  const bread = await app1.createRecipe({ name: 'Bread', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const soup = await app1.createRecipe({ name: 'Soup', description: '', notes: [], servings: '', ingredients: [], steps: [] });

  ok('defaults to 1 (no scaling) before ever being set', await app1.getIngredientsMultiplier(bread.id) === 1);

  await app1.setIngredientsMultiplier(bread.id, 0.25);
  ok('setIngredientsMultiplier is readable back immediately', await app1.getIngredientsMultiplier(bread.id) === 0.25);
  ok('a different recipe is unaffected', await app1.getIngredientsMultiplier(soup.id) === 1);
  ok('not stored on the recipe record itself', (await app1.getRecipe(bread.id)).ingredientsMultiplier === undefined);

  // A restart (fresh controller, same backend) is the "close and open" the
  // spec requires this to survive.
  const app2 = mkApp();
  ok('survives a restart', await app2.getIngredientsMultiplier(bread.id) === 0.25);
}

console.log('\nMissed status end to end through app.tick()/app.dismissAlarm — a duration alarm left unanswered goes missed, then can be extended and re-armed:');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Ferment', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const duration = { ms: 60_000, kind: 'fixed' };
  const alarmId = durationAlarmId('step-1');
  // silenceAfterMs attached directly on the def here, the same way engine.js
  // attaches it (resolved from the alarm's theme) before calling app.tick.
  const stepAlarmDefs = [
    { id: alarmId, kind: 'duration', name: 'Duration reached', atMs: duration.ms, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 10_000 },
  ];

  await app.startInstance({ id: 'inst-missed', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });

  clock = 60_000;
  let result = await app.tick('inst-missed', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  ok('fires at the duration', result.newlyFired.some((f) => f.id === alarmId));
  ok('sounding', result.sounding.includes(alarmId));

  // Left unanswered past its 10s silence-after.
  clock = 71_000;
  result = await app.tick('inst-missed', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  let instance = await app.store.getInstance('inst-missed');
  ok('no longer sounding once missed', !result.sounding.includes(alarmId));
  ok('marked missed', instance.alarmState[alarmId].missed === true);

  // Extend it now, while missed — per the spec's own example, this must
  // extend from NOW (currently 71s elapsed), not from the stale 60s target.
  // isMissed=true is passed explicitly, exactly as engine.js's requestExtend
  // must capture it BEFORE dismissing the alarm (dismissing is what would
  // otherwise clear this flag out from under a caller that tried to re-derive
  // it here instead).
  const extended = await app.extendDuration('inst-missed', 5000, duration, true);
  ok('extending a missed alarm computes the new target from the current elapsed time',
    duration.ms + extended.durationExtensionMs === 71_000 + 5000);
  ok('dismissed by the extension (no longer missed)', extended.alarmState[alarmId].missed === false);

  // Confirm it does NOT fire again immediately (the whole point) — still
  // short of the new ~76s target. atMs must fold in the fresh
  // durationExtensionMs, exactly as recipe.js's buildStepAlarmDefs does —
  // alarms.js only ever compares against def.atMs, it knows nothing about
  // extensions itself.
  clock = 75_000;
  const extendedStepAlarmDefs = [{ ...stepAlarmDefs[0], atMs: duration.ms + extended.durationExtensionMs }];
  result = await app.tick('inst-missed', {
    stepAlarmDefs: extendedStepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false,
  });
  ok('does not fire again immediately after a from-now extension', result.newlyFired.length === 0);
}

console.log('\nRegression: extending a missed alarm through the REAL requestExtend/confirmExtend sequencing (dismiss happens BEFORE the extension is confirmed):');
{
  // engine.js's requestExtend dismisses (or silences) the alarm immediately,
  // before the Extend dialog is even shown — the same as it always has, so
  // Silence/Dismiss takes effect right away regardless of whether the user
  // goes on to actually confirm an extension. That means by the time
  // extendDuration is finally called, alarmState[alarmId].missed has ALREADY
  // been cleared back to false by that dismiss — a caller that tried to
  // re-derive "was this missed?" from the instance's state AT THAT POINT
  // would always see false and silently take the wrong (cumulative, not
  // from-now) branch. This reproduces that exact sequencing endto make sure
  // isMissed is threaded through as a value captured BEFORE the dismiss, not
  // re-read after it.
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Loaf', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const duration = { ms: 5000, kind: 'fixed' };
  const alarmId = durationAlarmId('step-1');
  const stepAlarmDefs = [
    { id: alarmId, kind: 'duration', name: 'Duration reached', atMs: duration.ms, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 8000 },
  ];

  await app.startInstance({ id: 'inst-real-seq', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });
  clock = 5000;
  await app.tick('inst-real-seq', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  clock = 13_000; // 8s past firing — misses its silence-after window
  await app.tick('inst-real-seq', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });

  // --- this is requestExtend's own sequence, in order ---
  let instance = await app.store.getInstance('inst-real-seq');
  const wasMissed = !!instance.alarmState[alarmId]?.missed; // captured first
  ok('setup: confirmed missed before the request sequence runs', wasMissed === true);
  await app.dismissAlarm('inst-real-seq', alarmId); // this is what clears it
  instance = await app.store.getInstance('inst-real-seq');
  ok('dismissAlarm did in fact already clear missed, before extendDuration is ever called', instance.alarmState[alarmId].missed === false);

  // --- this is confirmExtend's own call, using the captured wasMissed ---
  clock = 20_000; // the user takes a few seconds to answer the dialog
  const extended = await app.extendDuration('inst-real-seq', 5000, duration, wasMissed);
  ok('still extends from-now correctly, using the captured wasMissed rather than the now-cleared live state',
    duration.ms + extended.durationExtensionMs === 20_000 + 5000);
}

console.log('\nMissed status end to end — a repeating alarm retriggers on its own at the next interval even if a missed occurrence was never dismissed:');
{
  // This is the scenario that drove the design: a 5-minute repeat with a
  // short silence-after must NOT get stuck just because the user didn't
  // reach the phone in time — the next 5-minute interval has to fire
  // regardless, or the whole point of "repeating" is defeated.
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });
  const app = mkApp();
  const recipe = await app.createRecipe({ name: 'Stir loop', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const duration = { ms: 300_000, kind: 'fixed' };
  const repId = 'stir1';
  const stepAlarmDefs = [
    { id: repId, kind: 'time', name: 'Stir', atMs: 10_000, repeat: true, intervalMs: 10_000, theme: null, silenceAfterMs: 5_000 },
  ];

  await app.startInstance({ id: 'inst-rep-missed', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });

  clock = 10_000;
  let result = await app.tick('inst-rep-missed', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  ok('fires the first repeat', result.newlyFired.some((f) => f.id === repId));

  clock = 16_000; // 6s later, past the 5s silence-after, still short of the next interval (20s)
  result = await app.tick('inst-rep-missed', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  let instance = await app.store.getInstance('inst-rep-missed');
  ok('goes missed', instance.alarmState[repId].missed === true);
  ok('not silently re-fired just from going missed', result.newlyFired.length === 0);

  clock = 20_000; // the next interval's own due time
  result = await app.tick('inst-rep-missed', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  instance = await app.store.getInstance('inst-rep-missed');
  ok('fires the next repeat on schedule even though the previous occurrence was left missed and never dismissed', result.newlyFired.some((f) => f.id === repId));
  ok('the retrigger implicitly dismisses the earlier missed occurrence', instance.alarmState[repId].missed === false && instance.alarmState[repId].sounding === true);

  // Dismissing explicitly, ahead of the next natural retrigger, is still a
  // real (optional) action — e.g. to clear the outstanding indicator early.
  clock = 26_000; // past this occurrence's own silence-after too
  result = await app.tick('inst-rep-missed', { stepAlarmDefs, hasTempInterest: false, tempBand: null, duration, tempC: null, msSinceLastPacket: null, readingValid: false });
  instance = await app.store.getInstance('inst-rep-missed');
  ok('this occurrence goes missed too', instance.alarmState[repId].missed === true);
  await app.dismissAlarm('inst-rep-missed', repId);
  instance = await app.store.getInstance('inst-rep-missed');
  ok('can still be dismissed explicitly', instance.alarmState[repId].missed === false);
}

console.log('\nProbe assignment housekeeping in app.js — migration, close/delete, forget:');
{
  // An install from before multiple probes: a single global claim, one known probe.
  const backend = new MemoryBackend();
  const app = createAppController({ backend, now: () => 0 });
  await app.store.setSetting('claimHolderId', 'old-inst');
  await app.saveKnownProbes([{ id: 'probe-1', kind: 'ftherm', name: 'FTHERM 1' }]);
  const migrated = await app.getProbeAssignments();
  ok('the old single claim migrates onto the one known probe', migrated['old-inst'] === 'probe-1');
  ok('the legacy key is cleared so it can never migrate twice', (await app.store.getSetting('claimHolderId', null)) === null);
  ok('a second read is stable', (await createAppController({ backend }).getProbeAssignments())['old-inst'] === 'probe-1');

  // Several known probes: no way to know which one the old claim meant.
  const b2 = new MemoryBackend();
  const a2 = createAppController({ backend: b2 });
  await a2.store.setSetting('claimHolderId', 'old-inst');
  await a2.saveKnownProbes([{ id: 'p1', kind: 'ftherm', name: 'a' }, { id: 'p2', kind: 'bbq', name: 'b' }]);
  ok('with several known probes the stale claim is dropped', Object.keys(await a2.getProbeAssignments()).length === 0);
}
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  const recipe = await app.createRecipe({ name: 'R', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app.openRecipe(recipe.id);
  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 's', stepAlarmDefs: [], freeProbeIds: ['p1'] });
  ok('probe in use', (await app.getProbeAssignments()).i1 === 'p1');
  await app.closeRecipe(recipe.id);
  ok('closing the recipe completes its instances wholesale and still frees their probes', Object.keys(await app.getProbeAssignments()).length === 0);

  const r2 = await app.createRecipe({ name: 'R2', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app.startInstance({ id: 'i2', recipeId: r2.id, stepId: 's', stepAlarmDefs: [], freeProbeIds: ['p2'] });
  await app.deleteRecipe(r2.id);
  ok('deleting the recipe frees the probe too', Object.keys(await app.getProbeAssignments()).length === 0);

  await app.saveKnownProbes([{ id: 'p3', kind: 'bbq', name: 'BBQ 1' }, { id: 'p4', kind: 'bbq', name: 'BBQ 2' }]);
  await app.startInstance({ id: 'i3', recipeId: recipe.id, stepId: 's', stepAlarmDefs: [] });
  await app.assignProbe('i3', 'p3');
  await app.assignProbe('i4', 'p3');
  ok('a deliberate assignment transfers the probe', (await app.getProbeAssignments()).i3 === undefined && (await app.getProbeAssignments()).i4 === 'p3');
  await app.forgetKnownProbe('p3');
  ok('forgetting a probe releases it and drops it from the known list',
    Object.keys(await app.getProbeAssignments()).length === 0 && (await app.getKnownProbes()).map((p) => p.id).join() === 'p4');

  await app.assignProbe('i5', 'p4');
  await app.pruneProbeAssignments([]);
  ok('pruning drops assignments of instances that are no longer active', Object.keys(await app.getProbeAssignments()).length === 0);
}

console.log('\nA "time since entering band" duration: its alarm runs on that clock, end to end through app.tick():');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const app = createAppController({ backend, now: () => clock });
  const recipe = await app.createRecipe({ name: 'Sous vide', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const duration = { ms: 10_000, kind: 'sinceBand' };
  const tempBand = { lowC: 55, highC: 60 };
  const alarmId = durationAlarmId('step-sv');
  const stepAlarmDefs = [{ id: alarmId, kind: 'duration', name: 'Duration reached', atMs: duration.ms, repeat: false, intervalMs: null, theme: null }];
  await app.startInstance({ id: 'inst-sv', recipeId: recipe.id, stepId: 'step-sv', stepAlarmDefs });
  const tickAt = (t, tempC) => { clock = t; return app.tick('inst-sv', { stepAlarmDefs, hasTempInterest: true, tempBand, duration, tempC, msSinceLastPacket: 0, readingValid: true, claimed: true }); };

  // Heating up for 20 s: longer than the 10 s duration, but the band is not reached.
  for (let t = 1000; t <= 20_000; t += 1000) await tickAt(t, 30 + t / 1000);
  let inst = await app.store.getInstance('inst-sv');
  ok('20 s of heating up does not reach a 10 s "since entering band" duration', !inst.alarmState[alarmId].sounding && !inst.enteredBand);

  // Into the band at 21 s, then out again at 25 s (it overshoots).
  for (let t = 21_000; t <= 24_000; t += 1000) await tickAt(t, 57);
  for (let t = 25_000; t <= 29_000; t += 1000) await tickAt(t, 62);
  inst = await app.store.getInstance('inst-sv');
  ok('9 s since entering (4 in band, 5 out): not yet', !inst.alarmState[alarmId].sounding && inst.accumulatedSinceBandMs === 9000 && inst.accumulatedInBandMs === 4000);
  const result = await tickAt(30_000, 62);
  ok('fires 10 s after entering the band, though the reading is out of band now', result.newlyFired.some((f) => f.id === alarmId));

  // Extend uses the same clock.
  const extended = await app.extendDuration('inst-sv', 5000, duration, false);
  ok('Extend adds to the same target (10 s + 5 s)', duration.ms + extended.durationExtensionMs === 15_000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
