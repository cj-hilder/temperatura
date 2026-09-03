import { isSoundTooLong, MAX_SOUND_SECONDS } from './src/lib/alarmPlayer.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nisSoundTooLong — the pure half of "5 second maximum, rejected at pick time":');
{
  ok('a 3 second sound is fine', isSoundTooLong(3) === false);
  ok('exactly 5 seconds is fine (the limit, not the exclusion)', isSoundTooLong(5) === false);
  ok('over 5 seconds is rejected', isSoundTooLong(5.1) === true);
  ok('a much longer sound is rejected', isSoundTooLong(60) === true);
  ok('a custom max is honoured', isSoundTooLong(3, 2) === true);
  ok('MAX_SOUND_SECONDS matches the spec value', MAX_SOUND_SECONDS === 5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
