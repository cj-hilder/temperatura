import {
  initAlarmState,
  reArmOnRestart,
  evaluateAlarms,
  silenceEarliest,
  DATA_LOSS_ALARM_ID,
  DATA_LOSS_TIMEOUT_MS,
} from './src/lib/alarms.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

// Common baseline args for evaluateAlarms — tests override just what they need.
function baseArgs(overrides = {}) {
  return {
    stepAlarmDefs: [],
    hasTempInterest: false,
    alarmState: {},
    elapsedRunningMs: 0,
    isRunning: true,
    claimed: true,
    msSinceLastPacket: 0,
    measured: true,
    tempC: null,
    now: 0,
    ...overrides,
  };
}

console.log('\nDeadband: jitter across a threshold fires once, re-arms only at T-2:');
{
  const def = { id: 'heat1', kind: 'temperature', name: 'Heat', thresholdC: 60, direction: 'heating', theme: null };
  let state = initAlarmState([def]);
  let now = 0;
  const step = (tempC) => {
    now += 1000;
    const r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC, now }));
    state = r.alarmState;
    return r;
  };

  step(58); // baseline, below threshold — establishes lastAboveThreshold=false, no fire
  let r = step(61); // crosses up — fires
  ok('fires on upward crossing', r.newlyFired.some(f => f.id === 'heat1'), JSON.stringify(r.newlyFired));

  // Jitter around the threshold without dropping below T-2 (58) — must not re-fire.
  r = step(59.9);
  r = step(60.5);
  r = step(59.5);
  r = step(60.8);
  ok('jitter across threshold does not re-fire (deadband holds)', r.newlyFired.length === 0, JSON.stringify(r.newlyFired));

  // Still above T-2 — re-arm must not have happened yet.
  r = step(58.5);
  ok('reading above T-2 does not re-arm', state.heat1.armed === false);

  // Drop below T-2 (58) to re-arm, then cross up again — should fire again.
  r = step(57.9);
  ok('drop below T-2 re-arms', state.heat1.armed === true);
  r = step(61);
  ok('re-armed alarm fires again on next upward crossing', r.newlyFired.some(f => f.id === 'heat1'));
}

console.log('\nCooling alarm is the mirror (fires downward, re-arms above T+2):');
{
  const def = { id: 'cool1', kind: 'temperature', name: 'Cool', thresholdC: 20, direction: 'cooling', theme: null };
  let state = initAlarmState([def]);
  let now = 0;
  const step = (tempC) => {
    now += 1000;
    const r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC, now }));
    state = r.alarmState;
    return r;
  };
  step(25); // baseline above threshold
  let r = step(18); // crosses down — fires
  ok('cooling fires on downward crossing', r.newlyFired.some(f => f.id === 'cool1'));
  r = step(19);
  ok('no re-fire while still below T+2', r.newlyFired.length === 0);
  r = step(22.5); // above T+2 (22) — re-arms
  ok('rises above T+2 re-arms', state.cool1.armed === true);
  r = step(18);
  ok('re-armed cooling alarm fires again', r.newlyFired.some(f => f.id === 'cool1'));
}

console.log('\nA heating alarm whose step starts already above threshold never fires:');
{
  const def = { id: 'heat2', kind: 'temperature', name: 'Heat', thresholdC: 60, direction: 'heating', theme: null };
  let state = initAlarmState([def]);
  let now = 0;
  const step = (tempC) => {
    now += 1000;
    const r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC, now }));
    state = r.alarmState;
    return r;
  };
  step(70); // starts above threshold — baseline only, no fire
  let r = step(75);
  r = step(80);
  r = step(90);
  ok('never fires while staying above (no crossing ever occurred)', r.newlyFired.length === 0);
  // Even dropping and re-crossing should now behave normally (baseline is set).
  r = step(50);
  r = step(65);
  ok('does fire once it actually crosses up after coming back down', r.newlyFired.some(f => f.id === 'heat2'));
}

console.log('\nData-loss gap: fires after 5s of silence while claimed with temp interest:');
{
  let state = initAlarmState([]);
  let r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: 2000, now: 1000 }));
  state = r.alarmState;
  ok('no fire before timeout', r.newlyFired.length === 0);

  r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: DATA_LOSS_TIMEOUT_MS, now: 2000 }));
  state = r.alarmState;
  ok('fires once timeout reached', r.newlyFired.some(f => f.id === DATA_LOSS_ALARM_ID));

  r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: 8000, now: 3000 }));
  ok('does not re-fire while still silent (already sounding)', r.newlyFired.length === 0);

  // Packet returns — re-arms; then a fresh loss episode fires again.
  r = evaluateAlarms(baseArgs({ alarmState: r.alarmState, hasTempInterest: true, claimed: true, msSinceLastPacket: 100, now: 4000 }));
  state = r.alarmState;
  ok('a returning packet re-arms it', state[DATA_LOSS_ALARM_ID].armed === true);
  // Silence it manually (as the notification/button would) so the next episode can sound again.
  ({ alarmState: state } = silenceEarliest(state));
  r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: DATA_LOSS_TIMEOUT_MS, now: 10000 }));
  ok('a fresh loss episode fires again after re-arming', r.newlyFired.some(f => f.id === DATA_LOSS_ALARM_ID));

  // Unclaimed: must never fire, even past the timeout.
  let unclaimedState = initAlarmState([]);
  r = evaluateAlarms(baseArgs({ alarmState: unclaimedState, hasTempInterest: true, claimed: false, msSinceLastPacket: 9000, now: 1000 }));
  ok('unclaimed instance never sounds the data-loss alarm', r.newlyFired.length === 0);

  // No temp interest: must never fire even if claimed and silent.
  let noInterestState = initAlarmState([]);
  r = evaluateAlarms(baseArgs({ alarmState: noInterestState, hasTempInterest: false, claimed: true, msSinceLastPacket: 9000, now: 1000 }));
  ok('an instance with no band/temp-alarms never sounds the data-loss alarm', r.newlyFired.length === 0);
}

