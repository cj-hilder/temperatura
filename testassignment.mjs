import {
  probeOf, instanceUsing, freeProbeIds, autoAssignOnStart, assign, unassign,
  releaseOnComplete, forgetProbe, pruneAssignments, migrateClaim,
} from './src/lib/assignment.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nThe probe-assignment lifecycle from the spec:');
{
  let a = {};
  a = autoAssignOnStart(a, 'A', ['p1']);
  ok('starting an instance with exactly one free connected probe auto-assigns it', probeOf(a, 'A') === 'p1');

  a = autoAssignOnStart(a, 'B', freeProbeIds(['p1'], a));
  ok('a second instance gets nothing: the only probe is in use, and is never taken automatically', probeOf(a, 'B') === null && probeOf(a, 'A') === 'p1');

  a = releaseOnComplete(a, 'B');
  ok('completing an instance that used no probe changes nothing', same(a, { A: 'p1' }));

  a = releaseOnComplete(a, 'A');
  ok('completing the instance using a probe frees it', same(a, {}) && instanceUsing(a, 'p1') === null);
  ok('a freed probe is not handed on automatically — it stays unused until someone chooses it', same(a, {}));

  a = assign(a, 'B', 'p1');
  ok('choosing a free probe assigns it', probeOf(a, 'B') === 'p1' && instanceUsing(a, 'p1') === 'B');

  a = autoAssignOnStart(a, 'C', freeProbeIds(['p1'], a));
  ok('a later Start still does not steal it', probeOf(a, 'C') === null && probeOf(a, 'B') === 'p1');

  a = assign(a, 'C', 'p1');
  ok('a deliberate choice transfers it from the other instance', probeOf(a, 'C') === 'p1' && probeOf(a, 'B') === null);

  a = releaseOnComplete(a, 'B');
  ok('completing the instance that lost it does not affect the new holder', probeOf(a, 'C') === 'p1');
}

console.log('\nAuto-assignment only when it is unambiguous:');
{
  ok('no free connected probes: stays unassigned', same(autoAssignOnStart({}, 'A', []), {}));
  ok('two free connected probes: stays unassigned (the app will not guess)', same(autoAssignOnStart({}, 'A', ['p1', 'p2']), {}));
  ok('exactly one free: assigned', same(autoAssignOnStart({}, 'A', ['p2']), { A: 'p2' }));
  ok('an instance that already uses a probe keeps it', same(autoAssignOnStart({ A: 'p1' }, 'A', ['p2']), { A: 'p1' }));

  const a = { X: 'p1' };
  ok('"free" excludes probes in use and ignores probes that are not connected', same(freeProbeIds(['p1', 'p2'], a), ['p2']));
}

console.log('\nOne-to-one:');
{
  let a = assign({}, 'A', 'p1');
  a = assign(a, 'A', 'p2');
  ok('choosing another probe for an instance replaces its first', same(a, { A: 'p2' }));
  ok('so the first probe is now free', instanceUsing(a, 'p1') === null);

  a = assign({ A: 'p1', B: 'p2' }, 'B', 'p1');
  ok('two instances can never share a probe', same(a, { B: 'p1' }));

  const before = { A: 'p1' };
  assign(before, 'B', 'p2'); autoAssignOnStart(before, 'C', ['p3']); unassign(before, 'A'); forgetProbe(before, 'p1');
  ok('inputs are never mutated', same(before, { A: 'p1' }));
}

console.log('\nUnassign, forget, prune:');
{
  ok('unassign releases the probe', same(unassign({ A: 'p1', B: 'p2' }, 'A'), { B: 'p2' }));
  ok('unassigning an instance with no probe is a no-op', same(unassign({ B: 'p2' }, 'A'), { B: 'p2' }));
  ok('forgetting a probe releases whoever used it', same(forgetProbe({ A: 'p1', B: 'p2' }, 'p1'), { B: 'p2' }));
  ok('forgetting an unused probe is a no-op', same(forgetProbe({ B: 'p2' }, 'p9'), { B: 'p2' }));
  ok('prune drops assignments of completed/deleted instances (closing a recipe completes them wholesale)',
    same(pruneAssignments({ A: 'p1', B: 'p2' }, ['B']), { B: 'p2' }));
  const same1 = { A: 'p1' };
  ok('prune returns the same object when nothing changed', pruneAssignments(same1, ['A']) === same1);
}

console.log('\nMigrating the old single claim:');
{
  ok('exactly one known probe: the old holder maps onto it', same(migrateClaim('inst-1', ['p1']), { 'inst-1': 'p1' }));
  ok('several known probes: no way to know which, so dropped', same(migrateClaim('inst-1', ['p1', 'p2']), {}));
  ok('no known probes: dropped', same(migrateClaim('inst-1', []), {}));
  ok('no old claim: nothing to migrate', same(migrateClaim(null, ['p1']), {}));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
