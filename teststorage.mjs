import { Store, MemoryBackend, STORES, DEFAULT_THEME_ID } from './src/lib/storage.js';
import { createBlankRecipe, createBlankStep, recipeToExportJSON, recipeFromImportJSON, buildStepAlarmDefs, durationAlarmId } from './src/lib/recipe.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

let seq = 0;
const mkStore = () => new Store({ backend: new MemoryBackend(), uuid: () => `id-${++seq}` });

console.log('\nRecipes: create, get, list, update, validation:');
{
  const store = mkStore();
  const recipe = { ...createBlankRecipe(), name: 'Sourdough' };
  const saved = await store.createRecipe(recipe);
  ok('createRecipe assigns an id', typeof saved.id === 'string' && saved.id.length > 0);
  ok('getRecipe finds it', (await store.getRecipe(saved.id)).name === 'Sourdough');
  ok('listRecipes includes it', (await store.listRecipes()).some((r) => r.id === saved.id));

  await store.updateRecipe(saved.id, { description: 'A basic loaf.' });
  ok('updateRecipe patches fields', (await store.getRecipe(saved.id)).description === 'A basic loaf.');

  let threw = false;
  try { await store.createRecipe({ ...createBlankRecipe(), name: '' }); } catch { threw = true; }
  ok('createRecipe rejects a recipe with no name', threw);

  const badStep = { ...createBlankStep('s1'), name: 'Rise', duration: { ms: 1000, kind: 'inBand' }, tempBand: null };
  threw = false;
  try { await store.createRecipe({ ...createBlankRecipe(), name: 'Bad', steps: [badStep] }); } catch { threw = true; }
  ok('createRecipe rejects an in-band duration with no temperature band', threw);

  threw = false;
  try {
    await store.createRecipe({
      ...createBlankRecipe(), name: 'Bad quantity',
      ingredients: [{ name: 'Flour', quantity: 'lots', unit: 'g' }],
    });
  } catch { threw = true; }
  ok('createRecipe rejects an ingredient quantity that is neither a decimal nor a fraction', threw);

  const saved2 = await store.createRecipe({
    ...createBlankRecipe(), name: 'Good quantities',
    ingredients: [
      { name: 'Flour', quantity: '500', unit: 'g' },
      { name: 'Water', quantity: '1/2', unit: 'cup' },
      { name: 'Salt', quantity: '', unit: 'to taste' },
    ],
  });
  ok('createRecipe accepts decimal, fraction, and blank ingredient quantities', saved2.ingredients.length === 3);
}

console.log('\nRecipe JSON import/export (individual recipe):');
{
  const store = mkStore();
  const step = { ...createBlankStep('s1'), name: 'Bake', duration: { ms: 3_600_000, kind: 'fixed' } };
  const recipe = { ...createBlankRecipe(), name: 'Bread', steps: [step] };
  const saved = await store.createRecipe(recipe);

  const exported = recipeToExportJSON(saved);
  ok('export carries a format tag', exported.format === 'temperatura/recipe');

  const { valid, recipe: imported } = recipeFromImportJSON(exported);
  ok('import round-trips a valid recipe', valid && imported.name === 'Bread' && imported.steps[0].name === 'Bake');

  const { valid: invalidValid, errors } = recipeFromImportJSON({ format: 'not-a-recipe' });
  ok('import rejects a file with the wrong format tag', invalidValid === false && errors.length > 0);

  const { valid: badValid } = recipeFromImportJSON(recipeToExportJSON({ ...createBlankRecipe(), name: '' }));
  ok('import rejects an invalid recipe payload', badValid === false);
}

console.log('\nInstances and the open set:');
{
  const store = mkStore();
  const recipe = await store.createRecipe({ ...createBlankRecipe(), name: 'Tofu' });
  await store.openRecipe(recipe.id);
  ok('openRecipe adds to the open set', (await store.listOpenRecipeIds()).includes(recipe.id));

  const instance = { id: 'inst-1', recipeId: recipe.id, stepId: 'step-1', status: 'running' };
  await store.createInstance(instance);
  ok('getInstance finds it', (await store.getInstance('inst-1')).status === 'running');
  ok('listInstancesForRecipe finds it by index', (await store.listInstancesForRecipe(recipe.id)).length === 1);

  await store.updateInstance({ ...instance, status: 'paused' });
  ok('updateInstance persists changes', (await store.getInstance('inst-1')).status === 'paused');

  await store.deleteInstance('inst-1');
  ok('deleteInstance removes it', (await store.getInstance('inst-1')) === undefined);
}

