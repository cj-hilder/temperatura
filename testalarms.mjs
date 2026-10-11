import {
  initAlarmState,
  reArmOnRestart,
  evaluateAlarms,
  silenceEarliest,
  silenceById,
  dismissById,
  earliestSoundingAcrossInstances,
  earliestOutstandingAcrossInstances,
  themeIdForFiredAlarm,
  themeIdForAlarmId,
  DATA_LOSS_ALARM_ID,
  DATA_LOSS_TIMEOUT_MS,
  thresholdSide,
} from './src/lib/alarms.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

// Common baseline args for evaluateAlarms — tests override just what they need.
function baseArgs(overrides = {}) {
  return {
    stepAlarmDefs: [],
    hasTempInterest: false,
    alarmState: {},
    timeBasisMs: 0,
    isRunning: true,
    claimed: true,
    msSinceLastPacket: 0,
    measured: true,
    tempC: null,
    now: 0,
    ...overrides,
  };
}

// A tick-by-tick driver over one def, fed the way the real probe feeds it:
// each step() is one 1 s tick, given the readings that arrived since the last
// tick (oldest first, numbered like the probe manager numbers them). The
// tick's own tempC is the latest of them. step([]) = a tick with no new
// reading (a BBQ holding steady), keeping the previous latest.
function driver(def) {
  let state = initAlarmState([def]);
  let now = 0;
  let n = 0;
  let buffer = [];
  const step = (temps, { measured = true, dt = 1000 } = {}) => {
    const list = Array.isArray(temps) ? temps : [temps];
    list.forEach((tempC, i) => buffer.push({ n: ++n, tempC, at: now + ((i + 1) * dt) / (list.length + 1) }));
    buffer = buffer.slice(-32);
    now += dt;
    const latest = buffer[buffer.length - 1];
    const r = evaluateAlarms(baseArgs({
      stepAlarmDefs: [def], alarmState: state, measured,
      tempC: measured ? latest?.tempC ?? null : null,
      readings: measured ? buffer : null, now,
    }));
    state = r.alarmState;
    return r;
  };
  return { step, get state() { return state[def.id]; }, setState: (s) => { state = s; }, get all() { return state; } };
}
const fired = (r, id) => r.newlyFired.some((f) => f.id === id);
const heat60 = { id: 'heat1', kind: 'temperature', name: 'Heat', thresholdC: 60, direction: 'heating', theme: null };

console.log('\nRe-arm: 5 readings in a row without going over the threshold again:');
{
  const d = driver(heat60);
  d.step(58); // baseline, below threshold — no fire
  ok('fires on upward crossing', fired(d.step(61), 'heat1'));
  d.step([59.5, 59.4]); // readings 1 and 2 back below
  d.step([59.3, 59.2]); // 3 and 4
  ok('4 readings back below is not enough', d.state.armed === false);
  d.step([59.1]); // 5
  ok('the 5th reading re-arms (well inside 5 s)', d.state.armed === true);
  ok('re-armed alarm fires again on the next crossing', fired(d.step(61), 'heat1'));
}

console.log('\nRe-arm: any reading over the threshold during the count cancels it — even one between two ticks:');
{
  const d = driver(heat60);
  d.step(58);
  d.step(61); // fires
  d.step([59, 59, 59]);
  d.step([60.2, 59]); // a reading over 60 BETWEEN ticks; the tick itself sees 59
  ok('an excursion over the threshold between ticks resets the count', d.state.armed === false && d.state.rearm?.count === 1);
  d.step([59, 59, 59]);
  ok('4 in a row after the excursion: not yet', d.state.armed === false);
  d.step([59]);
  ok('the 5th in a row after the excursion re-arms', d.state.armed === true);

  const j = driver(heat60);
  j.step(58);
  j.step(61);
  let refired = false;
  for (const t of [[59.9, 60.5], [59.5, 60.8], [59.8, 61]]) refired = refired || fired(j.step(t), 'heat1');
  ok('jitter across the threshold never re-arms and never re-fires', !refired && j.state.armed === false);
}

