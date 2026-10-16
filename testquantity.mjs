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
  ok('a mixed number is one improper fraction: "1 1/2" is 3/2', JSON.stringify(parseQuantity('1 1/2')) === JSON.stringify({ kind: 'fraction', numerator: 3, denominator: 2 }));
  ok('a mixed number tolerates extra spaces between the parts', JSON.stringify(parseQuantity('2   3/4')) === JSON.stringify({ kind: 'fraction', numerator: 11, denominator: 4 }));
  ok('a mixed number with a zero denominator is invalid', parseQuantity('1 1/0') === null);
  ok('two whole numbers are not a mixed number', parseQuantity('1 2') === null);
  ok('a decimal whole part is not a mixed number', parseQuantity('1.5 1/2') === null);
  ok('null input is null', parseQuantity(null) === null);
  ok('undefined input is null', parseQuantity(undefined) === null);
}

console.log('\nisValidQuantityString:');
{
  ok('blank is valid (no quantity given, e.g. "salt, to taste")', isValidQuantityString('') === true);
  ok('a decimal is valid', isValidQuantityString('0.5') === true);
  ok('a fraction is valid', isValidQuantityString('1/2') === true);
  ok('a mixed number is valid', isValidQuantityString('1 1/2') === true);
  ok('free text is invalid', isValidQuantityString('lots') === false);
  ok('a zero-denominator fraction is invalid', isValidQuantityString('1/0') === false);
}

console.log('\nscaleQuantity — a decimal input always displays as a decimal:');
{
  ok('0.5 x0.25 = 0.125', JSON.stringify(scaleQuantity(parseQuantity('0.5'), 0.25)) === JSON.stringify({ kind: 'decimal', value: 0.125 }));
  ok('500 x2 = 1000', JSON.stringify(scaleQuantity(parseQuantity('500'), 2)) === JSON.stringify({ kind: 'decimal', value: 1000 }));
}

const show = (q, m) => formatQuantity(scaleQuantity(parseQuantity(q), m));

console.log('\nscaleQuantity — a fraction input, the spec\'s own worked examples:');
{
  ok('1 1/2 x2 = 3', show('1 1/2', 2) === '3');
  ok('1 1/2 x0.5 = 3/4', show('1 1/2', 0.5) === '3/4');
  ok('1 1/2 x0.3 = 29/64 (9/20 rounded to the nearest 64th)', show('1 1/2', 0.3) === '29/64');
  ok('1 1/2 x0.005 = 0.0075 (rounds to 0/64, so a decimal rather than hiding it)', show('1 1/2', 0.005) === '0.0075');
  ok('1/2 x0.25 = 1/8', show('1/2', 0.25) === '1/8');
  ok('1/2 x0.24 = 1/8 (3/25 rounded to the nearest 64th, 7.68/64 → 8/64)', show('1/2', 0.24) === '1/8');
}

console.log('\nscaleQuantity — measuring-set fractions (halves down to 64ths) are exact anyway:');
{
  for (const d of [2, 4, 8, 16, 32, 64]) {
    const r = scaleQuantity({ kind: 'fraction', numerator: 1, denominator: d }, 1);
    ok(`1/${d} stays exactly 1/${d}`, r.kind === 'fraction' && r.numerator === 1 && r.denominator === d);
  }
}

console.log('\nscaleQuantity — rounded to 64ths and to thirds; whichever is closer wins:');
{
  ok('1/3 x1 = 1/3, never 21/64', show('1/3', 1) === '1/3');
  ok('2/3 x0.5 = 1/3', show('2/3', 0.5) === '1/3');
  ok('1/3 x2 = 2/3', show('1/3', 2) === '2/3');
  ok('1 2/3 stays 1 2/3', show('1 2/3', 1) === '1 2/3');
  ok('1 1/3 x1.5 = 2', show('1 1/3', 1.5) === '2');
  ok('near a third: 1/2 x0.6667 (0.33335) = 1/3, closer than 21/64', show('1/2', 0.6667) === '1/3');
  ok('near a third: 1/2 x0.67 (0.335) = 1/3', show('1/2', 0.67) === '1/3');
  ok('nearer a 64th: 1/2 x0.68 (0.34) = 11/32 (22/64 is 0.0038 off, 1/3 is 0.0067 off)', show('1/2', 0.68) === '11/32');
  ok('a 64th that is exact always wins: 3/4 stays 3/4', show('3/4', 1) === '3/4');
  ok('1/6 (default) is nearer 11/64 than 1/3', show('1/6', 1) === '11/64');
}