console.log('\nCascade: closing a recipe with running instances completes them:');
{
  const store = mkStore();
  const recipe = await store.createRecipe({ ...createBlankRecipe(), name: 'Ferment' });
  await store.openRecipe(recipe.id);
  await store.createInstance({ id: 'a', recipeId: recipe.id, stepId: 's1', status: 'running' });
  await store.createInstance({ id: 'b', recipeId: recipe.id, stepId: 's2', status: 'paused' });

  await store.closeRecipe(recipe.id, 5000);

  ok('closing completes a running instance', (await store.getInstance('a')).status === 'completed');
  ok('closing completes a paused instance too', (await store.getInstance('b')).status === 'completed');
  ok('completedAt is stamped with the close time', (await store.getInstance('a')).completedAt === 5000);
  ok('closing removes the recipe from the open set', !(await store.listOpenRecipeIds()).includes(recipe.id));
}

console.log('\nDeleting a recipe cascades to its instances and the open set:');
{
  const store = mkStore();
  const recipe = await store.createRecipe({ ...createBlankRecipe(), name: 'Doomed' });
  await store.openRecipe(recipe.id);
  await store.createInstance({ id: 'x', recipeId: recipe.id, stepId: 's1', status: 'running' });

  await store.deleteRecipe(recipe.id);

  ok('recipe is gone', (await store.getRecipe(recipe.id)) === undefined);
  ok('its instances are gone', (await store.getInstance('x')) === undefined);
  ok('it is removed from the open set', !(await store.listOpenRecipeIds()).includes(recipe.id));
}

console.log('\nAlarm themes and sounds:');
{
  const store = mkStore();
  const theme = await store.createAlarmTheme({ name: 'Default', rampSeconds: 0, vibrate: true, isDefault: true });
  ok('createAlarmTheme assigns an id', typeof theme.id === 'string');

  const buf = new Uint8Array([1, 2, 3, 4]).buffer;
  await store.saveSound(theme.id, buf);
  const readBack = new Uint8Array(await store.getSound(theme.id));
  ok('saveSound/getSound round-trips the ArrayBuffer', readBack.length === 4 && readBack[2] === 3);

  let threw = false;
  try { await store.deleteAlarmTheme(theme.id); } catch { threw = true; }
  ok('the default theme cannot be deleted', threw);

  const custom = await store.createAlarmTheme({ name: 'Bell', rampSeconds: 2, vibrate: false });
  await store.deleteAlarmTheme(custom.id);
  ok('a non-default theme can be deleted', (await store.getAlarmTheme(custom.id)) === undefined);
}

console.log('\nensureDefaultTheme — seeds the bundled synthesized theme exactly once:');
{
  const store = mkStore();
  const seeded = await store.ensureDefaultTheme();
  ok('seeds the well-known id', seeded.id === DEFAULT_THEME_ID);
  ok('seeds the fields that match engine.js\'s prior hardcoded playback', seeded.rampSeconds === 2 && seeded.vibrate === true);
  ok('seeds it as "Built-in"', seeded.name === 'Built-in');
  ok('seeds a repeat interval', seeded.repeatIntervalSeconds === 1);
  ok('seeds it as the default theme', seeded.isDefault === true);

  await store.updateAlarmTheme(DEFAULT_THEME_ID, { rampSeconds: 5 });
  const again = await store.ensureDefaultTheme();
  ok('a second call is idempotent — does not overwrite an edited default', again.rampSeconds === 5);
}

console.log('\nensureDefaultTheme migrates a pre-rename install without touching a customized field:');
{
  const store = mkStore();
  // Simulate an install seeded before "Built-in" and repeatIntervalSeconds
  // existed, matching what was actually deployed.
  await store.createAlarmTheme({ id: DEFAULT_THEME_ID, name: 'Default', rampSeconds: 2, vibrate: true, isDefault: true });
  const migrated = await store.ensureDefaultTheme();
  ok('renames a still-default name to "Built-in"', migrated.name === 'Built-in');
  ok('backfills the missing repeat interval', migrated.repeatIntervalSeconds === 1);

  const store2 = mkStore();
  await store2.createAlarmTheme({ id: DEFAULT_THEME_ID, name: 'My Bell', rampSeconds: 2, vibrate: true, isDefault: true });
  const untouched = await store2.ensureDefaultTheme();
  ok('never renames a name the user already customized', untouched.name === 'My Bell');
}

console.log('\nSettings:');
{
  const store = mkStore();
  ok('getSetting returns the fallback when unset', (await store.getSetting('claimHolderId', null)) === null);
  await store.setSetting('claimHolderId', 'inst-1');
  ok('setSetting/getSetting round-trips', (await store.getSetting('claimHolderId')) === 'inst-1');
}

