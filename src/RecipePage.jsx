import { useEffect, useState } from "react";
import RecipeEditor from "./RecipeEditor.jsx";
import * as t from "./theme.js";

export default function RecipePage({ engine, recipeId, initialEditing, navigate }) {
  const { app, refresh, openRecipes, latestSample, connectionState, connectThermometer, disconnectThermometer } = engine;
  const [editing, setEditing] = useState(!!initialEditing);

  const entry = openRecipes.find((r) => r.recipe.id === recipeId);

  // The recipe may not be in `openRecipes` yet on the very first render after
  // navigation (refresh() is async) — refetch directly rather than blocking.
  const [fallbackRecipe, setFallbackRecipe] = useState(null);
  useEffect(() => {
    if (!entry) app.getRecipe(recipeId).then(setFallbackRecipe);
  }, [entry, recipeId, app]);

  const recipe = entry?.recipe ?? fallbackRecipe;
  if (!recipe) return <div style={t.page}>Loading…</div>;

  if (editing) {
    return (
      <RecipeEditor
        engine={engine}
        recipe={recipe}
        onDone={async () => {
          await refresh();
          setEditing(false);
        }}
      />
    );
  }

  const instances = entry?.instances ?? [];
  const instancesByStep = {};
  for (const instance of instances) {
    if (instance.status === "completed") continue;
    (instancesByStep[instance.stepId] ??= []).push(instance);
  }

  return (
    <div style={t.page}>
      <div style={t.iconRow}>
        <button style={t.iconButton} title="Menu (settings — coming soon)">☰</button>
        <button style={t.iconButton} title="Home" onClick={() => navigate({ view: "home" })}>⌂</button>
        <button style={t.iconButton} title="Edit" onClick={() => setEditing(true)}>✎</button>
        <div style={t.spacer} />
        <button
          style={t.iconButton}
          title="Connect to thermometer"
          onClick={connectionState === "connected" ? disconnectThermometer : connectThermometer}
        >
          {connectionState === "connected" ? "🔵" : connectionState === "disconnected" ? "⚪" : "🟡"}
        </button>
      </div>

      {latestSample && (
        <div style={{ padding: "10px 16px", fontSize: 14, color: t.colors.textMuted }}>
          Current temperature: {latestSample.tempC == null ? "no data" : `${latestSample.tempC.toFixed(1)}°C`}
        </div>
      )}

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
          <h4 style={{ marginTop: 0 }}>Ingredients</h4>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <tbody>
              {recipe.ingredients.map((ing, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 0" }}>{ing.name}</td>
                  <td style={{ padding: "4px 0", textAlign: "right", color: t.colors.textMuted }}>{ing.quantity} {ing.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 style={{ padding: "0 16px" }}>Steps</h4>
      {recipe.steps.length === 0 && <p style={{ padding: "0 16px", color: t.colors.textMuted }}>No steps yet — tap ✎ to add one.</p>}
      {recipe.steps.map((step) => {
        const running = instancesByStep[step.id] ?? [];
        return (
          <div
            key={step.id}
            style={{ ...t.card, cursor: "pointer" }}
            onClick={() => navigate({ view: "step", recipeId: recipe.id, stepId: step.id })}
          >
            <div style={{ fontWeight: 700 }}>{step.name}</div>
            <div style={{ ...t.clamp(2), fontSize: 13, color: t.colors.textMuted }}>{step.description}</div>
            <div style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 4 }}>
              {step.duration ? `${step.duration.kind === "fixed" ? "Fixed" : "In temperature band"} duration` : "No duration"}
              {step.tempBand ? ` · ${step.tempBand.lowC}–${step.tempBand.highC}°C` : ""}
              {running.length > 0 ? ` · ${running.length} in progress` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
