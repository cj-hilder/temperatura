import { isSoundTooLong, MAX_SOUND_SECONDS, DEFAULT_SILENCE_AFTER_SECONDS, resolvePlaybackParams } from './src/lib/alarmPlayer.js';

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

console.log('\nresolvePlaybackParams — a theme\'s playback fields, with the default theme\'s own fallbacks:');
{
  const r = resolvePlaybackParams({ rampSeconds: 4, vibrate: false, repeatIntervalSeconds: 3, silenceAfterSeconds: 30 });
  ok('a real theme\'s fields pass through', r.rampSeconds === 4 && r.vibrate === false && r.repeatIntervalSeconds === 3);
  ok('silenceAfterMs converts the theme\'s seconds field to ms', r.silenceAfterMs === 30_000);

  const missing = resolvePlaybackParams(null);
  ok('a missing theme (deleted out from under an alarm) falls back to rampSeconds 2', missing.rampSeconds === 2);
  ok('a missing theme falls back to vibrate true', missing.vibrate === true);
  ok('a missing theme falls back to repeatIntervalSeconds 0 (back to back)', missing.repeatIntervalSeconds === 0);
  ok('a missing theme falls back to the default silence-after', missing.silenceAfterMs === DEFAULT_SILENCE_AFTER_SECONDS * 1000);
  ok('the default silence-after is 2 minutes, per spec', DEFAULT_SILENCE_AFTER_SECONDS === 120);

  const partial = resolvePlaybackParams({ rampSeconds: 3 });
  ok('a theme missing vibrate falls back just for that field', partial.rampSeconds === 3 && partial.vibrate === true);
  ok('a theme missing repeatIntervalSeconds falls back just for that field', partial.repeatIntervalSeconds === 0);
  ok('a theme missing silenceAfterSeconds falls back just for that field', partial.silenceAfterMs === DEFAULT_SILENCE_AFTER_SECONDS * 1000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