console.log('\nscaleQuantity — with the "Sixths and twelfths" setting the second rounding is to twelfths:');
{
  const showS = (q, m) => formatQuantity(scaleQuantity(parseQuantity(q), m, { sixths: true }));
  ok('default: 1/12 rounds to 5/64 (5.33)', show('1/12', 1) === '5/64');
  ok('default: 1/3 x0.5 = 1/6 rounds to 11/64', show('1/3', 0.5) === '11/64');
  ok('setting on: 1/6 stays 1/6', showS('1/6', 1) === '1/6');
  ok('setting on: 1/12 stays 1/12', showS('1/12', 1) === '1/12');
  ok('setting on: 1/3 x0.5 = 1/6', showS('1/3', 0.5) === '1/6');
  ok('setting on: 2 1/6 stays 2 1/6', showS('2 1/6', 1) === '2 1/6');
  ok('setting on: thirds still come out as thirds (1/6 x2 = 1/3, simplified from 4/12)', showS('1/6', 2) === '1/3');
  ok('setting on: near a sixth: 1/2 x0.336 (0.168) = 1/6', showS('1/2', 0.336) === '1/6');
  ok('setting on: nearer a 64th: 1/2 x0.34 (0.17) = 11/64', showS('1/2', 0.34) === '11/64');
  ok('setting on: a ninth is nearer 7/64 than 1/12', showS('1/9', 1) === '7/64');
  ok('setting on: 1 1/2 x0.3 = 29/64 as before', showS('1 1/2', 0.3) === '29/64');
}

console.log('\nscaleQuantity — any other denominator rounds to the nearest 64th, simplified:');
{
  ok('1/5 = 13/64 (12.8/64)', show('1/5', 1) === '13/64');
  ok('1/7 = 9/64 (9.14/64)', show('1/7', 1) === '9/64');
  ok('3/10 = 19/64 (19.2/64)', show('3/10', 1) === '19/64');
  ok('a rounded result simplifies: 1/128 → 1/64; 33/128 → 17/64 (16.5 rounds up)', show('1/128', 1) === '1/64' && show('33/128', 1) === '17/64');
  ok('1/2 x0.26 = 1/8 (8.32/64 → 8/64 = 1/8)', show('1/2', 0.26) === '1/8');
}

console.log('\nscaleQuantity — whole-number results, and mixed numbers above 1:');
{
  ok('1/2 x2 = 1 (a fraction input that comes out whole shows the whole number)', show('1/2', 2) === '1');
  ok('1 1/2 x1.5 = 2 1/4', show('1 1/2', 1.5) === '2 1/4');
  ok('an improper fraction displays as a mixed number: 3/2 x1 = 1 1/2', show('3/2', 1) === '1 1/2');
  ok('a mixed number round-trips at x1', show('2 3/4', 1) === '2 3/4');
  ok('a rounded result above 1 is a mixed number: 1 1/5 x1 = 1 13/64', show('1 1/5', 1) === '1 13/64');
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
  ok('an improper fraction formats as a mixed number', formatQuantity({ kind: 'fraction', numerator: 9, denominator: 4 }) === '2 1/4');
  ok('a whole-number fraction formats as the whole number', formatQuantity({ kind: 'fraction', numerator: 6, denominator: 2 }) === '3');
  ok('a decimal formats without trailing zeros', formatQuantity({ kind: 'decimal', value: 0.125 }) === '0.125');
  ok('a whole-number decimal formats with no decimal point', formatQuantity({ kind: 'decimal', value: 1000 }) === '1000');
  ok('float noise is rounded away', formatQuantity({ kind: 'decimal', value: 0.1 + 0.2 }) === '0.3');
  ok('null formats as empty string', formatQuantity(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
