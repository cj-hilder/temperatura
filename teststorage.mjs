import { Store, MemoryBackend, STORES } from './src/lib/storage.js';
import { createBlankRecipe, createBlankStep, recipeToExportJSON, recipeFromImportJSON } from './src/lib/recipe.js';

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
  const theme = await store.createAlarmTheme({ name: 'Default', ramp: 0, vibrate: true, isDefault: true });
  ok('createAlarmTheme assigns an id', typeof theme.id === 'string');

  const buf = new Uint8Array([1, 2, 3, 4]).buffer;
  await store.saveSound(theme.id, buf);
  const readBack = new Uint8Array(await store.getSound(theme.id));
  ok('saveSound/getSound round-trips the ArrayBuffer', readBack.length === 4 && readBack[2] === 3);

  let threw = false;
  try { await store.deleteAlarmTheme(theme.id); } catch { threw = true; }
  ok('the default theme cannot be deleted', threw);

  const custom = await store.createAlarmTheme({ name: 'Bell', ramp: 2, vibrate: false });
  await store.deleteAlarmTheme(custom.id);
  ok('a non-default theme can be deleted', (await store.getAlarmTheme(custom.id)) === undefined);
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
  const theme = await store.createAlarmTheme({ name: 'Chime', ramp: 1, vibrate: true });
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
