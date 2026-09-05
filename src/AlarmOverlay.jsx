import { alarmName } from "./stepDisplay.js";
import { durationAlarmId } from "./lib/recipe.js";
import * as t from "./theme.js";

// Every currently sounding or missed alarm, across every open recipe and
// instance — engine.openRecipes already carries everything a row needs
// (recipe name, the step via `recipe.steps.find`, the instance's tag, and
// its alarmState), so this is a pure derivation with no extra engine
// plumbing. Sorted earliest-first, matching every other alarm ordering in
// this app (alarms.js's soundingInFireOrder/earliestOutstandingAcrossInstances).
function outstandingAlarms(openRecipes) {
  const rows = [];
  for (const { recipe, instances } of openRecipes) {
    for (const instance of instances) {
      const step = recipe.steps.find((s) => s.id === instance.stepId);
      if (!step) continue;
      for (const [alarmId, state] of Object.entries(instance.alarmState)) {
        if (!state.sounding && !state.missed) continue;
        rows.push({
          key: `${instance.id}:${alarmId}`,
          instanceId: instance.id,
          alarmId,
          recipeName: recipe.name,
          stepName: step.name,
          alarmName: alarmName(step, alarmId),
          tag: instance.tag,
          missed: state.missed,
          firedAt: state.firedAt ?? 0,
          // Only the duration-reached alarm ever offers Extend — same rule
          // the step page's own Extend button already follows.
          canExtend: alarmId === durationAlarmId(step.id),
        });
      }
    }
  }
  return rows.sort((a, b) => a.firedAt - b.firedAt);
}

// The blocking global alarm overlay. Deliberately has no close/dismiss-all
// control and no backdrop-click handler — per spec, the only way it goes
// away is every row being individually silenced or dismissed, so it
// disappears purely because `rows` becomes empty. Rendered unconditionally
// by App.jsx (returns null itself when there's nothing outstanding) as the
// second-to-last element in the overlay stack — on top of every page,
// editor, and other panel, but under ExtendDialog, which must be answerable
// from a row's own Extend button.
export default function AlarmOverlay({ engine }) {
  const rows = outstandingAlarms(engine.openRecipes);
  if (rows.length === 0) return null;

  return (
    <div style={t.overlay}>
      <div style={{ ...t.overlayCard, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Alarms</h3>
        {rows.map((r) => (
          <div key={r.key} style={{ padding: "10px 0", borderBottom: `1px solid ${t.colors.border}` }}>
            <div style={{ fontWeight: 700 }}>{r.recipeName} · {r.stepName}</div>
            <div style={{ fontSize: 13 }}>
              {r.alarmName}
              {r.tag ? ` — ${r.tag}` : ""}
            </div>
            {r.missed && <div style={{ fontSize: 12, color: t.colors.accentRed, marginTop: 2 }}>Missed</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                style={t.primaryButton}
                onClick={() => (r.missed ? engine.dismissAlarm(r.instanceId, r.alarmId) : engine.silenceAlarm(r.instanceId, r.alarmId))}
              >
                {r.missed ? "Dismiss" : "Silence"}
              </button>
              {r.canExtend && (
                <button style={t.secondaryButton} onClick={() => engine.requestExtend(r.instanceId)}>Extend</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