console.log('\nRe-arm: exactly AT the threshold (rounded) is not over it:');
{
  const d = driver(heat60);
  d.step(58);
  d.step(61);
  d.step([59.9, 60, 60.04]); // 59.9 starts the count; 60.0 and 60.04 (shows 60.0) aren't over
  ok('readings at the threshold do not cancel the count, and count towards it', d.state.rearm?.count === 3);
  d.step([60, 59.96]);
  ok('so 5 readings re-arm', d.state.armed === true);

  const a = driver(heat60);
  a.step(58);
  a.step(61);
  a.step([60, 60, 60, 60, 60, 60]);
  ok('but the count only STARTS on a reading back across by some amount', a.state.armed === false && a.state.rearm === null);
  a.step([59.94]); // shows 59.9
  ok('0.1 back (rounded) starts it', a.state.rearm?.count === 1);
}

console.log('\nRe-arm: or 5 seconds without going over, when readings are slow (a BBQ holding steady):');
{
  const d = driver(heat60);
  d.step(58);
  d.step(61);
  d.step([59]); // count starts (reading at +0.5 s into this tick)
  for (let i = 0; i < 4; i++) d.step([]); // nothing new
  ok('under 5 s with no new reading is not enough', d.state.armed === false);
  d.step([]);
  ok('5 s after the reading back across re-arms', d.state.armed === true);
}

console.log('\nRe-arm: a data gap cancels the count, and readings from during the gap are ignored:');
{
  const d = driver(heat60);
  d.step(58);
  d.step(61);
  d.step([59, 59, 59]);
  d.step([59, 59], { measured: false }); // unassigned / no live data for this instance
  d.step([59]);
  ok('the count starts over after the gap from one reading', d.state.armed === false && d.state.rearm?.count === 1);
  d.step([59, 59, 59, 59]);
  ok('5 in a row after the gap re-arms', d.state.armed === true);
}

console.log('\nRe-arm: a reading counter that goes backwards (a different probe) does not freeze evaluation:');
{
  const def = heat60;
  let state = initAlarmState([def]);
  const tick = (now, readings) => {
    const r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: readings[readings.length - 1].tempC, readings, now }));
    state = r.alarmState;
    return r;
  };
  tick(1000, [{ n: 500, tempC: 58, at: 900 }]);
  tick(2000, [{ n: 501, tempC: 61, at: 1900 }]); // fires; bookmark at 501
  tick(3000, [{ n: 3, tempC: 59, at: 2900 }]); // new probe, counting from 3
  ok('the new probe\'s reading is taken and starts the count', state.heat1.rearm?.count === 1 && state.heat1.seenN === 3);
}

console.log('\nRe-arm: with no readings list (older callers), the tick\'s reading stands in as one reading per tick:');
{
  let state = initAlarmState([heat60]);
  const tick = (now, tempC) => { const r = evaluateAlarms(baseArgs({ stepAlarmDefs: [heat60], alarmState: state, tempC, now })); state = r.alarmState; return r; };
  tick(1000, 58);
  tick(2000, 61);
  for (let t = 3000; t <= 6000; t += 1000) tick(t, 59);
  ok('4 ticks back below: not yet', state.heat1.armed === false);
  tick(7000, 59);
  ok('the 5th re-arms', state.heat1.armed === true);
}

console.log('\nFiring is judged on the rounded reading too, so it agrees with the display:');
{
  const def = { id: 'heat70', kind: 'temperature', name: 'Hot', thresholdC: 70, direction: 'heating', theme: null };
  const d = driver(def);
  d.step(65);
  ok('70.04 (shows 70.0) does not fire a 70° heating alarm', !fired(d.step(70.04), 'heat70'));
  ok('70.06 (shows 70.1) does', fired(d.step(70.06), 'heat70'));
  ok('thresholdSide compares integer tenths, immune to float noise (0.1 + 0.2 vs 0.3)', thresholdSide(0.1 + 0.2, 0.3) === 'at');
  ok('thresholdSide: above / at / below', thresholdSide(60.1, 60) === 'above' && thresholdSide(60.04, 60) === 'at' && thresholdSide(59.9, 60) === 'below');
}

