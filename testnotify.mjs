import { dueNags, createNotifyRouter, NAG_INTERVAL_MS } from './src/lib/notify.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };
const ids = (alarms) => alarms.map((a) => a.id);

console.log('\ndueNags — pure nag-cadence core:');
{
  const a = { id: 'a' };
  let { due, lastNagAt } = dueNags([a], {}, 0);
  ok('a newly-sounding alarm (no prior timestamp) is due immediately', ids(due).includes('a'));

  ({ due, lastNagAt } = dueNags([a], lastNagAt, 1000));
  ok('not due again before the interval elapses', due.length === 0);

  ({ due, lastNagAt } = dueNags([a], lastNagAt, NAG_INTERVAL_MS));
  ok('due again once the interval elapses', ids(due).includes('a'));

  ({ due, lastNagAt } = dueNags([a], lastNagAt, NAG_INTERVAL_MS + 4999));
  ok('still not due one ms short of the next interval', due.length === 0);
  ({ due } = dueNags([a], lastNagAt, NAG_INTERVAL_MS + 5000));
  ok('due exactly at the next interval boundary', ids(due).includes('a'));
}

console.log('\nMultiple alarms are tracked independently:');
{
  const a = { id: 'a' };
  const b = { id: 'b' };
  let { due, lastNagAt } = dueNags([a], {}, 0); // only a sounding
  ok('only a is due while only a sounds', ids(due).length === 1 && ids(due)[0] === 'a');

  ({ due, lastNagAt } = dueNags([a, b], lastNagAt, 1000)); // b joins later
  ok('b (new) is immediately due even though a is mid-interval', ids(due).length === 1 && ids(due)[0] === 'b');

  ({ due, lastNagAt } = dueNags([a, b], lastNagAt, NAG_INTERVAL_MS));
  ok('a is due on its own schedule once its interval elapses, b is not yet', ids(due).length === 1 && ids(due)[0] === 'a');
}

console.log('\nAn alarm that stops sounding and returns later nags immediately, not on a stale schedule:');
{
  const a = { id: 'a' };
  let { lastNagAt } = dueNags([a], {}, 0);
  lastNagAt = dueNags([a], lastNagAt, 1000).lastNagAt; // still sounding, not due
  // a stops sounding — its bookkeeping should drop.
  const stopped = dueNags([], lastNagAt, 2000);
  ok('bookkeeping is dropped once an alarm stops sounding', stopped.lastNagAt.a === undefined);
  // a sounds again shortly after (e.g. a heating alarm re-crossing) — must nag right away.
  const { due } = dueNags([a], stopped.lastNagAt, 2500);
  ok('re-sounding shortly after nags immediately, ignoring the old timestamp', ids(due).includes('a'));
}

console.log('\ncreateNotifyRouter.tick() — routes by visibility, one shared ticker:');
{
  let vibrated = [];
  let posted = [];
  let visible = true;
  const router = createNotifyRouter({
    vibrate: (pattern) => vibrated.push(pattern),
    postToSW: (alarm) => posted.push(alarm),
    visibilityState: () => (visible ? 'visible' : 'hidden'),
  });

  const alarm = { id: 'x', title: 'T', body: 'B', vibrate: [300, 100, 300] };
  router.tick([alarm], 0);
  ok('visible: vibrates directly', vibrated.length === 1 && posted.length === 0);

  visible = false;
  router.tick([alarm], NAG_INTERVAL_MS);
  ok('hidden: posts to the SW instead', posted.length === 1 && posted[0].id === 'x' && vibrated.length === 1);

  router.tick([alarm], NAG_INTERVAL_MS + 1000);
  ok('not due yet: neither route fires again', vibrated.length === 1 && posted.length === 1);

  router.stop();
  router.tick([alarm], NAG_INTERVAL_MS + 2000);
  ok('stop() resets bookkeeping, so the same alarm nags immediately again', posted.length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
