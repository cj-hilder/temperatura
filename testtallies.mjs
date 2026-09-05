import { createAppController } from './src/lib/app.js';
import { MemoryBackend } from './src/lib/storage.js';
import { createBlankStep } from './src/lib/recipe.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

const mkRecipe = (app, steps) => app.createRecipe({
  name: 'Loaf', description: '', notes: [], servings: '', ingredients: [],
  steps: steps.map((name, i) => ({ ...createBlankStep(`step-${i + 1}`), name })),
});

console.log('\nCompletion tallies — ticking up on Complete:');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  const recipe = await mkRecipe(app, ['Mix', 'Rise']);

  ok('starts with no ticks recorded', Object.keys(await app.getCompletionTicks(recipe.id)).length === 0);

  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  await app.completeInstance('i1');
  ok('completing an instance ticks its own step once', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);

  await app.startInstance({ id: 'i2', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  await app.completeInstance('i2');
  ok('completing a second instance of the same step accumulates', (await app.getCompletionTicks(recipe.id))['step-1'] === 2);

  await app.startInstance({ id: 'i3', recipeId: recipe.id, stepId: 'step-2', stepAlarmDefs: [] });
  await app.completeInstance('i3');
  const ticks = await app.getCompletionTicks(recipe.id);
  ok('a different step ticks separately', ticks['step-1'] === 2 && ticks['step-2'] === 1);
}

console.log('\nCompletion tallies — Clear all tallies:');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  const recipe = await mkRecipe(app, ['Mix']);

  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  await app.completeInstance('i1');
  ok('a tick was recorded before clearing', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);

  await app.clearCompletionTicks(recipe.id);
  ok('clearCompletionTicks zeroes every step', Object.keys(await app.getCompletionTicks(recipe.id)).length === 0);
}

console.log('\nCompletion tallies — auto-reset is off by default:');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  ok('getAutoClearTallies defaults to false on a fresh install', (await app.getAutoClearTallies()) === false);

  const recipe = await mkRecipe(app, ['Mix']);
  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  await app.completeInstance('i1');
  ok('a tick was recorded', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);

  // Recipe is fully idle, and this is a step-1 start — but the setting is
  // off, so nothing should auto-clear.
  await app.startInstance({ id: 'i2', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  ok('does not auto-clear while the setting is off, even though the recipe is idle', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);
}

console.log('\nCompletion tallies — auto-reset when starting step 1 while the recipe is fully idle (setting on):');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  await app.setAutoClearTallies(true);
  const recipe = await mkRecipe(app, ['Mix', 'Rise']);

  // One full pass: step 1 then step 2, both completed.
  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  await app.completeInstance('i1');
  await app.startInstance({ id: 'i2', recipeId: recipe.id, stepId: 'step-2', stepAlarmDefs: [] });
  await app.completeInstance('i2');
  const afterFirstPass = await app.getCompletionTicks(recipe.id);
  ok('one full pass recorded a tick on each step', afterFirstPass['step-1'] === 1 && afterFirstPass['step-2'] === 1);

  // Every instance is now completed (the recipe is idle) — starting step 1
  // again should wipe the tallies clean.
  await app.startInstance({ id: 'i3', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  ok('starting step 1 while the recipe is fully idle clears every tally', Object.keys(await app.getCompletionTicks(recipe.id)).length === 0);
}

console.log('\nCompletion tallies — auto-reset does NOT fire while a parallel batch is still mid-recipe (setting on):');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  await app.setAutoClearTallies(true);
  const recipe = await mkRecipe(app, ['Mix', 'Rise']);

  // Batch A: mix completed, now rising (in-progress on step 2) — set aside
  // between steps, not actively timed, but not idle either.
  await app.startInstance({ id: 'a1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  await app.completeInstance('a1');
  await app.startInstance({ id: 'a2', recipeId: recipe.id, stepId: 'step-2', stepAlarmDefs: [] });

  // Batch B starts a fresh step 1 in parallel.
  await app.startInstance({ id: 'b1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  ok('does not reset while batch A is still mid-recipe (rising)', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);
}

console.log('\nCompletion tallies — auto-reset does NOT fire if step 1 itself already has a running instance (setting on):');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  await app.setAutoClearTallies(true);
  const recipe = await mkRecipe(app, ['Mix']);

  await app.startInstance({ id: 'a1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  await app.completeInstance('a1');
  // A second, still-running instance of step 1 (e.g. Duplicate) exists when
  // a third is started with isFirstStep — the pre-existing runner must
  // block the reset even though it's the same step being (re)started.
  await app.startInstance({ id: 'a2', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  await app.startInstance({ id: 'a3', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [], isFirstStep: true });
  ok('does not reset while another step-1 instance is still running', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);
}

console.log('\nCompletion tallies — closing a recipe clears them (tallies don\'t survive close/reopen):');
{
  const app = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  const recipe = await mkRecipe(app, ['Mix']);
  await app.openRecipe(recipe.id);

  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 'step-1', stepAlarmDefs: [] });
  await app.completeInstance('i1');
  ok('a tick was recorded before closing', (await app.getCompletionTicks(recipe.id))['step-1'] === 1);

  await app.closeRecipe(recipe.id);
  ok('closing the recipe clears its tallies', Object.keys(await app.getCompletionTicks(recipe.id)).length === 0);

  await app.openRecipe(recipe.id);
  ok('reopening does not bring the tally back', Object.keys(await app.getCompletionTicks(recipe.id)).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
