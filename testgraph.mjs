import { recordTick, graphView, emptyHistory, BUCKET_MS, MAX_POINTS } from './src/lib/graphHistory.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

const START = 1_000_000;
// One tick per second; `temp` null = no data that tick.
function run(temps, { readingsPerTick = null, history = null, startedAt = START, t0 = START } = {}) {
  let h = history;
  let n = 0;
  temps.forEach((temp, i) => {
    const now = t0 + (i + 1) * 1000;
    const readings = readingsPerTick ? readingsPerTick(i).map((tempC) => ({ n: ++n, tempC })) : temp == null ? [] : [{ n: ++n, tempC: temp }];
    h = recordTick(h, { startedAt, measured: temp != null, tempC: temp, readings, now });
  });
  return h;
}

console.log('\nrecordTick — 10 s buckets, each keeping the lowest and highest reading:');
{
  // Buckets follow the clock in 10 s steps: ticks at +1 s … +9 s fall in one,
  // +10 s and +11 s in the next.
  const h = run([20, 21, 19.5, 22, 20, 20, 20, 20, 20, 23, 25]);
  ok('ticks within one 10 s bucket share a point', h.points.length === 2, JSON.stringify(h.points));
  ok('the bucket holds its lowest and highest reading', h.points[0].lo === 19.5 && h.points[0].hi === 22);
  ok('the next bucket starts a new point with its own range', h.points[1].lo === 23 && h.points[1].hi === 25);
}

console.log('\nrecordTick — readings between ticks still count (a one-reading spike is kept):');
{
  // Two readings per tick; the tick itself always sees 20, but one reading in between was 31.
  const h = run([20, 20, 20], { readingsPerTick: (i) => (i === 1 ? [31, 20] : [20, 20]) });
  ok('the spike between ticks reaches the bucket\'s hi', h.points[0].hi === 31 && h.points[0].lo === 20);
}

console.log('\nrecordTick — no data is a gap, not a guess:');
{
  const h = run([20, 20, null, null, null, 21]);
  const kinds = h.points.map((p) => (p.gap ? 'gap' : 'pt'));
  ok('one gap marker for a stretch with no data, then the line resumes', kinds.join(',') === 'pt,gap,pt', kinds.join(','));
  const fresh = run([null, null]);
  ok('a run that starts with no data has nothing to break: no points at all', fresh.points.length === 0);
}

console.log('\nrecordTick — a Restart (new startedAt) starts a fresh graph:');
{
  const h = run([20, 21, 22]);
  const after = recordTick(h, { startedAt: START + 50_000, measured: true, tempC: 30, readings: [{ n: 99, tempC: 30 }], now: START + 60_000 });
  ok('old points dropped, new run begins', after.points.length === 1 && after.points[0].lo === 30 && after.startedAt === START + 50_000);
}

console.log('\nrecordTick — a different probe (counter went backwards) does not freeze the graph:');
{
  let h = recordTick(null, { startedAt: START, measured: true, tempC: 20, readings: [{ n: 500, tempC: 20 }], now: START + 1000 });
  h = recordTick(h, { startedAt: START, measured: true, tempC: 40, readings: [{ n: 3, tempC: 40 }], now: START + 2000 });
  ok('the new probe\'s reading is recorded', h.points[0].hi === 40 && h.lastN === 3);
}

console.log('\nrecordTick — the cap: the oldest half merges two into one, keeping lo and hi:');
{
  const cap = 10;
  let h = emptyHistory(START);
  for (let i = 0; i < 11; i++) {
    const temp = i === 1 ? 99 : i === 2 ? -5 : 20 + i * 0.1;
    h = recordTick(h, { startedAt: START, measured: true, tempC: temp, readings: [], now: START + i * BUCKET_MS }, { maxPoints: cap });
  }
  ok('back under the cap', h.points.length <= cap, `${h.points.length}`);
  ok('a spike and a dip in the merged (oldest) part are both kept', h.points.some((p) => p.hi === 99) && h.points.some((p) => p.lo === -5));
  ok('recent points are untouched (still one per bucket)', h.points[h.points.length - 1].lo === 21 && h.points[h.points.length - 1].hi === 21);
  ok('points stay in time order', h.points.every((p, i, a) => i === 0 || a[i - 1].t < p.t));

  // A month of 10 s buckets never grows past the default cap.
  let big = emptyHistory(START);
  for (let i = 0; i < 30 * 8640; i += 1) big = recordTick(big, { startedAt: START, measured: true, tempC: 20 + (i % 7), readings: [], now: START + i * BUCKET_MS });
  ok(`a month of readings stays within ${MAX_POINTS} points`, big.points.length <= MAX_POINTS, `${big.points.length}`);
  ok('…and still spans the whole month', big.points[0].t === START && big.points[big.points.length - 1].t === START + (30 * 8640 - 1) * BUCKET_MS);
}

console.log('\ngraphView — runs split at gaps, the window, and a range that includes the band and thresholds:');
{
  const h = run([20, 20, null, 21]);
  const v = graphView(h, { from: START, to: START + 100_000 }, [24, 28]);
  ok('two runs either side of the gap', v.runs.length === 2);
  ok('the range covers readings and marks, with padding', v.yMin < 20 && v.yMax > 28);
  const windowed = graphView(h, { from: START + 3500, to: START + 100_000 });
  ok('points outside the window are left out', windowed.runs.flat().length === 1);
  const flat = graphView(run([20, 20]), { from: START, to: START + 10_000 });
  ok('a dead-steady reading still gets a non-zero range', flat.yMax > flat.yMin);
  ok('no data at all: a default range, no runs', graphView(null, { from: 0, to: 1 }).runs.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
