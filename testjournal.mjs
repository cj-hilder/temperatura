import { createAppController } from './src/lib/app.js';
import { MemoryBackend } from './src/lib/storage.js';
import { createBlankStep } from './src/lib/recipe.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

function setup() {
  let clock = 1_000_000;
  let n = 0;
  const backend = new MemoryBackend();
  const app = createAppController({ backend, now: () => clock, uuid: () => `id-${++n}` });
  return { app, backend, tick: (ms) => { clock += ms; }, mkApp: () => createAppController({ backend, now: () => clock }) };
}
const step = (id, name) => ({ ...createBlankStep(id), name });

console.log('\nrecordJournal — a dated snapshot with the multiplier and tallies:');
{
  const { app, tick } = setup();
  const recipe = await app.createRecipe({ name: 'Bread', description: 'v1', notes: [], servings: '1 loaf', ingredients: [{ name: 'Flour', quantity: '500', unit: 'g' }], steps: [step('s1', 'Mix')] });
  await app.setIngredientsMultiplier(recipe.id, 2);
  await app.startInstance({ id: 'i1', recipeId: recipe.id, stepId: 's1', stepAlarmDefs: [] });
  await app.completeInstance('i1'); // one tally on Mix
  const e1 = await app.recordJournal(recipe.id);
  ok('records the recipe, multiplier, tallies and time', e1.recipe.description === 'v1' && e1.multiplier === 2 && e1.completionTicks.s1 === 1 && e1.recordedAt === 1_000_000);
  ok('starts with empty notes', e1.notes === '');

  await app.updateRecipe(recipe.id, { description: 'v2', ingredients: [{ name: 'Flour', quantity: '600', unit: 'g' }] });
  ok('later edits do not reach back into the snapshot', (await app.getJournalEntry(e1.id)).recipe.description === 'v1'
    && (await app.getJournalEntry(e1.id)).recipe.ingredients[0].quantity === '500');

  tick(60_000);
  const e2 = await app.recordJournal(recipe.id);
  const list = await app.listJournal(recipe.id);
  ok('listed newest first', list.length === 2 && list[0].id === e2.id && list[1].id === e1.id);

  await app.setJournalNotes(e1.id, 'Yield was 950 g');
  ok('notes are saved against an entry', (await app.getJournalEntry(e1.id)).notes === 'Yield was 950 g');

  await app.deleteJournalEntry(e2.id);
  ok('an entry can be deleted', (await app.listJournal(recipe.id)).map((e) => e.id).join() === e1.id);
}

console.log('\nThe journal survives the app restarting, and each recipe has its own:');
{
  const { app, mkApp } = setup();
  const a = await app.createRecipe({ name: 'A', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const b = await app.createRecipe({ name: 'B', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app.recordJournal(a.id);
  await app.recordJournal(b.id);
  await app.recordJournal(b.id);
  const fresh = mkApp();
  ok('after a restart, each recipe lists only its own entries', (await fresh.listJournal(a.id)).length === 1 && (await fresh.listJournal(b.id)).length === 2);
}

console.log('\nrestoreJournalEntry — puts an earlier version back, recording the current one first:');
{
  const { app, tick } = setup();
  const recipe = await app.createRecipe({ name: 'Bread', description: 'v1', notes: ['old note'], servings: '', ingredients: [], steps: [step('s1', 'Mix')] });
  const v1 = await app.recordJournal(recipe.id);
  tick(1000);
  await app.updateRecipe(recipe.id, { name: 'Better bread', description: 'v2', steps: [step('s1', 'Mix'), step('s2', 'Fold')] });
  tick(1000);
  await app.restoreJournalEntry(v1.id);
  const restored = await app.getRecipe(recipe.id);
  ok('the recipe is back to the earlier version', restored.name === 'Bread' && restored.description === 'v1' && restored.steps.length === 1 && restored.notes[0] === 'old note');
  ok('…keeping its own id', restored.id === recipe.id);
  const list = await app.listJournal(recipe.id);
  ok('the replaced version was recorded first, so nothing is lost', list.length === 2 && list[0].recipe.description === 'v2' && /restoring/.test(list[0].notes));

  await app.startInstance({ id: 'run', recipeId: recipe.id, stepId: 's1', stepAlarmDefs: [] });
  let threw = null;
  try { await app.restoreJournalEntry(list[0].id); } catch (e) { threw = e.message; }
  ok('refused while a step is in progress', threw && /running steps/.test(threw));
  ok('…and nothing changed', (await app.getRecipe(recipe.id)).description === 'v1' && (await app.listJournal(recipe.id)).length === 2);
}

console.log('\nDeleting a recipe deletes its journal; backup and restore carry it:');
{
  const { app } = setup();
  const keep = await app.createRecipe({ name: 'Keep', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  const gone = await app.createRecipe({ name: 'Gone', description: '', notes: [], servings: '', ingredients: [], steps: [] });
  await app.recordJournal(keep.id);
  await app.recordJournal(gone.id);
  await app.deleteRecipe(gone.id);
  ok('the deleted recipe\'s journal is gone', (await app.listJournal(gone.id)).length === 0);
  ok('…the other recipe\'s is not', (await app.listJournal(keep.id)).length === 1);

  const bundle = await app.store.exportAll();
  ok('a backup includes the journal', bundle.journal.length === 1);
  const other = createAppController({ backend: new MemoryBackend(), now: () => 0 });
  await other.store.importAll(bundle);
  ok('…and restoring it brings the journal back', (await other.listJournal(keep.id)).length === 1);
  const oldBackup = { ...bundle };
  delete oldBackup.journal;
  await createAppController({ backend: new MemoryBackend(), now: () => 0 }).store.importAll(oldBackup);
  ok('a backup made before the journal existed still restores', true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