console.log('\nBackup / restore (all data), including the sounds ArrayBuffer<->base64 round trip:');
{
  const store = mkStore();
  const recipe = await store.createRecipe({ ...createBlankRecipe(), name: 'Backed Up' });
  await store.openRecipe(recipe.id);
  await store.createInstance({ id: 'bk-1', recipeId: recipe.id, stepId: 's1', status: 'running' });
  const theme = await store.createAlarmTheme({ name: 'Chime', rampSeconds: 1, vibrate: true });
  await store.saveSound(theme.id, new Uint8Array([9, 8, 7]).buffer);

  const bundle = store.exportAll ? await store.exportAll() : null;
  ok('exportAll produces a tagged bundle', bundle.format === 'temperatura/backup');
  ok('exportAll base64-encodes sound data (JSON-safe)', typeof bundle.sounds[theme.id] === 'string');

  // Restore into a fresh, empty store.
  const fresh = mkStore();
  await fresh.importAll(bundle);
  ok('importAll restores recipes', (await fresh.getRecipe(recipe.id)).name === 'Backed Up');
  ok('importAll restores instances', (await fresh.getInstance('bk-1')).status === 'running');
  ok('importAll restores the open set', (await fresh.listOpenRecipeIds()).includes(recipe.id));
  const restoredSound = new Uint8Array(await fresh.getSound(theme.id));
  ok('importAll restores sound bytes exactly', restoredSound.length === 3 && restoredSound[0] === 9 && restoredSound[2] === 7);

  // Merge mode does not clobber existing data.
  await fresh.updateRecipe(recipe.id, { description: 'edited after restore' });
  await fresh.importAll(bundle, 'merge');
  ok('merge mode skips records that already exist', (await fresh.getRecipe(recipe.id)).description === 'edited after restore');

  let threw = false;
  try { await fresh.importAll({ format: 'not-a-backup' }); } catch { threw = true; }
  ok('importAll rejects a file with the wrong format tag', threw);
}

console.log('\nbuildStepAlarmDefs — bridges recipe.js\'s storage shape to alarms.js\'s evaluation shape:');
{
  const timeAlarm = { id: 't1', name: 'Stir', atMs: 60000, repeat: false, intervalMs: null, theme: null };
  const tempAlarm = { id: 'h1', name: 'Too hot', thresholdC: 80, direction: 'heating', theme: null };
  let step = { ...createBlankStep('s1'), timeAlarms: [timeAlarm], tempAlarms: [tempAlarm], duration: null, durationReachedAlarm: null };
  let defs = buildStepAlarmDefs(step);
  ok('time alarms are tagged kind: time', defs.find((d) => d.id === 't1').kind === 'time');
  ok('temp alarms are tagged kind: temperature', defs.find((d) => d.id === 'h1').kind === 'temperature');
  ok('no duration-reached entry when there is no duration', defs.length === 2);

  step = { ...step, duration: { ms: 1_800_000, kind: 'fixed' }, durationReachedAlarm: { enabled: true, theme: null } };
  defs = buildStepAlarmDefs(step);
  const durationDef = defs.find((d) => d.kind === 'duration');
  ok('a duration-reached entry is synthesized when enabled', !!durationDef);
  ok('it fires at the duration', durationDef.atMs === 1_800_000);
  ok('it is one-shot', durationDef.repeat === false);

  step = { ...step, durationReachedAlarm: { enabled: false, theme: null } };
  defs = buildStepAlarmDefs(step);
  ok('no duration-reached entry when disabled', !defs.some((d) => d.kind === 'duration'));

  step = { ...createBlankStep('s2'), tempBand: { lowC: 20, highC: 30 } };
  defs = buildStepAlarmDefs(step);
  ok('a band synthesizes exactly two extra alarms', defs.length === 2);
  const bandMin = defs.find((d) => d.id === 's2-band-min');
  const bandMax = defs.find((d) => d.id === 's2-band-max');
  ok('band-min is a cooling temperature alarm at the low edge', bandMin.kind === 'temperature' && bandMin.direction === 'cooling' && bandMin.thresholdC === 20);
  ok('band-max is a heating temperature alarm at the high edge', bandMax.kind === 'temperature' && bandMax.direction === 'heating' && bandMax.thresholdC === 30);

  step = { ...step, bandMinAlarm: { theme: 'bell' }, bandMaxAlarm: { theme: 'siren' } };
  defs = buildStepAlarmDefs(step);
  ok('band-min carries its own theme', defs.find((d) => d.id === 's2-band-min').theme === 'bell');
  ok('band-max carries its own theme', defs.find((d) => d.id === 's2-band-max').theme === 'siren');

  step = { ...createBlankStep('s3'), tempBand: null };
  defs = buildStepAlarmDefs(step);
  ok('no band alarms when there is no band', defs.length === 0);

  step = { ...createBlankStep('s4'), duration: { ms: 1_800_000, kind: 'fixed' }, durationReachedAlarm: { enabled: true, theme: null } };
  defs = buildStepAlarmDefs(step, { durationExtensionMs: 5 * 60_000 });
  ok('an extension is folded into the duration-reached alarm\'s atMs', defs.find((d) => d.kind === 'duration').atMs === 1_800_000 + 5 * 60_000);
  ok('durationAlarmId matches the id buildStepAlarmDefs actually uses', defs.find((d) => d.kind === 'duration').id === durationAlarmId('s4'));

  defs = buildStepAlarmDefs(step);
  ok('no extension option leaves the duration unaffected', defs.find((d) => d.kind === 'duration').atMs === 1_800_000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