console.log('\nCooling alarm is the mirror (fires going below, re-arms after 5 readings without going below again):');
{
  const def = { id: 'cool1', kind: 'temperature', name: 'Cool', thresholdC: 20, direction: 'cooling', theme: null };
  const d = driver(def);
  d.step(25); // baseline above threshold
  ok('reaching exactly 20.0 does not fire', !fired(d.step(20), 'cool1'));
  ok('19.9 fires', fired(d.step(19.9), 'cool1'));
  d.step([20.1, 20.2, 19.8, 20.1]); // a reading back below cancels
  ok('a reading below again cancels the count', d.state.armed === false && d.state.rearm?.count === 1);
  d.step([20.1, 20.1, 20.1, 20.1]);
  ok('5 in a row back above re-arms', d.state.armed === true);
  ok('re-armed cooling alarm fires again', fired(d.step(18), 'cool1'));
}

console.log('\n"Once" (oneShot) temperature alarm: fires once per run, Restart re-arms it:');
{
  const def = { id: 'once1', kind: 'temperature', name: 'Pan hot', thresholdC: 60, direction: 'heating', oneShot: true, theme: null };
  const d = driver(def);
  d.step(55);
  ok('fires on the first crossing', fired(d.step(65), 'once1'));
  for (let i = 0; i < 10; i++) d.step([50, 50]); // plenty to re-arm an "every time" alarm
  ok('never re-arms by temperature', d.state.armed === false);
  ok('never fires again', !fired(d.step(65), 'once1'));

  d.setState(reArmOnRestart(d.all, [def]));
  ok('Restart re-arms it', d.state.armed === true);
  ok('...but still needs a real crossing: already above, no instant fire', !fired(d.step(66), 'once1'));
  d.step(50);
  ok('fires again on the next crossing after Restart', fired(d.step(65), 'once1'));
}

console.log('\nState saved before lastSide existed (lastAboveThreshold) still evaluates:');
{
  const def = heat60;
  const legacy = { ...initAlarmState([def]), heat1: { armed: true, sounding: false, missed: false, firedAt: null, lastAboveThreshold: false } };
  const r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: legacy, tempC: 65, now: 1000 }));
  ok('a legacy "not above" baseline fires on crossing up', fired(r, 'heat1') && r.alarmState.heat1.lastSide === 'above');
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
  ok('unclaimed/unmeasured tick does not change temp alarm state', state.heat3.lastSide === 'below');
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
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 5000, now: 5000 }));
  state = r.alarmState;
  ok('fires at the first threshold', r.newlyFired.some(f => f.id === 'rep1'));

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 6000, now: 6000 }));
  ok('does not re-fire while still sounding, even past another instant', r.newlyFired.length === 0);

  ({ alarmState: state } = silenceEarliest(state));
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 7000, now: 7000 }));
  ok('silenced but before next interval — does not re-fire yet', r.newlyFired.length === 0);

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: r.alarmState, timeBasisMs: 8000, now: 8000 }));
  ok('fires again once the repeat interval elapses', r.newlyFired.some(f => f.id === 'rep1'));
}

console.log('\nOne-shot time alarm never fires twice, even across a silence and Restart re-arms it:');
{
  const def = { id: 'once1', kind: 'time', name: 'Check', atMs: 2000, repeat: false, intervalMs: null, theme: null };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 2000, now: 2000 }));
  state = r.alarmState;
  ok('one-shot fires once', r.newlyFired.some(f => f.id === 'once1'));
  ({ alarmState: state } = silenceEarliest(state));
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 50000, now: 50000 }));
  ok('one-shot never fires again after being silenced', r.newlyFired.length === 0);

  state = reArmOnRestart(state, [def]);
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 2000, now: 60000 }));
  ok('Restart re-arms the one-shot time alarm', r.newlyFired.some(f => f.id === 'once1'));
}

