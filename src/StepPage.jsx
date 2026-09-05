import { useEffect, useState } from "react";
import StepEditor from "./StepEditor.jsx";
import CurrentTemperatureLine from "./CurrentTemperatureLine.jsx";
import { buildStepAlarmDefs } from "./lib/recipe.js";
import { computeStepProgress, progressBarStyle, provenanceLabel, describeStepAlarms } from "./stepDisplay.js";
import { elapsedRunningMs } from "./lib/instances.js";
import { formatDuration } from "./lib/format.js";
import { useBackDismiss } from "./useBackDismiss.js";
import * as t from "./theme.js";

export default function StepPage({ engine, recipeId, stepId, navigate, onOpenMenu }) {
  const { app, refresh, openRecipes, claimHolderId, latestSample, connectionState, connectThermometer, disconnectThermometer, completeInstance, requestExtend } = engine;
  const [editing, setEditing] = useState(false);
  const [index, setIndex] = useState(0);
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
  const clampedIndex = Math.min(index, Math.max(0, instances.length - 1));
  const instance = instances[clampedIndex];
  const stepAlarmDefs = buildStepAlarmDefs(step);

  const stepIndex = recipe.steps.findIndex((s) => s.id === stepId);
  const prevStep = stepIndex > 0 ? recipe.steps[stepIndex - 1] : null;
  const nextStep = stepIndex < recipe.steps.length - 1 ? recipe.steps[stepIndex + 1] : null;

  const handleStart = async () => {
    await app.startInstance({ id: crypto.randomUUID(), recipeId, stepId, stepAlarmDefs, isFirstStep: stepIndex === 0 });
    await refresh();
  };
  const handlePauseResume = async () => {
    if (instance.status === "running") await app.pauseInstance(instance.id);
    else await app.resumeInstance(instance.id);
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
    await app.duplicateInstance(instance.id, crypto.randomUUID(), stepAlarmDefs);
    await refresh();
    setIndex(instances.length); // select the newly-created instance
  };
  const handleToggleClaim = async () => {
    await app.toggleClaim(instance.id);
    await refresh();
  };
  const commitTag = async () => {
    if (tagDraft !== null) {
      await app.setTag(instance.id, tagDraft);
      await refresh();
    }
    setTagDraft(null);
  };

  const claimed = !!instance && instance.id === claimHolderId;
  // Mirrors acquireClaimOnStart (instances.js): Start only auto-claims when
  // nothing currently holds it, so that's also when it's worth showing the
  // reading here ahead of starting.
  const wouldAutoClaim = !instance && claimHolderId == null;
  const progress = instance ? computeStepProgress(instance, step, engine, Date.now()) : null;
  // computeStepProgress only returns a figure when the step has a set
  // duration — spec: no progress bar at all without one. A running instance
  // still has a real elapsed time even so; show that on its own, with no
  // bar and no remaining/provenance since there's no duration to base them on.
  const elapsedOnlyMs = !progress && instance ? elapsedRunningMs(instance, Date.now()) : null;
  const alarmLines = describeStepAlarms(step);

  return (
    <div style={t.page}>
      <div style={t.iconRow}>
        <button style={t.iconButton} title="Home" onClick={() => navigate({ view: "home" })}>⌂</button>
        <button style={t.iconButton} title="Back" onClick={() => navigate({ view: "recipe", recipeId })}>←</button>
        <button style={t.iconButton} title="Edit" onClick={() => setEditing(true)}>✎</button>
        {instance && (
          <button
            style={{ ...t.iconButton, background: claimed ? "rgba(255,255,255,0.35)" : "transparent", borderRadius: 8 }}
            title={claimed ? "Release thermometer claim" : "Claim thermometer for this step"}
            onClick={handleToggleClaim}
          >
            🌡️
          </button>
        )}
        <button style={t.iconButton} title="Menu" onClick={onOpenMenu}>☰</button>
        <div style={t.spacer} />
        <button
          style={t.iconButton}
          title="Connect to thermometer"
          onClick={connectionState === "connected" ? disconnectThermometer : connectThermometer}
        >
          {connectionState === "connected" ? "🔵" : connectionState === "disconnected" ? "⚪" : "🟡"}
        </button>
      </div>

      {connectionState === "connected" && (claimed || wouldAutoClaim) && latestSample && <CurrentTemperatureLine sample={latestSample} />}

      {instances.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: 8 }}>
          <button style={t.smallButton} disabled={clampedIndex === 0} onClick={() => setIndex(clampedIndex - 1)}>←</button>
          <span style={{ fontSize: 13, color: t.colors.textMuted }}>{clampedIndex + 1} of {instances.length}</span>
          <button style={t.smallButton} disabled={clampedIndex === instances.length - 1} onClick={() => setIndex(clampedIndex + 1)}>→</button>
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        <h1 style={{ marginBottom: 4 }}>{step.name}</h1>
        <p style={{ color: t.colors.textMuted }}>{step.description}</p>
        <p style={{ fontSize: 12, color: t.colors.textMuted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>
            {step.duration
              ? `${step.duration.kind === "fixed" ? "Fixed" : "In temperature band"} duration — ${formatDuration(step.duration.ms)}`
              : "No set duration"}
            {step.tempBand ? ` · Band ${step.tempBand.lowC}–${step.tempBand.highC}°C` : ""}
            {instance?.durationExtensionMs > 0 ? ` · +${formatDuration(instance.durationExtensionMs)} extended` : ""}
          </span>
          {step.duration && instance && (
            <button style={t.smallButton} onClick={() => requestExtend(instance.id)}>Extend</button>
          )}
        </p>

        {progress && (
          <div style={{ margin: "12px 0" }}>
            <div style={{ height: 10, borderRadius: 5, background: t.colors.border, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progress.fraction * 100}%`,
                  background: progressBarStyle(progress.provenance, t.colors).fillStyle,
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: t.colors.textMuted, marginTop: 4 }}>
              {progress.elapsedLabel} elapsed{progress.latchedEstimate ? " ≈" : ""} · {progress.remainingLabel} remaining
              {provenanceLabel(progress.provenance) ? ` — ${provenanceLabel(progress.provenance)}` : ""}
            </div>
          </div>
        )}

        {elapsedOnlyMs != null && (
          <p style={{ fontSize: 13, color: t.colors.textMuted, margin: "12px 0" }}>{formatDuration(elapsedOnlyMs)} elapsed</p>
        )}

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
              <button style={t.primaryButton} onClick={handleStart}>Start</button>
              <button
                style={{ ...t.smallButton, ...(nextStep ? null : t.disabledButton) }}
                disabled={!nextStep}
                onClick={() => nextStep && navigate({ view: "step", recipeId, stepId: nextStep.id })}
              >
                Next
              </button>
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
    </div>
  );
}
