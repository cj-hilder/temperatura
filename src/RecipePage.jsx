import { useEffect, useState } from "react";
import RecipeEditor from "./RecipeEditor.jsx";
import { ProbesButton, ProbeTemperatureLines } from "./ProbeUi.jsx";
import { formatDuration } from "./lib/format.js";
import { durationKindLabel } from "./lib/recipe.js";
import InstanceRow from "./InstanceRow.jsx";
import JournalPage from "./JournalPage.jsx";
import { parseQuantity, scaleQuantity, formatQuantity } from "./lib/quantity.js";
import { useBackDismiss } from "./useBackDismiss.js";
import * as t from "./theme.js";

export default function RecipePage({ engine, recipeId, initialEditing, initialCompleteConfirm, navigate, onOpenMenu, onOpenProbes }) {
  const { app, refresh, openRecipes, completeRecipe } = engine;
  const [editing, setEditing] = useState(!!initialEditing);
  // Opened already showing the confirm when the step page's "Complete
  // recipe" sent us here (StepPage only asks when something is running).
  const [completeConfirm, setCompleteConfirm] = useState(!!initialCompleteConfirm);
  // A full-screen dialog, so back cancels it like every other overlay —
  // never confirms it.
  useBackDismiss(completeConfirm, () => setCompleteConfirm(false));
  const [journalOpen, setJournalOpen] = useState(false);
  const [recordedAt, setRecordedAt] = useState(null); // "Recorded" confirmation
  const closeEditor = async () => {
    await refresh();
    setEditing(false);
  };
  // Hardware back closes the editor exactly like its own ✕ would.
  useBackDismiss(editing, closeEditor);

  // Per-recipe, transient, and never part of the recipe's own data (see
  // app.js's getIngredientsMultiplier) — loaded separately rather than
  // riding along with the recipe record itself. Draft/commit-on-blur follows
  // the same pattern as StepPage's tag input, so a half-typed "0." isn't
  // clobbered by a re-render before the user finishes.
  const [multiplier, setMultiplier] = useState(1);
  const [multiplierDraft, setMultiplierDraft] = useState(null);
  useEffect(() => {
    app.getIngredientsMultiplier(recipeId).then(setMultiplier);
  }, [app, recipeId]);
  const commitMultiplier = async () => {
    if (multiplierDraft !== null) {
      const parsed = Number(multiplierDraft);
      if (Number.isFinite(parsed) && parsed > 0) {
        await app.setIngredientsMultiplier(recipeId, parsed);
        setMultiplier(parsed);
      }
    }
    setMultiplierDraft(null);
  };

  const entry = openRecipes.find((r) => r.recipe.id === recipeId);

  // The recipe may not be in `openRecipes` yet on the very first render after
  // navigation (refresh() is async) — refetch directly rather than blocking.
  // Distinguish "haven't checked yet" (still null, keep showing Loading) from
  // "checked and it's genuinely gone" (checkedFallback flips true even when
  // the fetch resolves to nothing) — without that distinction, a deleted
  // recipe left `recipe` falsy forever and stranded the page on "Loading…"
  // with no way back to Home.
  const [fallbackRecipe, setFallbackRecipe] = useState(null);
  const [checkedFallback, setCheckedFallback] = useState(false);
  useEffect(() => {
    if (entry) return;
    setCheckedFallback(false);
    app.getRecipe(recipeId).then((r) => {
      setFallbackRecipe(r ?? null);
      setCheckedFallback(true);
    });
  }, [entry, recipeId, app]);

  const recipe = entry?.recipe ?? fallbackRecipe;
  if (!recipe) {
    if (!checkedFallback) return <div style={t.page}>Loading…</div>;
    return (
      <div style={t.page}>
        <p style={{ padding: 16 }}>This recipe no longer exists.</p>
        <button style={{ ...t.primaryButton, margin: "0 16px" }} onClick={() => navigate({ view: "home" })}>Go home</button>
      </div>
    );
  }

  if (editing) {
    return (
      <RecipeEditor
        engine={engine}
        recipe={recipe}
        onDone={closeEditor}
        onDeleted={() => navigate({ view: "home" })}
      />
    );
  }

  const instances = entry?.instances ?? [];
  const instancesByStep = {};
  for (const instance of instances) {
    if (instance.status === "completed") continue;
    (instancesByStep[instance.stepId] ??= []).push(instance);
  }
  const completionTicks = entry?.completionTicks ?? {};
  const hasAnyTicks = Object.values(completionTicks).some((n) => n > 0);

  const handleClearTallies = async () => {
    await app.clearCompletionTicks(recipe.id);
    await refresh();
  };
  const handleCompleteRecipe = async () => {
    await completeRecipe(recipe.id);
    setCompleteConfirm(false);
  };

  return (
    <div style={t.page}>
      <div style={t.iconRow}>
        <button style={t.iconButton} title="Home" onClick={() => navigate({ view: "home" })}>⌂</button>
        <button style={t.iconButton} title="Edit" onClick={() => setEditing(true)}>✎</button>
        <button style={t.iconButton} title="Menu" onClick={onOpenMenu}>☰</button>
        <div style={t.spacer} />
        <ProbesButton engine={engine} onOpen={onOpenProbes} />
      </div>

      <ProbeTemperatureLines engine={engine} />

      <div style={{ padding: "0 16px" }}>
        <h1 style={{ marginBottom: 4 }}>{recipe.name}</h1>
        <p style={{ color: t.colors.textMuted }}>{recipe.description}</p>
        {recipe.servings && <p style={{ fontSize: 13 }}>Servings: {recipe.servings}</p>}
        {recipe.notes.length > 0 && (
          <div>
            <h4 style={{ marginBottom: 4 }}>Notes</h4>
            <ul>{recipe.notes.map((n, i) => <li key={i} style={{ fontSize: 13 }}>{n}</li>)}</ul>
          </div>
        )}
      </div>

      {recipe.ingredients.length > 0 && (
        <div style={t.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0 }}>Ingredients</h4>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: t.colors.textMuted }}>
              ×
              <input
                style={{ ...t.input, width: 56, padding: "4px 6px" }}
                value={multiplierDraft ?? multiplier}
                onChange={(e) => setMultiplierDraft(e.target.value)}
                onBlur={commitMultiplier}
                title="Ingredients multiplier — scales the quantities below, for this recipe only. Not saved as part of the recipe."
              />
            </label>
          </div>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <tbody>
              {recipe.ingredients.map((ing, i) => {
                const scaled = formatQuantity(scaleQuantity(parseQuantity(ing.quantity), multiplier, { sixths: engine.sixthsAndTwelfths }));
                return (
                  <tr key={i}>
                    <td style={{ padding: "4px 0" }}>{ing.name}</td>
                    <td style={{ padding: "4px 0", textAlign: "right", color: t.colors.textMuted }}>{scaled || ing.quantity} {ing.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h4 style={{ padding: "0 16px" }}>Steps</h4>
      {recipe.steps.length === 0 && <p style={{ padding: "0 16px", color: t.colors.textMuted }}>No steps yet — tap ✎ to add one.</p>}
      {recipe.steps.map((step) => {
        const running = instancesByStep[step.id] ?? [];
        const ticks = completionTicks[step.id] ?? 0;
        return (
          <div
            key={step.id}
            style={{ ...t.card, position: "relative", cursor: "pointer" }}
            onClick={() => navigate({ view: "step", recipeId: recipe.id, stepId: step.id })}
          >
            <div style={{ fontWeight: 700 }}>{step.name}</div>
            <div style={{ ...t.clamp(2), fontSize: 13, color: t.colors.textMuted }}>{step.description}</div>
            <div style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 4 }}>
              {step.duration
                ? `${durationKindLabel(step.duration.kind)} — ${formatDuration(step.duration.ms)}`
                : "No set duration"}
              {step.tempBand ? ` · ${step.tempBand.lowC}–${step.tempBand.highC}°C` : ""}
            </div>
            {running.map((instance) => (
              <InstanceRow
                key={instance.id}
                engine={engine}
                step={step}
                instance={instance}
                showStep={false}
                onOpen={() => navigate({ view: "step", recipeId: recipe.id, stepId: step.id, instanceId: instance.id })}
              />
            ))}
            {ticks > 0 && (
              <div
                title={`Completed ${ticks} time${ticks === 1 ? "" : "s"}`}
                style={{ position: "absolute", right: 10, bottom: 8, fontSize: 11, letterSpacing: 1, color: t.colors.textMuted }}
              >
                {"✓".repeat(ticks)}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "16px" }}>
        <button
          style={{ ...t.secondaryButton, ...(hasAnyTicks ? null : t.disabledButton) }}
          disabled={!hasAnyTicks}
          onClick={handleClearTallies}
        >
          Clear all tallies
        </button>
        <button
          style={t.secondaryButton}
          onClick={async () => {
            const entry = await app.recordJournal(recipe.id);
            setRecordedAt(entry.recordedAt);
          }}
        >
          Record in journal
        </button>
        <button style={t.secondaryButton} onClick={() => setJournalOpen(true)}>Journal</button>
        <button
          style={{ ...t.secondaryButton, ...(instances.length === 0 ? t.disabledButton : null) }}
          disabled={instances.length === 0}
          onClick={() => setCompleteConfirm(true)}
        >
          Complete this recipe
        </button>
      </div>

      {recordedAt && (
        <p style={{ fontSize: 12.5, color: t.colors.textMuted, padding: "0 16px", marginTop: -8 }}>
          Recorded in the journal ({new Date(recordedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}).
        </p>
      )}

      {journalOpen && (
        <JournalPage engine={engine} recipe={recipe} running={instances.length > 0} onClose={() => setJournalOpen(false)} />
      )}

      {completeConfirm && (
        <div style={t.overlay} onClick={() => setCompleteConfirm(false)}>
          <div style={{ ...t.overlayCard, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Complete this recipe?</h3>
            <p style={{ fontSize: 13.5, color: t.colors.textMuted }}>
              This will complete {instances.length} running step{instances.length === 1 ? "" : "s"}.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button style={{ ...t.secondaryButton, flex: 1 }} onClick={() => setCompleteConfirm(false)}>Cancel</button>
              <button style={{ ...t.dangerButton, flex: 1 }} onClick={handleCompleteRecipe}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