console.log('\nPause: time alarms do not advance, temperature alarms still do:');
{
  const timeDef = { id: 'time1', kind: 'time', name: 'T', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  const tempDef = { id: 'temp1', kind: 'temperature', name: 'Temp', thresholdC: 30, direction: 'heating', theme: null };
  let state = initAlarmState([timeDef, tempDef]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, isRunning: true, tempC: 20, timeBasisMs: 0, now: 0 }));
  state = r.alarmState;
  // Paused: isRunning=false, timeBasisMs frozen, but a temp reading still arrives.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, isRunning: false, tempC: 35, timeBasisMs: 0, now: 1000 }));
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
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [a], alarmState: state, timeBasisMs: 1000, now: 100 }));
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [b], alarmState: state, timeBasisMs: 1000, now: 200 }));
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [c], alarmState: state, timeBasisMs: 1000, now: 300 }));
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

console.log('\nsilenceById silences a specific alarm regardless of fire order (notification / in-app path):');
{
  const a = { id: 'a', kind: 'time', name: 'A', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  const b = { id: 'b', kind: 'time', name: 'B', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  let state = initAlarmState([a, b]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [a], alarmState: state, timeBasisMs: 1000, now: 100 }));
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [b], alarmState: state, timeBasisMs: 1000, now: 200 }));
  state = r.alarmState;
  ok('both sounding, a fired first', JSON.stringify(r.sounding) === JSON.stringify(['a', 'b']));

  let silenced;
  ({ alarmState: state, silencedId: silenced } = silenceById(state, 'b'));
  ok('silenceById can target the later alarm directly, unlike earliest-first', silenced === 'b');
  ok('the earlier alarm is untouched', state.a.sounding === true);
  ok('the targeted alarm is silenced', state.b.sounding === false);

  ({ alarmState: state, silencedId: silenced } = silenceById(state, 'b'));
  ok('silencing an already-silent alarm by id is a no-op', silenced === null);

  ({ alarmState: state, silencedId: silenced } = silenceById(state, 'nonexistent'));
  ok('silencing an unknown id is a no-op, not a crash', silenced === null);
}

console.log('\nearliestSoundingAcrossInstances — the thermometer button is shared across every running instance:');
{
  const a = { id: 'a', kind: 'time', name: 'A', atMs: 1000, repeat: false, intervalMs: null, theme: null };
  const b = { id: 'b', kind: 'time', name: 'B', atMs: 1000, repeat: false, intervalMs: null, theme: null };

  // Instance "loaf1" fires 'a' at now=200; instance "loaf2" fires 'b' at now=100 (earlier).
  let stateLoaf1 = initAlarmState([a]);
  stateLoaf1 = evaluateAlarms(baseArgs({ stepAlarmDefs: [a], alarmState: stateLoaf1, timeBasisMs: 1000, now: 200 })).alarmState;
  let stateLoaf2 = initAlarmState([b]);
  stateLoaf2 = evaluateAlarms(baseArgs({ stepAlarmDefs: [b], alarmState: stateLoaf2, timeBasisMs: 1000, now: 100 })).alarmState;

  const result = earliestSoundingAcrossInstances([
    { instanceId: 'loaf1', alarmState: stateLoaf1 },
    { instanceId: 'loaf2', alarmState: stateLoaf2 },
  ]);
  ok('finds the globally earliest alarm across different instances', result.instanceId === 'loaf2' && result.alarmId === 'b', JSON.stringify(result));

  const noneSounding = earliestSoundingAcrossInstances([
    { instanceId: 'x', alarmState: initAlarmState([]) },
    { instanceId: 'y', alarmState: initAlarmState([]) },
  ]);
  ok('null when nothing is sounding anywhere', noneSounding === null);

  const empty = earliestSoundingAcrossInstances([]);
  ok('null with no instances at all', empty === null);
}

