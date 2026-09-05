import { parseQuantity, isValidQuantityString, scaleQuantity, formatQuantity } from './src/lib/quantity.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nparseQuantity:');
{
  ok('a plain decimal', JSON.stringify(parseQuantity('0.5')) === JSON.stringify({ kind: 'decimal', value: 0.5 }));
  ok('a whole number', JSON.stringify(parseQuantity('500')) === JSON.stringify({ kind: 'decimal', value: 500 }));
  ok('a simple fraction', JSON.stringify(parseQuantity('1/2')) === JSON.stringify({ kind: 'fraction', numerator: 1, denominator: 2 }));
  ok('a fraction with multi-digit parts', JSON.stringify(parseQuantity('12/16')) === JSON.stringify({ kind: 'fraction', numerator: 12, denominator: 16 }));
  ok('blank string is null (no quantity given)', parseQuantity('') === null);
  ok('whitespace-only is null', parseQuantity('   ') === null);
  ok('surrounding whitespace is trimmed', JSON.stringify(parseQuantity(' 1/2 ')) === JSON.stringify({ kind: 'fraction', numerator: 1, denominator: 2 }));
  ok('a fraction with a zero denominator is invalid', parseQuantity('1/0') === null);
  ok('free text is invalid', parseQuantity('to taste') === null);
  ok('a mixed number is invalid (not a supported shape)', parseQuantity('1 1/2') === null);
  ok('null input is null', parseQuantity(null) === null);
  ok('undefined input is null', parseQuantity(undefined) === null);
}

console.log('\nisValidQuantityString:');
{
  ok('blank is valid (no quantity given, e.g. "salt, to taste")', isValidQuantityString('') === true);
  ok('a decimal is valid', isValidQuantityString('0.5') === true);
  ok('a fraction is valid', isValidQuantityString('1/2') === true);
  ok('free text is invalid', isValidQuantityString('lots') === false);
  ok('a zero-denominator fraction is invalid', isValidQuantityString('1/0') === false);
}

console.log('\nscaleQuantity — a decimal input always displays as a decimal:');
{
  ok('0.5 x0.25 = 0.125', JSON.stringify(scaleQuantity(parseQuantity('0.5'), 0.25)) === JSON.stringify({ kind: 'decimal', value: 0.125 }));
  ok('500 x2 = 1000', JSON.stringify(scaleQuantity(parseQuantity('500'), 2)) === JSON.stringify({ kind: 'decimal', value: 1000 }));
}

console.log('\nscaleQuantity — a fraction input, the spec\'s own worked examples:');
{
  const r1 = scaleQuantity(parseQuantity('1/2'), 0.25);
  ok('1/2 x0.25 = 1/8 (stays a fraction — 8 is a nice kitchen denominator)', r1.kind === 'fraction' && r1.numerator === 1 && r1.denominator === 8);

  const r2 = scaleQuantity(parseQuantity('1/2'), 0.24);
  ok('1/2 x0.24 = 0.12 (falls to decimal — reduces to 3/25, not nice)', r2.kind === 'decimal' && Math.abs(r2.value - 0.12) < 1e-9);
}

console.log('\nparseQuantity/scaleQuantity — a bare integer is decimal; the same value written as n/1 is a fraction:');
{
  // The "/" is what signals fraction intent, not the numeric value — "2" and
  // "2/1" are numerically equal but must scale and display differently.
  ok('bare "2" parses as decimal', JSON.stringify(parseQuantity('2')) === JSON.stringify({ kind: 'decimal', value: 2 }));
  ok('"2/1" parses as a fraction', JSON.stringify(parseQuantity('2/1')) === JSON.stringify({ kind: 'fraction', numerator: 2, denominator: 1 }));

  const bareTwo = scaleQuantity(parseQuantity('2'), 0.25);
  ok('2 x0.25 = 0.5 (decimal)', bareTwo.kind === 'decimal' && bareTwo.value === 0.5);

  const twoOverOne = scaleQuantity(parseQuantity('2/1'), 0.25);
  ok('2/1 x0.25 = 1/2 (fraction)', twoOverOne.kind === 'fraction' && twoOverOne.numerator === 1 && twoOverOne.denominator === 2);

  const bareOne = scaleQuantity(parseQuantity('1'), 0.25);
  ok('1 x0.25 = 0.25 (decimal)', bareOne.kind === 'decimal' && bareOne.value === 0.25);

  const oneOverOne = scaleQuantity(parseQuantity('1/1'), 0.25);
  ok('1/1 x0.25 = 1/4 (fraction)', oneOverOne.kind === 'fraction' && oneOverOne.numerator === 1 && oneOverOne.denominator === 4);
}

console.log('\nscaleQuantity — the exact nice-denominator whitelist {2,3,4,8,16,32,64}:');
{
  for (const d of [2, 3, 4, 8, 16, 32, 64]) {
    const r = scaleQuantity({ kind: 'fraction', numerator: 1, denominator: d }, 1);
    ok(`denominator ${d} stays a fraction at x1 (identity scale)`, r.kind === 'fraction' && r.numerator === 1 && r.denominator === d);
  }
  // 5, 25, 64*... wait 64 is nice; use denominators NOT in the set, e.g. 5, 25, 7.
  for (const d of [5, 7, 25, 6, 12]) {
    const r = scaleQuantity({ kind: 'fraction', numerator: 1, denominator: d }, 1);
    ok(`denominator ${d} is not in the nice set, falls to decimal even at x1`, r.kind === 'decimal');
  }
}

console.log('\nscaleQuantity — a multiplier that produces a whole number:');
{
  const r = scaleQuantity(parseQuantity('1/2'), 2);
  // 1/2 x2 reduces to 1/1 (denominator 1) — not in the nice set, so this
  // falls to the decimal path, but the decimal VALUE is still the exact
  // right whole number.
  ok('1/2 x2 = 1 (as a decimal value, since denominator 1 is not in the nice set)', r.kind === 'decimal' && r.value === 1);
}

console.log('\nscaleQuantity — identity (x1) round-trips every fraction correctly:');
{
  const r = scaleQuantity(parseQuantity('3/4'), 1);
  ok('3/4 x1 = 3/4, unchanged', r.kind === 'fraction' && r.numerator === 3 && r.denominator === 4);
}

console.log('\nscaleQuantity — blank/unparseable input passes through as null:');
{
  ok('null parsed input scales to null', scaleQuantity(null, 2) === null);
}

console.log('\nformatQuantity:');
{
  ok('a fraction formats as n/d', formatQuantity({ kind: 'fraction', numerator: 1, denominator: 8 }) === '1/8');
  ok('a decimal formats without trailing zeros', formatQuantity({ kind: 'decimal', value: 0.125 }) === '0.125');
  ok('a whole-number decimal formats with no decimal point', formatQuantity({ kind: 'decimal', value: 1000 }) === '1000');
  ok('float noise is rounded away', formatQuantity({ kind: 'decimal', value: 0.1 + 0.2 }) === '0.3');
  ok('null formats as empty string', formatQuantity(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