console.log('\nClaim handover mid-step: losing the claim freezes temperature evaluation:');
{
  const def = { id: 'heat3', kind: 'temperature', name: 'Heat', thresholdC: 60, direction: 'heating', theme: null };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, claimed: true, measured: true, tempC: 55, now: 1000 }));
  state = r.alarmState;
  // Claim transferred away — no live reading for this instance anymore.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, claimed: false, measured: false, tempC: null, now: 2000 }));
  state = r.alarmState;
  ok('unclaimed/unmeasured tick does not change temp alarm state', state.heat3.lastAboveThreshold === false);
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, claimed: false, measured: false, tempC: null, now: 3000 }));
  ok('no fire while unclaimed even if a real crossing might be happening unseen', r.newlyFired.length === 0);
  // Claim returns — evaluation resumes normally from wherever the temp actually is.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, claimed: true, measured: true, tempC: 65, now: 4000 }));
  ok('claim regained: fires on the next observed crossing', r.newlyFired.some(f => f.id === 'heat3'));
}

console.log('\nRepeating time alarm fires again after the next interval, across a silence:');
{
  const def = { id: 'rep1', kind: 'time', name: 'Stir', atMs: 5000, repeat: true, intervalMs: 3000, theme: null };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, elapsedRunningMs: 5000, now: 5000 }));
  state = r.alarmState;
  ok('fires at the first threshold', r.newlyFired.some(f => f.id === 'rep1'));

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, elapsedRunningMs: 6000, now: 6000 }));
  ok('does not re-fire while still sounding, even past another instant', r.newlyFired.length === 0);

  ({ alarmState: state } = silenceEarliest(state));
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, elapsedRunningMs: 7000, now: 7000 }));
  ok('silenced but before next interval — does not re-fire yet', r.newlyFired.length === 0);

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: r.alarmState, elapsedRunningMs: 8000, now: 8000 }));
  ok('fires again once the repeat interval elapses', r.newlyFired.some(f => f.id === 'rep1'));
}

console.log('\nOne-shot time alarm never fires twice, even across a silence and Restart re-arms it:');
{
  const def = { id: 'once1', kind: 'time', name: 'Check', atMs: 2000, repeat: false, intervalMs: null, theme: null };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, elapsedRunningMs: 2000, now: 2000 }));
  state = r.alarmState;
  ok('one-shot fires once', r.newlyFired.some(f => f.id === 'once1'));
  ({ alarmState: state } = silenceEarliest(state));
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, elapsedRunningMs: 50000, now: 50000 }));
  ok('one-shot never fires again after being silenced', r.newlyFired.length === 0);

  state = reArmOnRestart(state, [def]);
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, elapsedRunningMs: 2000, now: 60000 }));
  ok('Restart re-arms the one-shot time alarm', r.newlyFired.some(f => f.id === 'once1'));
}

console.log('\nPause: time alarms do not advance, temperature alarms still do:');
{
  const timeDef = { id: 'time1', kind: 'time', name: 'T', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  const tempDef = { id: 'temp1', kind: 'temperature', name: 'Temp', thresholdC: 30, direction: 'heating', theme: null };
  let state = initAlarmState([timeDef, tempDef]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, isRunning: true, tempC: 20, elapsedRunningMs: 0, now: 0 }));
  state = r.alarmState;
  // Paused: isRunning=false, elapsedRunningMs frozen, but a temp reading still arrives.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, isRunning: false, tempC: 35, elapsedRunningMs: 0, now: 1000 }));
  ok('time alarm does not fire while paused even past its threshold instant', !r.newlyFired.some(f => f.id === 'time1'));
  ok('temperature alarm still fires while paused', r.newlyFired.some(f => f.id === 'temp1'));
}

console.log('\nThree simultaneous alarms are silenced earliest-first by three presses:');
{
  const a = { id: 'a', kind: 'time', name: 'A', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  const b = { id: 'b', kind: 'time', name: 'B', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  const c = { id: 'c', kind: 'time', name: 'C', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  let state = initAlarmState([a, b, c]);
  // Fire them one at a time, at three distinct `now` values, to establish a fire order.
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [a], alarmState: state, elapsedRunningMs: 1000, now: 100 }));
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [b], alarmState: state, elapsedRunningMs: 1000, now: 200 }));
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [c], alarmState: state, elapsedRunningMs: 1000, now: 300 }));
  state = r.alarmState;

  ok('all three sounding, ordered earliest-first', JSON.stringify(r.sounding) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(r.sounding));

  let silenced;
  ({ alarmState: state, silencedId: silenced } = silenceEarliest(state));
  ok('first press silences a (earliest)', silenced === 'a');
  ({ alarmState: state, silencedId: silenced } = silenceEarliest(state));
  ok('second press silences b', silenced === 'b');
  ({ alarmState: state, silencedId: silenced } = silenceEarliest(state));
  ok('third press silences c', silenced === 'c');
  ({ alarmState: state, silencedId: silenced } = silenceEarliest(state));
  ok('a fourth press with nothing sounding silences nothing', silenced === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