console.log('\nearliestOutstandingAcrossInstances — the generalized version, spanning sounding AND missed:');
{
  const a = { id: 'a', kind: 'time', name: 'A', atMs: 1000, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 500 };
  const b = { id: 'b', kind: 'time', name: 'B', atMs: 1000, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 500 };

  // "loaf1" fires 'a' at now=100, then it goes missed (unanswered past its
  // 500ms silence-after). "loaf2" fires 'b' later, at now=900, and is still
  // sounding. Despite firing LATER, and despite being missed rather than
  // sounding, 'a' is still earliest by firedAt and must win.
  let stateLoaf1 = initAlarmState([a]);
  stateLoaf1 = evaluateAlarms(baseArgs({ stepAlarmDefs: [a], alarmState: stateLoaf1, timeBasisMs: 1000, now: 100 })).alarmState;
  stateLoaf1 = evaluateAlarms(baseArgs({ stepAlarmDefs: [a], alarmState: stateLoaf1, timeBasisMs: 1000, now: 700 })).alarmState; // past silence-after — now missed
  ok('setup: loaf1\'s alarm is missed', stateLoaf1.a.missed === true && stateLoaf1.a.sounding === false);

  let stateLoaf2 = initAlarmState([b]);
  stateLoaf2 = evaluateAlarms(baseArgs({ stepAlarmDefs: [b], alarmState: stateLoaf2, timeBasisMs: 1000, now: 900 })).alarmState;
  ok('setup: loaf2\'s alarm is still sounding', stateLoaf2.b.sounding === true);

  const result = earliestOutstandingAcrossInstances([
    { instanceId: 'loaf1', alarmState: stateLoaf1 },
    { instanceId: 'loaf2', alarmState: stateLoaf2 },
  ]);
  ok('finds the earliest-fired alarm regardless of which is sounding vs missed',
    result.instanceId === 'loaf1' && result.alarmId === 'a', JSON.stringify(result));
  ok('reports that resolving it means dismissing, not silencing', result.missed === true);

  // Once loaf1's is dismissed, loaf2's (still sounding) is the only one left.
  const afterDismiss = earliestOutstandingAcrossInstances([
    { instanceId: 'loaf2', alarmState: stateLoaf2 },
  ]);
  ok('the remaining sounding alarm is found once the missed one is gone', afterDismiss.instanceId === 'loaf2' && afterDismiss.missed === false);

  const noneOutstanding = earliestOutstandingAcrossInstances([
    { instanceId: 'x', alarmState: initAlarmState([]) },
    { instanceId: 'y', alarmState: initAlarmState([]) },
  ]);
  ok('null when nothing is sounding or missed anywhere', noneOutstanding === null);

  ok('null with no instances at all', earliestOutstandingAcrossInstances([]) === null);
}

console.log('\nthemeIdForFiredAlarm / themeIdForAlarmId — which alarm theme applies:');
{
  const ids = { dataLossThemeId: 'siren-theme', defaultThemeId: 'default' };

  ok('a data-loss fired alarm uses the settings-key theme, not the default',
    themeIdForFiredAlarm({ kind: 'dataLoss', theme: null }, ids) === 'siren-theme');
  ok('a normal fired alarm with an explicit theme uses it',
    themeIdForFiredAlarm({ kind: 'temperature', theme: 'bell-theme' }, ids) === 'bell-theme');
  ok('a normal fired alarm with no theme falls back to the default',
    themeIdForFiredAlarm({ kind: 'time', theme: null }, ids) === 'default');
  ok('no dataLossThemeId configured falls back to the default even for data-loss',
    themeIdForFiredAlarm({ kind: 'dataLoss', theme: null }, { defaultThemeId: 'default' }) === 'default');

  const stepAlarmDefs = [
    { id: 'temp1', theme: 'bell-theme' },
    { id: 'time1', theme: null },
  ];
  ok('themeIdForAlarmId resolves the data-loss id via the settings-key theme',
    themeIdForAlarmId(DATA_LOSS_ALARM_ID, stepAlarmDefs, ids) === 'siren-theme');
  ok('themeIdForAlarmId looks up a normal id\'s own theme from stepAlarmDefs',
    themeIdForAlarmId('temp1', stepAlarmDefs, ids) === 'bell-theme');
  ok('themeIdForAlarmId falls back to default when the def\'s theme is null',
    themeIdForAlarmId('time1', stepAlarmDefs, ids) === 'default');
  ok('themeIdForAlarmId falls back to default for an id with no matching def',
    themeIdForAlarmId('unknown', stepAlarmDefs, ids) === 'default');
}

