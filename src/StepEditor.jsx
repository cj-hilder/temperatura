import { useEffect, useState } from "react";
import * as t from "./theme.js";

const MIN_MS = 60_000;

// A theme picker for one alarm. Non-default themes only — the synthetic
// "Default" option already represents the seeded default theme record, so
// listing it too would show two functionally-identical entries (see
// ensureDefaultTheme in storage.js).
function ThemeSelect({ themes, value, onChange }) {
  return (
    <select style={t.input} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Default</option>
      {themes.filter((th) => !th.isDefault).map((th) => (
        <option key={th.id} value={th.id}>{th.name}</option>
      ))}
    </select>
  );
}

export default function StepEditor({ engine, recipe, step, onDone, onDeleted }) {
  const { app, openRecipes } = engine;
  const hasRunningInstance = (openRecipes.find((r) => r.recipe.id === recipe.id)?.instances ?? []).some(
    (i) => i.stepId === step.id && i.status !== "completed"
  );
  const [name, setName] = useState(step.name);
  const [description, setDescription] = useState(step.description);
  const [durationKind, setDurationKind] = useState(step.duration?.kind ?? "none");
  const [durationMin, setDurationMin] = useState(step.duration ? step.duration.ms / MIN_MS : 30);
  const [tempBandOn, setTempBandOn] = useState(!!step.tempBand);
  const [lowC, setLowC] = useState(step.tempBand?.lowC ?? 20);
  const [highC, setHighC] = useState(step.tempBand?.highC ?? 30);
  const [bandMinTheme, setBandMinTheme] = useState(step.bandMinAlarm?.theme ?? null);
  const [bandMaxTheme, setBandMaxTheme] = useState(step.bandMaxAlarm?.theme ?? null);
  const [durationReachedOn, setDurationReachedOn] = useState(!!step.durationReachedAlarm?.enabled);
  const [durationReachedTheme, setDurationReachedTheme] = useState(step.durationReachedAlarm?.theme ?? null);
  const [timeAlarms, setTimeAlarms] = useState(step.timeAlarms);
  const [tempAlarms, setTempAlarms] = useState(step.tempAlarms);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [themes, setThemes] = useState([]);
  useEffect(() => {
    app.store.listAlarmThemes().then(setThemes);
  }, [app]);

  const addTimeAlarm = () =>
    setTimeAlarms([...timeAlarms, { id: crypto.randomUUID(), name: "", atMs: 5 * MIN_MS, repeat: false, intervalMs: null, theme: null }]);
  const updateTimeAlarm = (i, patch) => setTimeAlarms(timeAlarms.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const removeTimeAlarm = (i) => setTimeAlarms(timeAlarms.filter((_, j) => j !== i));

  const addTempAlarm = () =>
    setTempAlarms([...tempAlarms, { id: crypto.randomUUID(), name: "", thresholdC: 30, direction: "heating", theme: null }]);
  const updateTempAlarm = (i, patch) => setTempAlarms(tempAlarms.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const removeTempAlarm = (i) => setTempAlarms(tempAlarms.filter((_, j) => j !== i));

  const save = async () => {
    setError(null);
    const duration = durationKind === "none" ? null : { ms: Math.round(durationMin * MIN_MS), kind: durationKind };
    const tempBand = tempBandOn ? { lowC: Number(lowC), highC: Number(highC) } : null;
    const updatedStep = {
      ...step,
      name,
      description,
      duration,
      tempBand,
      durationReachedAlarm: duration ? { enabled: durationReachedOn, theme: durationReachedTheme } : null,
      bandMinAlarm: { theme: bandMinTheme },
      bandMaxAlarm: { theme: bandMaxTheme },
      timeAlarms,
      tempAlarms,
    };
    try {
      await app.updateRecipe(recipe.id, {
        steps: recipe.steps.map((s) => (s.id === step.id ? updatedStep : s)),
      });
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };

  const del = async () => {
    await app.updateRecipe(recipe.id, { steps: recipe.steps.filter((s) => s.id !== step.id) });
    // Not onDone(): this step no longer exists, so re-rendering the
    // (now-gone) step view would strand the user on a dead-end screen.
    onDeleted();
  };

  return (
    <div style={t.page}>
      <div style={t.iconRow}>
        <button style={t.iconButton} title="Cancel" onClick={onDone}>✕</button>
        <div style={t.spacer} />
        <button style={t.iconButton} title="Save" onClick={save}>✓</button>
      </div>

      <div style={{ padding: "0 16px" }}>
        <label style={t.label}>Name</label>
        <input style={t.input} value={name} onChange={(e) => setName(e.target.value)} />

        <label style={t.label}>Description</label>
        <textarea style={{ ...t.input, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} />

        <label style={t.label}>Duration</label>
        <select style={t.input} value={durationKind} onChange={(e) => setDurationKind(e.target.value)}>
          <option value="none">None</option>
          <option value="fixed">Fixed length</option>
          <option value="inBand">In temperature band</option>
        </select>
        {durationKind !== "none" && (
          <div style={{ marginTop: 6 }}>
            <input style={{ ...t.input, width: 100 }} type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} /> minutes
          </div>
        )}

        <label style={t.label}>
          <input type="checkbox" checked={tempBandOn} onChange={(e) => setTempBandOn(e.target.checked)} /> Temperature band
        </label>
        {tempBandOn && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...t.input, width: 80 }} type="number" value={lowC} onChange={(e) => setLowC(e.target.value)} />
            <span>to</span>
            <input style={{ ...t.input, width: 80 }} type="number" value={highC} onChange={(e) => setHighC(e.target.value)} />
            <span>°C</span>
          </div>
        )}
        {tempBandOn && (
          <div style={{ ...t.card, margin: "8px 0" }}>
            <p style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 0 }}>
              A band always carries two automatic alarms — cooling below {lowC}°C, heating above {highC}°C.
            </p>
            <label style={t.label}>Below-band alarm theme</label>
            <ThemeSelect themes={themes} value={bandMinTheme} onChange={setBandMinTheme} />
            <label style={t.label}>Above-band alarm theme</label>
            <ThemeSelect themes={themes} value={bandMaxTheme} onChange={setBandMaxTheme} />
          </div>
        )}
        {durationKind === "inBand" && !tempBandOn && (
          <p style={t.errorText}>An "in temperature band" duration needs a temperature band.</p>
        )}

        {durationKind !== "none" && (
          <>
            <label style={{ ...t.label, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={durationReachedOn} onChange={(e) => setDurationReachedOn(e.target.checked)} /> Duration-reached alarm
            </label>
            {durationReachedOn && <ThemeSelect themes={themes} value={durationReachedTheme} onChange={setDurationReachedTheme} />}
          </>
        )}

        <label style={t.label}>Time alarms</label>
        {timeAlarms.map((a, i) => (
          <div key={a.id} style={{ ...t.card, margin: "0 0 8px" }}>
            <input style={t.input} placeholder="Name" value={a.name} onChange={(e) => updateTimeAlarm(i, { name: e.target.value })} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <input
                style={{ ...t.input, width: 80 }}
                type="number"
                min={0}
                value={a.atMs / MIN_MS}
                onChange={(e) => updateTimeAlarm(i, { atMs: Number(e.target.value) * MIN_MS })}
              />
              <span>min into the step</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <input type="checkbox" checked={a.repeat} onChange={(e) => updateTimeAlarm(i, { repeat: e.target.checked, intervalMs: e.target.checked ? a.intervalMs ?? 5 * MIN_MS : null })} />
              Repeating
            </label>
            {a.repeat && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <input
                  style={{ ...t.input, width: 80 }}
                  type="number"
                  min={1}
                  value={a.intervalMs / MIN_MS}
                  onChange={(e) => updateTimeAlarm(i, { intervalMs: Number(e.target.value) * MIN_MS })}
                />
                <span>min interval</span>
              </div>
            )}
            <label style={{ ...t.label, marginTop: 6 }}>Alarm theme</label>
            <ThemeSelect themes={themes} value={a.theme} onChange={(theme) => updateTimeAlarm(i, { theme })} />
            <button style={{ ...t.smallButton, marginTop: 8 }} onClick={() => removeTimeAlarm(i)}>Remove</button>
          </div>
        ))}
        <button style={t.smallButton} onClick={addTimeAlarm}>+ Add time alarm</button>

        <label style={t.label}>Temperature alarms</label>
        {tempAlarms.map((a, i) => (
          <div key={a.id} style={{ ...t.card, margin: "0 0 8px" }}>
            <input style={t.input} placeholder="Name" value={a.name} onChange={(e) => updateTempAlarm(i, { name: e.target.value })} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <input style={{ ...t.input, width: 80 }} type="number" value={a.thresholdC} onChange={(e) => updateTempAlarm(i, { thresholdC: Number(e.target.value) })} />
              <span>°C</span>
              <select style={t.input} value={a.direction} onChange={(e) => updateTempAlarm(i, { direction: e.target.value })}>
                <option value="heating">Heating</option>
                <option value="cooling">Cooling</option>
              </select>
            </div>
            <label style={{ ...t.label, marginTop: 6 }}>Alarm theme</label>
            <ThemeSelect themes={themes} value={a.theme} onChange={(theme) => updateTempAlarm(i, { theme })} />
            <button style={{ ...t.smallButton, marginTop: 8 }} onClick={() => removeTempAlarm(i)}>Remove</button>
          </div>
        ))}
        <button style={t.smallButton} onClick={addTempAlarm}>+ Add temperature alarm</button>

        {error && <p style={t.errorText}>{error}</p>}

        <div style={{ marginTop: 24, marginBottom: 24 }}>
          {hasRunningInstance ? (
            <p style={{ fontSize: 13, color: t.colors.textMuted }}>
              This step can't be deleted while it has a running instance.
            </p>
          ) : !deleteConfirm ? (
            <button style={t.dangerButton} onClick={() => setDeleteConfirm(true)}>Delete step</button>
          ) : (
            <div>
              <p style={{ fontSize: 13 }}>Delete this step?</p>
              <button style={t.secondaryButton} onClick={() => setDeleteConfirm(false)}>Cancel</button>{" "}
              <button style={t.dangerButton} onClick={del}>Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
