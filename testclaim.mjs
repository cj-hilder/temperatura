import { acquireClaimOnStart, releaseClaimOnComplete, toggleClaim } from './src/lib/instances.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

console.log('\nThe claim lifecycle table from the spec:');
{
  let claim = null;

  claim = acquireClaimOnStart(claim, 'A');
  ok('starting the first instance auto-acquires the claim', claim === 'A');

  claim = acquireClaimOnStart(claim, 'B');
  ok('a new instance never takes the claim away from a holding instance', claim === 'A');

  claim = releaseClaimOnComplete(claim, 'B');
  ok('completing a non-holder instance leaves the claim alone', claim === 'A');

  claim = releaseClaimOnComplete(claim, 'A');
  ok('the holder completing releases the claim to unclaimed', claim === null);

  ok('an unclaimed thermometer stays unclaimed until a deliberate tap', claim === null);

  claim = toggleClaim(claim, 'B');
  ok('tapping the icon on an unclaimed instance claims it', claim === 'B');

  claim = toggleClaim(claim, 'B');
  ok('tapping the icon on the current holder releases it (toggle off)', claim === null);

  claim = toggleClaim(claim, 'B');
  ok('tapping again re-claims it', claim === 'B');

  claim = acquireClaimOnStart(claim, 'C');
  ok('starting a third instance still does not steal the claim automatically', claim === 'B');

  claim = toggleClaim(claim, 'C');
  ok('a deliberate tap transfers the claim even from another holder', claim === 'C');

  claim = releaseClaimOnComplete(claim, 'B');
  ok('completing B (no longer the holder) does not affect C\'s claim', claim === 'C');

  claim = releaseClaimOnComplete(claim, 'C');
  ok('C completing (the holder) releases the claim', claim === null);
}

console.log('\nToggle is symmetric regardless of history:');
{
  ok('toggle on an already-unclaimed thermometer claims it', toggleClaim(null, 'X') === 'X');
  ok('toggle on the holder itself releases it', toggleClaim('X', 'X') === null);
  ok('toggle on someone else\'s claim transfers it unconditionally', toggleClaim('X', 'Y') === 'Y');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