console.log('\nEditing a running step to add a new alarm must not crash or freeze the rest of the tick:');
{
  // A step can be edited while an instance is running (spec: "edits take
  // effect immediately"), so a def can show up with no matching alarmState
  // entry — e.g. a temperature band, and its two implicit band-boundary
  // alarms, added after this instance's alarmState was built at Start.
  const timeDef = { id: 'time1', kind: 'time', name: 'Stir', atMs: 500, repeat: false, intervalMs: null, theme: null };
  let state = initAlarmState([timeDef]); // instance started before the band existed

  const bandMin = { id: 'band-min', kind: 'temperature', name: 'Below band', thresholdC: 20, direction: 'cooling', theme: null };
  const bandMax = { id: 'band-max', kind: 'temperature', name: 'Above band', thresholdC: 30, direction: 'heating', theme: null };
  let threw = false;
  let r;
  try {
    r = evaluateAlarms(baseArgs({
      stepAlarmDefs: [timeDef, bandMin, bandMax], alarmState: state,
      isRunning: true, measured: true, tempC: 25, timeBasisMs: 200, now: 1000,
    }));
  } catch (e) {
    threw = true;
  }
  ok('a temperature alarm with no prior state does not crash the pass', !threw);
  ok('the new temperature alarm establishes a baseline rather than firing immediately', !r.newlyFired.some((f) => f.id === 'band-min' || f.id === 'band-max'));
  ok('an unrelated alarm already in progress is still evaluated in the same pass', r.alarmState.time1 !== undefined);

  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, bandMin, bandMax], alarmState: state, isRunning: true, measured: true, tempC: 18, timeBasisMs: 700, now: 2000 }));
  ok('the newly-added alarm fires normally on the next real crossing', r.newlyFired.some((f) => f.id === 'band-min'));
}

console.log('\nMissed status: a one-shot time alarm left sounding past silenceAfterMs goes missed, and stays blocked until dismissed:');
{
  const def = { id: 'once1', kind: 'time', name: 'Check', atMs: 1000, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 5000 };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 1000, now: 1000 }));
  state = r.alarmState;
  ok('fires normally', r.newlyFired.some(f => f.id === 'once1'));
  ok('sounding right after firing', state.once1.sounding === true && state.once1.missed === false);

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 4000, now: 4999 }));
  state = r.alarmState;
  ok('still sounding just under the silence-after window (now - firedAt = 3999ms < 5000ms)', state.once1.sounding === true && state.once1.missed === false);

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 6000, now: 6000 }));
  state = r.alarmState;
  ok('goes missed once the silence-after window elapses unanswered (now - firedAt = 5000ms >= 5000ms)', state.once1.sounding === false && state.once1.missed === true);
  ok('not present in sounding once missed', !r.sounding.includes('once1'));

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 999999, now: 999999 }));
  ok('a missed one-shot alarm cannot fire again even arbitrarily far in the future', r.newlyFired.length === 0);

  let dismissed;
  ({ alarmState: state, dismissedId: dismissed } = dismissById(state, 'once1'));
  ok('dismissById clears missed', dismissed === 'once1' && state.once1.missed === false);
  ok('dismissing does not resurrect sounding — a one-shot alarm still cannot fire again (firedCount already spent)',
    evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 999999, now: 999999 })).newlyFired.length === 0);
}

