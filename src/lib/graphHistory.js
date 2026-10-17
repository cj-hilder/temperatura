// The temperature–time history behind a running instance's graph. Pure — the
// caller (engine.js) feeds it once per tick and stores the result; no clock,
// no BLE, no storage in here.
//
// Shape: { startedAt, lastN, points: [{ t, lo, hi } | { t, gap: true }] }.
// Each point is one BUCKET of time, holding the lowest and highest reading
// seen in it, not one reading: a step can run for months, and a reading every
// second would be millions of points. Buckets start at BUCKET_MS (10 s) — so
// a killed app loses at most that much — and the live end still moves every
// tick because the newest bucket keeps widening its lo/hi as readings arrive.
//
// Keeping lo AND hi rather than an average is the point of the whole shape: a
// spike or dip that set off an alarm must still be visible after its bucket
// has been merged with its neighbours, possibly many times over.
export const BUCKET_MS = 10_000;
export const MAX_POINTS = 2000;

export function emptyHistory(startedAt) {
  return { startedAt, lastN: null, points: [] };
}

/**
 * One tick's worth of data for one instance.
 * @param {object|null} history - as last returned (or loaded); null = none yet
 * @param {object} p
 * @param {number} p.startedAt - the instance's startedAt: a different value
 *   means the step was restarted, and a restarted run starts a fresh graph
 * @param {boolean} p.measured - live data is coming in for this instance
 * @param {number|null} p.tempC - the current (filtered) reading
 * @param {Array<{n:number,tempC:number}>} [p.readings] - the probe's recent
 *   numbered readings (probes/manager.js), so readings between ticks still
 *   count towards the bucket's lo/hi — the same list alarms.js walks
 * @param {number} p.now
 */
export function recordTick(history, { startedAt, measured, tempC, readings = [], now }, { bucketMs = BUCKET_MS, maxPoints = MAX_POINTS } = {}) {
  let h = history && history.startedAt === startedAt ? history : emptyHistory(startedAt);
  const points = h.points.slice();
  const last = points[points.length - 1];

  if (!measured || tempC == null) {
    // One gap marker per stretch with no data — the line breaks there rather
    // than drawing a straight line across time nobody observed. The reading
    // bookmark is dropped too: readings that arrive during the gap belong to
    // nobody's graph.
    if (last && !last.gap) points.push({ t: now, gap: true });
    return capped({ ...h, lastN: null, points }, maxPoints);
  }

  // A counter that went backwards means a different probe now: take only
  // its latest reading, as alarms.js does.
  const latest = readings[readings.length - 1];
  const unseen = !latest ? [] : h.lastN == null || latest.n < h.lastN ? [latest] : readings.filter((r) => r.n > h.lastN);
  const values = [tempC, ...unseen.map((r) => r.tempC)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);

  if (last && !last.gap && Math.floor(last.t / bucketMs) === Math.floor(now / bucketMs)) {
    points[points.length - 1] = { t: last.t, lo: Math.min(last.lo, lo), hi: Math.max(last.hi, hi) };
  } else {
    points.push({ t: now, lo, hi });
  }
  return capped({ ...h, lastN: latest ? latest.n : h.lastN, points }, maxPoints);
}

// Over the cap, the OLDEST half is merged two into one, so resolution is
// given up where it matters least: repeated over a long run, the far past
// gets progressively coarser while recent hours stay detailed.
function capped(h, maxPoints) {
  if (h.points.length <= maxPoints) return h;
  const half = Math.floor(h.points.length / 2) & ~1; // an even number of points to pair up
  const merged = [];
  for (let i = 0; i < half; i += 2) merged.push(mergePair(h.points[i], h.points[i + 1]));
  return { ...h, points: [...merged, ...h.points.slice(half)] };
}

function mergePair(a, b) {
  if (a.gap && b.gap) return a;
  // Half a gap and half a reading reads as the reading: at this resolution a
  // short gap isn't worth a break in the line.
  if (a.gap) return { t: a.t, lo: b.lo, hi: b.hi };
  if (b.gap) return a;
  return { t: a.t, lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
}

/**
 * Has this run ever had a real reading? The step page only shows the graph
 * once it has — a step used purely as a timer would otherwise carry an
 * empty graph for its whole life. Once shown it stays, even if the data
 * later stops: the gap is part of what the graph has to say.
 */
export function hasTemperatureData(history) {
  return !!history?.points.some((p) => !p.gap);
}

/**
 * What to draw: the points inside the window, split into runs at gaps, and
 * the vertical range to fit — readings plus band and alarm thresholds, so
 * the lines the readings are approaching are always on screen.
 * @param {object} history
 * @param {{from:number, to:number}} window - epoch ms
 * @param {number[]} [marks] - band edges and alarm thresholds, °C
 */
export function graphView(history, { from, to }, marks = []) {
  const runs = [];
  let run = [];
  for (const p of history?.points ?? []) {
    if (p.t < from || p.t > to) continue;
    if (p.gap) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length) runs.push(run);
  const values = [...runs.flat().flatMap((p) => [p.lo, p.hi]), ...marks];
  if (values.length === 0) return { runs, yMin: 0, yMax: 100 };
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  // Breathing room, and never a zero-height range (a dead-steady reading
  // would otherwise divide by zero when scaled).
  const pad = Math.max(1, (yMax - yMin) * 0.08);
  return { runs, yMin: yMin - pad, yMax: yMax + pad };
}
