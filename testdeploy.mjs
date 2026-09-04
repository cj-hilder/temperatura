import { canApplyServiceWorkerUpdate } from './src/lib/deploy.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

const instance = (status, sounding = false) => ({
  status,
  alarmState: sounding ? { a: { sounding: true } } : { a: { sounding: false } },
});

console.log('\ncanApplyServiceWorkerUpdate — build-plan §6: never reload mid-ferment or while an alarm sounds:');
{
  ok('no open recipes at all: safe', canApplyServiceWorkerUpdate([]));
  ok('only completed instances, nothing sounding: safe',
    canApplyServiceWorkerUpdate([{ recipe: {}, instances: [instance('completed'), instance('completed')] }]));
  ok('a running instance: not safe', !canApplyServiceWorkerUpdate([{ recipe: {}, instances: [instance('running')] }]));
  ok('a paused instance is still "in progress" per spec: not safe',
    !canApplyServiceWorkerUpdate([{ recipe: {}, instances: [instance('paused')] }]));
  ok('a completed instance with a leftover sounding alarm: not safe',
    !canApplyServiceWorkerUpdate([{ recipe: {}, instances: [instance('completed', true)] }]));
  ok('one recipe safe, another still running: not safe overall', !canApplyServiceWorkerUpdate([
    { recipe: {}, instances: [instance('completed')] },
    { recipe: {}, instances: [instance('running')] },
  ]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