console.log('\nMissed status: a repeating time alarm retriggers on its next interval even while the previous occurrence is still missed, implicitly dismissing it:');
{
  // intervalMs (5000) is deliberately well past silenceAfterMs (2000), so
  // there's a clean window where the alarm is genuinely sitting missed
  // before the next interval's threshold is reached — otherwise the two
  // events (going missed vs. the next retrigger) could coincide in the same
  // evaluation and the "goes missed" step would never actually be observed.
  const def = { id: 'rep1', kind: 'time', name: 'Stir', atMs: 1000, repeat: true, intervalMs: 5000, theme: null, silenceAfterMs: 2000 };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 1000, now: 1000 }));
  state = r.alarmState;
  ok('fires at the first threshold', r.newlyFired.some(f => f.id === 'rep1'));

  // Left unanswered past silenceAfterMs (2000), but still short of the next
  // interval's threshold (1000 + 1*5000 = 6000) — goes missed, does not fire.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 3500, now: 3500 }));
  state = r.alarmState;
  ok('goes missed', state.rep1.missed === true && state.rep1.sounding === false);
  ok('does not fire again yet — only the silence-after window elapsed, not the next interval', r.newlyFired.length === 0);

  // The next repeat (threshold 6000) is now due — it must fire and re-sound
  // anyway, so the user never misses an interval just because they hadn't
  // gotten around to dismissing the last one. The fresh fire itself clears
  // missed (there is only one state slot for this alarm id, so firing IS
  // the dismissal).
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 6000, now: 6000 }));
  state = r.alarmState;
  ok('fires the next repeat even though the previous occurrence was still missed', r.newlyFired.some(f => f.id === 'rep1'));
  ok('the retrigger implicitly dismisses the earlier missed occurrence', state.rep1.missed === false && state.rep1.sounding === true);

  // This new occurrence can go missed too, independently, still short of
  // ITS next threshold (1000 + 2*5000 = 11000) — and can still be dismissed
  // explicitly ahead of time, which remains a real, optional action.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 8500, now: 8500 }));
  state = r.alarmState;
  ok('this occurrence goes missed too if left unanswered', state.rep1.missed === true);
  let dismissed;
  ({ alarmState: state, dismissedId: dismissed } = dismissById(state, 'rep1'));
  ok('can still be dismissed explicitly ahead of the next retrigger', dismissed === 'rep1' && state.rep1.missed === false);
}

console.log('\nMissed status: a temperature alarm that re-arms retriggers over a still-missed earlier occurrence:');
{
  const def = { id: 'heat1', kind: 'temperature', name: 'Heat', thresholdC: 60, direction: 'heating', theme: null, silenceAfterMs: 2000 };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 55, now: 0 })); // baseline
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 65, now: 1000 })); // crosses up — fires
  state = r.alarmState;
  ok('fires on upward crossing', r.newlyFired.some(f => f.id === 'heat1'));

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 65, now: 3500 })); // 2500ms later, unanswered
  state = r.alarmState;
  ok('goes missed', state.heat1.missed === true && state.heat1.sounding === false);

  // Back below for 5 s to re-arm, then cross up again — must fire again even
  // though the previous occurrence is still missed, implicitly dismissing it.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 50, now: 4000 }));
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 50, now: 9000 }));
  state = r.alarmState;
  ok('re-arm happens normally', state.heat1.armed === true);
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 65, now: 10000 }));
  state = r.alarmState;
  ok('fires again on the fresh crossing even though still missed from before', r.newlyFired.some(f => f.id === 'heat1'));
  ok('the retrigger implicitly dismisses the earlier missed occurrence', state.heat1.missed === false && state.heat1.sounding === true);
}

console.log('\nMissed status: the data-loss alarm too, via evaluateAlarms\' dataLossSilenceAfterMs — a fresh loss episode retriggers over a still-missed earlier one:');
{
  let state = initAlarmState([]);
  let r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: DATA_LOSS_TIMEOUT_MS, now: 1000, dataLossSilenceAfterMs: 2000 }));
  state = r.alarmState;
  ok('fires once the 5s data-loss timeout is reached', r.newlyFired.some(f => f.id === DATA_LOSS_ALARM_ID));

  r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: 15000, now: 3500, dataLossSilenceAfterMs: 2000 }));
  state = r.alarmState;
  ok('goes missed after its own silence-after elapses, even with the connection still down', state[DATA_LOSS_ALARM_ID].missed === true && state[DATA_LOSS_ALARM_ID].sounding === false);

  r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: 100, now: 4000, dataLossSilenceAfterMs: 2000 }));
  state = r.alarmState;
  ok('a returning packet re-arms it even while missed', state[DATA_LOSS_ALARM_ID].armed === true);

  r = evaluateAlarms(baseArgs({ alarmState: state, hasTempInterest: true, claimed: true, msSinceLastPacket: DATA_LOSS_TIMEOUT_MS, now: 12000, dataLossSilenceAfterMs: 2000 }));
  state = r.alarmState;
  ok('a fresh loss episode fires even though the earlier one is still missed', r.newlyFired.some(f => f.id === DATA_LOSS_ALARM_ID));
  ok('the retrigger implicitly dismisses the earlier missed occurrence', state[DATA_LOSS_ALARM_ID].missed === false && state[DATA_LOSS_ALARM_ID].sounding === true);

  // Omitting dataLossSilenceAfterMs falls back to the module default (2 min) — not tested for the exact value here (that's alarmPlayer.js's job), just that a huge default never spuriously goes missed on a short test timeline.
  let defaultState = initAlarmState([]);
  r = evaluateAlarms(baseArgs({ alarmState: defaultState, hasTempInterest: true, claimed: true, msSinceLastPacket: DATA_LOSS_TIMEOUT_MS, now: 1000 }));
  defaultState = r.alarmState;
  r = evaluateAlarms(baseArgs({ alarmState: defaultState, hasTempInterest: true, claimed: true, msSinceLastPacket: 10000, now: 5000 }));
  ok('with no dataLossSilenceAfterMs given, the 2-minute default keeps it sounding on a short timeline', r.alarmState[DATA_LOSS_ALARM_ID].sounding === true);
}

