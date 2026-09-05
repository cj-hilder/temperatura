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

console.log('\nMissed status: a temperature alarm re-arming by deadband retriggers over a still-missed earlier occurrence:');
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

  // Drop below T-2 to re-arm, then cross up again — must fire again even
  // though the previous occurrence is still missed, implicitly dismissing it.
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 50, now: 4000 }));
  state = r.alarmState;
  ok('deadband re-arm happens normally', state.heat1.armed === true);
  r = evaluateAlarms(baseArgs({ stepAlarmDefs: [def], alarmState: state, tempC: 65, now: 5000 }));
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
  ok('restart still preserves the temperature alarm\'s armed/lastAboveThreshold (unlike a full reset)', state.heat1.armed === false && state.heat1.lastAboveThreshold === true);

  // A def with no prior entry at all (edited in during the run) must also
  // get a real baseline, not a bare {missed:false}.
  const newTempDef = { id: 'cool1', kind: 'temperature', name: 'Cool', thresholdC: 20, direction: 'cooling', theme: null };
  state = reArmOnRestart(state, [newTempDef]);
  ok('a def with no prior entry gets a full fresh baseline via restart, not a partial object',
    state.cool1.armed === true && state.cool1.sounding === false && state.cool1.missed === false && state.cool1.lastAboveThreshold === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
