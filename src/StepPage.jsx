import { useEffect, useState } from "react";
import StepEditor from "./StepEditor.jsx";
import CurrentTemperatureLine from "./CurrentTemperatureLine.jsx";
import { ProbesButton, ProbeChooser } from "./ProbeUi.jsx";
import StepTimers from "./StepTimers.jsx";
import TemperatureGraph from "./TemperatureGraph.jsx";
import { buildStepAlarmDefs, durationKindLabel } from "./lib/recipe.js";
import { computeStepProgress, progressBarStyle, provenanceLabel, describeStepAlarms, stepTimers, liveReading } from "./stepDisplay.js";
import { canStartInBandManually } from "./lib/instances.js";
import { formatDuration } from "./lib/format.js";
import { useBackDismiss } from "./useBackDismiss.js";
import * as t from "./theme.js";

export default function StepPage({ engine, recipeId, stepId, initialInstanceId, navigate, onOpenMenu, onOpenProbes }) {
  const { app, refresh, openRecipes, completeInstance, requestExtend } = engine;
  const [editing, setEditing] = useState(false);
  const [choosingProbe, setChoosingProbe] = useState(false);
  // Which running copy is shown, when there are several. Opened from a
  // particular copy's row (Home / Recipe page) it starts on that copy; the
  // ← → arrows take over from there.
  const [index, setIndexRaw] = useState(0);
  const [preferredId, setPreferredId] = useState(initialInstanceId ?? null);
  const setIndex = (i) => {
    setPreferredId(null);
    setIndexRaw(i);
  };
  const [tagDraft, setTagDraft] = useState(null);
  const closeEditor = async () => {
    await refresh();
    setEditing(false);
  };
  // Hardware back closes the editor exactly like its own ✕ would.
  useBackDismiss(editing, closeEditor);

  const entry = openRecipes.find((r) => r.recipe.id === recipeId);

  // Same "loading vs. genuinely gone" distinction as RecipePage — without it,
  // a deleted recipe left this page stuck on "Loading…" forever with no way
  // back to Home.
  const [fallbackChecked, setFallbackChecked] = useState(false);
  const [fallbackMissing, setFallbackMissing] = useState(false);
  useEffect(() => {
    if (entry) return;
    setFallbackChecked(false);
    app.getRecipe(recipeId).then((r) => {
      setFallbackMissing(!r);
      setFallbackChecked(true);
    });
  }, [entry, recipeId, app]);

  if (!entry) {
    if (fallbackChecked && fallbackMissing) {
      return (
        <div style={t.page}>
          <p style={{ padding: 16 }}>This recipe no longer exists.</p>
          <button style={{ ...t.primaryButton, margin: "0 16px" }} onClick={() => navigate({ view: "home" })}>Go home</button>
        </div>
      );
    }
    return <div style={t.page}>Loading…</div>;
  }

  const { recipe } = entry;
  const step = recipe.steps.find((s) => s.id === stepId);
  if (!step) {
    return (
      <div style={t.page}>
        <p style={{ padding: 16 }}>This step no longer exists.</p>
        <button style={{ ...t.primaryButton, margin: "0 16px" }} onClick={() => navigate({ view: "recipe", recipeId })}>Back to recipe</button>
      </div>
    );
  }

  if (editing) {
    return (
      <StepEditor
        engine={engine}
        recipe={recipe}
        step={step}
        onDone={closeEditor}
        onDeleted={() => navigate({ view: "recipe", recipeId })}
      />
    );
  }

  const instances = entry.instances.filter((i) => i.stepId === stepId && i.status !== "completed");
  const preferredIndex = preferredId ? instances.findIndex((i) => i.id === preferredId) : -1;
  const clampedIndex = preferredIndex >= 0 ? preferredIndex : Math.min(index, Math.max(0, instances.length - 1));
  const instance = instances[clampedIndex];
  const stepAlarmDefs = buildStepAlarmDefs(step);

  const stepIndex = recipe.steps.findIndex((s) => s.id === stepId);
  const prevStep = stepIndex > 0 ? recipe.steps[stepIndex - 1] : null;
  const nextStep = stepIndex < recipe.steps.length - 1 ? recipe.steps[stepIndex + 1] : null;
  // A tally mark means this step has been done (since the tallies were last
  // cleared), so moving on is the likely next action, not starting it again:
  // Next — or, on the last step, Complete recipe — becomes the main button.
  const tallied = (entry.completionTicks?.[stepId] ?? 0) > 0;
  // "Complete recipe" does exactly what the Recipe page's "Complete this
  // recipe" does, confirm included — so it goes there and opens that
  // confirm. With nothing running there is nothing to complete (that button
  // is disabled then), so it just goes back to the recipe.
  const completeRecipeFromStep = () =>
    navigate({ view: "recipe", recipeId, confirmComplete: entry.instances.length > 0 });

  const handleStart = async () => {
    await app.startInstance({ id: crypto.randomUUID(), recipeId, stepId, stepAlarmDefs, isFirstStep: stepIndex === 0, freeProbeIds: engine.freeConnectedProbeIds() });
    await refresh();
  };
  const handlePauseResume = async () => {
    if (instance.status === "running") await app.pauseInstance(instance.id);
    else await app.resumeInstance(instance.id);
    await refresh();
  };
  const handleStartInBand = async () => {
    await app.startInBandManually(instance.id);
    await refresh();
  };
  const handleRestart = async () => {
    await app.restartInstance(instance.id, stepAlarmDefs);
    await refresh();
  };
  const handleComplete = async () => {
    await completeInstance(instance.id); // also silences any alarms still sounding
  };
  const handleDuplicate = async () => {
    await app.duplicateInstance(instance.id, crypto.randomUUID(), stepAlarmDefs, engine.freeConnectedProbeIds());
    await refresh();
    setIndex(instances.length); // select the newly-created instance
  };
  const commitTag = async () => {
    if (tagDraft !== null) {
      await app.setTag(instance.id, tagDraft);
      await refresh();
    }
    setTagDraft(null);
  };

  // The probe this instance uses — or, before Start, the one Start would
  // automatically assign (autoAssignOnStart: exactly one free connected
  // probe), so its reading is worth showing ahead of starting.
  const bound = instance ? engine.probeFor(instance.id) : null;
  const freeIds = engine.freeConnectedProbeIds();
  const lineProbe = bound ? bound.probe : !instance && freeIds.length === 1 ? engine.probes.find((p) => p.id === freeIds[0]) : null;
  const progress = instance ? computeStepProgress(instance, step, engine, Date.now()) : null;
  // computeStepProgress only returns a figure when the step has a set
  // duration — spec: no progress bar at all without one. A running instance
  // still has real timers even so; they show on their own, with no bar and
  // no remaining/provenance since there's no duration to base them on.
  const timers = instance ? stepTimers(instance, step, Date.now()) : null;
  const alarmLines = describeStepAlarms(step);

  return (
    <div style={t.page}>
      <div style={t.iconRow}>
        <button style={t.iconButton} title="Home" onClick={() => navigate({ view: "home" })}>⌂</button>
        <button style={t.iconButton} title="Edit" onClick={() => setEditing(true)}>✎</button>
        {instance && (
          <button
            style={{ ...t.iconButton, background: bound ? "rgba(255,255,255,0.35)" : "transparent", borderRadius: 8 }}
            title={bound ? `Using ${bound.probe.name} — change probe` : "Choose a probe for this step"}
            onClick={() => setChoosingProbe(true)}
          >
            🌡️
          </button>
        )}
        <button style={t.iconButton} title="Menu" onClick={onOpenMenu}>☰</button>
        <div style={t.spacer} />
        <ProbesButton engine={engine} onOpen={onOpenProbes} />
      </div>

      {lineProbe?.connected && <CurrentTemperatureLine sample={lineProbe.sample} probeName={lineProbe.name} />}

      {instances.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: 8 }}>
          <button style={t.smallButton} disabled={clampedIndex === 0} onClick={() => setIndex(clampedIndex - 1)}>←</button>
          <span style={{ fontSize: 13, color: t.colors.textMuted }}>{clampedIndex + 1} of {instances.length}</span>
          <button style={t.smallButton} disabled={clampedIndex === instances.length - 1} onClick={() => setIndex(clampedIndex + 1)}>→</button>
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20, cursor: "pointer" }}
          onClick={() => navigate({ view: "recipe", recipeId })}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: t.colors.text }}>←</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: t.colors.textMuted }}>{recipe.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <h1 style={{ margin: 0 }}>{step.name}</h1>
          <span style={{ fontSize: 16, color: t.colors.text }}>step {stepIndex + 1} of {recipe.steps.length}</span>
        </div>
        <p style={{ color: t.colors.textMuted }}>{step.description}</p>
        <p style={{ fontSize: 12, color: t.colors.textMuted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>
            {step.duration ? `${durationKindLabel(step.duration.kind)} — ${formatDuration(step.duration.ms)}` : "No set duration"}
            {step.tempBand ? ` · Band ${step.tempBand.lowC}–${step.tempBand.highC}°C` : ""}
            {instance?.durationExtensionMs > 0 ? ` · +${formatDuration(instance.durationExtensionMs)} extended` : ""}
          </span>
          {step.duration && instance && (
            <button style={t.smallButton} onClick={() => requestExtend(instance.id)}>Extend</button>
          )}
        </p>

        {progress && (
          <div style={{ margin: "12px 0" }}>
            <div style={{ height: 10, borderRadius: 5, background: progressBarStyle(progress.provenance, t.colors).trackStyle, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progress.fraction * 100}%`,
                  background: progressBarStyle(progress.provenance, t.colors).fillStyle,
                }}
              />
            </div>
            <StepTimers timers={timers} style={{ fontSize: 13, color: t.colors.textMuted, marginTop: 4 }}>
              {" · "}
              {progress.remainingLabel}{" "}
              {progress.remainingMs < 0 ? (
                // Past the duration: the alarm may already be silenced, but
                // the clock keeps running until Complete — this is the only
                // remaining cue that it's still counting.
                <b style={{ color: t.colors.accentRed }}>extra time</b>
              ) : (
                "remaining"
              )}
              {provenanceLabel(progress.provenance, { manual: progress.manualInBand }) ? ` — ${provenanceLabel(progress.provenance, { manual: progress.manualInBand })}` : ""}
            </StepTimers>
          </div>
        )}

        {timers && !progress && <StepTimers timers={timers} style={{ fontSize: 13, color: t.colors.textMuted, margin: "12px 0" }} />}

        {instance && canStartInBandManually(instance, step, liveReading(instance, engine, Date.now()).measured) && (
          // For a step watched on a thermometer the app can't read (or with
          // no probe at all): nothing will ever arrive to say "in band", so
          // the user says it. Real readings, if any arrive, take over again.
          <div style={{ margin: "4px 0 12px" }}>
            <button style={t.secondaryButton} onClick={handleStartInBand}>Start in-band timer</button>
            <div style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 4 }}>
              No temperature data. If your own thermometer shows it's in the band, start the in-band timer by hand.
            </div>
          </div>
        )}

        {instance && (() => {
          const now = Date.now();
          const live = liveReading(instance, engine, now);
          return (
            <TemperatureGraph
              history={engine.graphFor(instance.id)}
              startedAt={instance.startedAt}
              step={step}
              liveTempC={live.measured ? live.latestSample.tempC : null}
              now={now}
            />
          );
        })()}

        {alarmLines.length > 0 && (
          <div style={{ margin: "12px 0" }}>
            <h4 style={{ marginBottom: 4 }}>Alarms</h4>
            {alarmLines.map((line) => (
              <p key={line.id} style={{ fontSize: 13, margin: "4px 0" }}>{line.text}</p>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "16px 0" }}>
          {!instance && (
            <>
              <button
                style={{ ...t.smallButton, ...(prevStep ? null : t.disabledButton) }}
                disabled={!prevStep}
                onClick={() => prevStep && navigate({ view: "step", recipeId, stepId: prevStep.id })}
              >
                Previous
              </button>
              <button style={tallied ? t.smallButton : t.primaryButton} onClick={handleStart}>Start</button>
              {nextStep ? (
                <button style={tallied ? t.primaryButton : t.smallButton} onClick={() => navigate({ view: "step", recipeId, stepId: nextStep.id })}>
                  Next
                </button>
              ) : (
                <button style={tallied ? t.primaryButton : t.smallButton} onClick={completeRecipeFromStep}>
                  Complete recipe
                </button>
              )}
            </>
          )}
          {instance && (
            <>
              <button style={t.smallButton} onClick={handlePauseResume}>
                {instance.status === "running" ? "Pause" : "Resume"}
              </button>
              <button style={t.smallButton} onClick={handleRestart}>Restart</button>
              <button style={t.primaryButton} onClick={handleComplete}>Complete</button>
              <button style={t.smallButton} onClick={handleDuplicate}>Duplicate</button>
            </>
          )}
        </div>

        {instance && (
          <div>
            <label style={t.label}>Tag</label>
            <input
              style={t.input}
              value={tagDraft ?? instance.tag ?? ""}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={commitTag}
              placeholder="e.g. Loaf 1"
            />
          </div>
        )}
      </div>
      {choosingProbe && instance && (
        <ProbeChooser engine={engine} instanceId={instance.id} onClose={() => setChoosingProbe(false)} onOpenProbes={onOpenProbes} />
      )}
    </div>
  );
}
