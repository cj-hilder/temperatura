import { createAppController } from './src/lib/app.js';
import { MemoryBackend } from './src/lib/storage.js';

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

  const instance = await app1.startInstance({ id: 'inst-1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs });
  ok('starting the first instance auto-acquires the claim', await app1.getClaimHolderId() === 'inst-1');

  clock += 1000;
  await app1.tick('inst-1', { stepAlarmDefs, hasTempInterest: true, tempBand, tempC: 25, msSinceLastPacket: 100, readingValid: true });
  ok('running with a live in-band reading accumulates', (await app1.store.getInstance('inst-1')).accumulatedInBandMs === 1000);

  // "App killed" — no clean shutdown, just stop using app1. 60s pass with the
  // app closed, then a fresh controller is constructed against the SAME
  // backend, simulating relaunch.
  clock += 60000;
  const app2 = mkApp();
  const reloaded = await app2.store.getInstance('inst-1');
  ok('the instance itself survived (same backend)', reloaded.status === 'running');

  // On relaunch there's no live BLE connection yet — same tick() call, no data.
  const result = await app2.tick('inst-1', { stepAlarmDefs, hasTempInterest: true, tempBand, tempC: null, msSinceLastPacket: null, readingValid: false });
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

console.log('\nClaim state survives a restart:');
{
  const backend = new MemoryBackend();
  let clock = 0;
  const mkApp = () => createAppController({ backend, now: () => clock });

  const app1 = mkApp();
  const recipe = await app1.createRecipe({ name: 'Bread', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app1.startInstance({ id: 'inst-4', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  ok('claim acquired on start', await app1.getClaimHolderId() === 'inst-4');

  const app2 = mkApp();
  ok('claim holder survives a restart', await app2.getClaimHolderId() === 'inst-4');

  await app2.completeInstance('inst-4');
  ok('completing the holder releases the claim', await app2.getClaimHolderId() === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
