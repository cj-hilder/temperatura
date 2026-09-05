import { buildRecipePrintHtml } from './src/recipePrint.js';
import { createBlankRecipe, createBlankStep } from './src/lib/recipe.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nbuildRecipePrintHtml — a full recipe:');
{
  const recipe = {
    ...createBlankRecipe('r1'),
    name: 'Sourdough Loaf',
    description: 'A basic country loaf.',
    servings: '1 loaf',
    notes: ['Feed the starter the night before.'],
    ingredients: [
      { name: 'Flour', quantity: '500', unit: 'g' },
      { name: 'Water', quantity: '350', unit: 'g' },
    ],
    steps: [
      {
        ...createBlankStep('s1'),
        name: 'Bulk rise',
        description: 'Let it double.',
        duration: { ms: 4 * 3_600_000, kind: 'inBand' },
        tempBand: { lowC: 24, highC: 28 },
        durationReachedAlarm: { enabled: true, theme: null },
      },
    ],
  };

  const html = buildRecipePrintHtml(recipe);
  ok('is a full HTML document', html.startsWith('<!doctype html>'));
  ok('includes the recipe name as the title', html.includes('<title>Sourdough Loaf</title>'));
  ok('includes the recipe name as a heading', html.includes('<h1>Sourdough Loaf</h1>'));
  ok('includes the description', html.includes('A basic country loaf.'));
  ok('includes servings', html.includes('Servings: 1 loaf'));
  ok('includes notes', html.includes('Feed the starter the night before.'));
  ok('includes every ingredient', html.includes('Flour') && html.includes('500 g') && html.includes('Water') && html.includes('350 g'));
  ok('includes the step name, numbered', html.includes('1. Bulk rise'));
  ok('includes the step description', html.includes('Let it double.'));
  ok('includes the duration/band summary', html.includes('In temperature band duration') && html.includes('24') && html.includes('28'));
  ok('includes the implicit band-edge alarm lines', html.includes('Below band') && html.includes('Above band'));
  ok('includes the duration-reached alarm line', html.includes('Duration reached'));
}

console.log('\nbuildRecipePrintHtml — applies the ingredients multiplier, matching the Recipe page:');
{
  const recipe = {
    ...createBlankRecipe('r4'),
    name: 'Scaled',
    ingredients: [
      { name: 'Flour', quantity: '1/2', unit: 'cup' },
      { name: 'Water', quantity: '0.5', unit: 'cup' },
      { name: 'Salt', quantity: '', unit: 'to taste' },
    ],
    steps: [],
  };
  const unscaled = buildRecipePrintHtml(recipe);
  ok('defaults to unscaled (x1)', unscaled.includes('1/2 cup') && unscaled.includes('0.5 cup'));

  const scaled = buildRecipePrintHtml(recipe, 0.25);
  ok('fraction quantity scales fractionally (1/2 x0.25 = 1/8)', scaled.includes('1/8 cup'));
  ok('decimal quantity scales as a decimal (0.5 x0.25 = 0.125)', scaled.includes('0.125 cup'));
  ok('a blank quantity is left blank, not "undefined" or NaN', scaled.includes('to taste') && !scaled.includes('undefined') && !scaled.includes('NaN'));
}

console.log('\nbuildRecipePrintHtml — escapes user text so it cannot break the document:');
{
  const recipe = {
    ...createBlankRecipe('r2'),
    name: '<script>alert(1)</script>',
    description: 'A & B "quoted"',
    ingredients: [{ name: "Bob's <special>", quantity: '1', unit: 'cup' }],
    steps: [],
  };
  const html = buildRecipePrintHtml(recipe);
  ok('recipe name is escaped, not executable', !html.includes('<script>alert(1)</script>'));
  ok('escaped name appears as text', html.includes('&lt;script&gt;'));
  ok('ampersand and quotes are escaped', html.includes('A &amp; B &quot;quoted&quot;'));
  ok('ingredient name is escaped', html.includes('Bob&#39;s &lt;special&gt;'));
}

console.log('\nbuildRecipePrintHtml — empty recipe renders placeholders, not crashes:');
{
  const recipe = createBlankRecipe('r3');
  recipe.name = 'Blank';
  const html = buildRecipePrintHtml(recipe);
  ok('no ingredients placeholder', html.includes('No ingredients listed.'));
  ok('no steps placeholder', html.includes('No steps.'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
