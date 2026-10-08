import { createSpikeFilter, SPIKE_THRESHOLD_C, HOLD_TIMEOUT_MS } from './src/lib/probes/spikeFilter.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
// Feeds readings one second apart, returns what was displayed for each.
const run = (readings, f = createSpikeFilter()) => readings.map((r, i) => f.push(r, i * 1000));

console.log('\nFirst reading and light smoothing:');
{
  const f = createSpikeFilter();
  ok('the first reading is shown as-is (nothing to average with)', f.push(20, 0) === 20);
  ok('the next is averaged with the last one used: (20 + 21) / 2', near(f.push(21, 1000), 20.5));
  ok('and the average is against the last RAW value, not the last display: (21 + 21) / 2', near(f.push(21, 2000), 21));
  const steady = run([20, 20, 20, 20]);
  ok('a steady temperature displays steady', steady.every((v) => v === 20));
  ok('a gentle change is smoothed but only by half a step: 20 → 20.3 shows 20.15', near(run([20, 20.3])[1], 20.15));
}

console.log('\nA single dip is held, then recovery:');
{
  // Real shape from the logs: 17.7, 16.1 (dip), 17.7.
  const out = run([17.7, 17.7, 16.1, 17.7, 17.7]);
  ok('the dip is held at the previous value (17.7), not shown as 16.1', out[2] === 17.7);
  ok('the reading after the dip is back to normal, with no lingering low bias', near(out[3], 17.7) && near(out[4], 17.7));
  ok('the dip never appears in the display at all', out.every((v) => v > 17));

  const f = createSpikeFilter();
  run([20, 20, 18.4], f);
  ok('recovery averages against the last GOOD value, not the dip: (20 + 20.2) / 2', near(f.push(20.2, 3000), 20.1));
}

console.log('\nNever two low readings in a row — a genuine sustained drop gets through:');
{
  const out = run([20, 20, 18.4, 18.4, 18.4]);
  ok('first low reading held at 20', out[2] === 20);
  ok('second low reading is NOT suspected: shown averaged with the last good value (20 + 18.4) / 2', near(out[3], 19.2));
  ok('and then settles on the new level', near(out[4], 18.4));

  const falling = run([20, 20, 18.4, 17.0]);
  ok('a second, even bigger drop straight after a held dip passes (not held twice)', near(falling[3], (20 + 17.0) / 2));
}

console.log('\nThreshold is strictly greater-than, with margin either side:');
{
  ok('a drop just under the threshold is a genuine reading (smoothed, not held)',
    near(run([20, 20, 20 - (SPIKE_THRESHOLD_C - 0.01)])[2], (20 + 20 - (SPIKE_THRESHOLD_C - 0.01)) / 2));
  ok('a drop just over the threshold is held', run([20, 20, 20 - (SPIKE_THRESHOLD_C + 0.01)])[2] === 20);
  ok('ordinary reading-to-reading wobble (0.3) is never held', near(run([20, 20, 19.7])[2], (20 + 19.7) / 2));
  ok('a rise of any size is never held', near(run([20, 20, 25])[2], 22.5));
  ok('the dips in the logs (1.6) are comfortably over the threshold', 1.6 > SPIKE_THRESHOLD_C + 0.5);
}

console.log('\nNotify-on-change: a held reading nothing contradicts is accepted after the timeout:');
{
  const f = createSpikeFilter();
  f.push(20, 0); f.push(20, 1000);
  ok('dip arrives and is held', f.push(18.4, 2000) === 20);
  ok('still held just inside the timeout', f.current(2000 + HOLD_TIMEOUT_MS) === 20);
  ok('accepted as real just past it — no follow-up reading will ever come for a steady genuine drop', f.current(2000 + HOLD_TIMEOUT_MS + 1) === 18.4);
  ok('and stays accepted', f.current(60_000) === 18.4);
  ok('a later reading is averaged against the accepted value, not the old one', near(f.push(18.6, 61_000), 18.5));

  const g = createSpikeFilter();
  g.push(20, 0); g.push(20, 1000); g.push(18.4, 2000);
  ok('a correction arriving in time (the ~1.6 s seen in the logs) beats the timeout', near(g.push(20, 3600), 20));
  ok('and nothing is left held afterwards', g.current(60_000) === 20);

  ok('polling with nothing held changes nothing', createSpikeFilter().current(99_999) === null);
}

console.log('\nReset (a reconnect is a gap in the stream):');
{
  const f = createSpikeFilter();
  f.push(20, 0); f.push(20, 1000); f.push(18.4, 2000); // holding
  f.reset();
  ok('reset forgets what was shown', f.current(2500) === null);
  ok('the first reading afterwards is taken as-is, even though it is 1.6 below the old one', f.push(18.4, 9000) === 18.4);
  ok('and nothing stale is promoted later', f.current(99_000) === 18.4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