console.log('\ndismissById: mirrors silenceById\'s no-op guards, but for missed instead of sounding:');
{
  const def = { id: 'once1', kind: 'time', name: 'Check', atMs: 1000, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 100 };
  let state = initAlarmState([def]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 1000, now: 1000 }));
  state = r.alarmState;

  let dismissed;
  ({ alarmState: state, dismissedId: dismissed } = dismissById(state, 'once1'));
  ok('dismissing an alarm that is sounding but not yet missed is a no-op', dismissed === null && state.once1.sounding === true);

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, timeBasisMs: 2000, now: 2000 }));
  state = r.alarmState;
  ok('now missed', state.once1.missed === true);

  ({ alarmState: state, dismissedId: dismissed } = dismissById(state, 'once1'));
  ok('dismisses successfully once actually missed', dismissed === 'once1');

  ({ alarmState: state, dismissedId: dismissed } = dismissById(state, 'once1'));
  ok('dismissing an already-dismissed alarm is a no-op', dismissed === null);

  ({ alarmState: state, dismissedId: dismissed } = dismissById(state, 'nonexistent'));
  ok('dismissing an unknown id is a no-op, not a crash', dismissed === null);
}

console.log('\nreArmOnRestart clears missed for every alarm kind, including temperature:');
{
  const timeDef = { id: 'time1', kind: 'time', name: 'T', atMs: 1000, repeat: false, intervalMs: null, theme: null, silenceAfterMs: 100 };
  const tempDef = { id: 'heat1', kind: 'temperature', name: 'Heat', thresholdC: 60, direction: 'heating', theme: null, silenceAfterMs: 100 };
  let state = initAlarmState([timeDef, tempDef]);
  let r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, tempC: 55, timeBasisMs: 0, now: 0 })); // baseline
  state = r.alarmState;
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, tempC: 65, timeBasisMs: 1000, now: 1000 })); // both fire
  state = r.alarmState;
  ok('both fired', state.time1.sounding === true && state.heat1.sounding === true);

  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [timeDef, tempDef], alarmState: state, tempC: 65, timeBasisMs: 1000, now: 2000 })); // past silenceAfterMs
  state = r.alarmState;
  ok('both go missed', state.time1.missed === true && state.heat1.missed === true);

  state = reArmOnRestart(state, [timeDef, tempDef]);
  ok('restart clears missed on the time alarm', state.time1.missed === false);
  ok('restart clears missed on the temperature alarm too (the one thing Restart otherwise leaves alone)', state.heat1.missed === false);
  ok('restart still preserves an "every time" temperature alarm\'s armed/lastSide (unlike a full reset)', state.heat1.armed === false && state.heat1.lastSide === 'above');

  // A def with no prior entry at all (edited in during the run) must also
  // get a real baseline, not a bare {missed:false}.
  const newTempDef = { id: 'cool1', kind: 'temperature', name: 'Cool', thresholdC: 20, direction: 'cooling', theme: null };
  state = reArmOnRestart(state, [newTempDef]);
  ok('a def with no prior entry gets a full fresh baseline via restart, not a partial object',
    state.cool1.armed === true && state.cool1.sounding === false && state.cool1.missed === false && state.cool1.lastSide === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
