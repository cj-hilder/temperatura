import { useEffect, useState } from "react";
import { createBlankRecipe } from "./lib/recipe.js";
import InstanceRow from "./InstanceRow.jsx";
import { FolderIcon, SearchIcon } from "./icons.jsx";
import { ProbesButton, ProbeTemperatureLines } from "./ProbeUi.jsx";
import { useBackDismiss } from "./useBackDismiss.js";
import * as t from "./theme.js";

export default function HomePage({ engine, navigate, onOpenMenu, onOpenProbes }) {
  const { app, refresh, openRecipes, closeRecipe } = engine;
  const [picker, setPicker] = useState(null); // null | "open" | "search"
  const [allRecipes, setAllRecipes] = useState([]);
  const [query, setQuery] = useState("");
  const [closeConfirmId, setCloseConfirmId] = useState(null);
  // Hardware back closes the open/search overlay exactly like its own Close would.
  useBackDismiss(!!picker, () => setPicker(null));

  useEffect(() => {
    if (picker) app.listRecipes().then(setAllRecipes);
  }, [picker, app]);

  const openIds = new Set(openRecipes.map((r) => r.recipe.id));

  const handleNew = async () => {
    const recipe = await app.createRecipe({ ...createBlankRecipe(crypto.randomUUID()), name: "New recipe" });
    await app.openRecipe(recipe.id);
    await refresh();
    navigate({ view: "recipe", recipeId: recipe.id, editing: true });
  };

  const handleOpenPicked = async (recipeId) => {
    await app.openRecipe(recipeId);
    await refresh();
    setPicker(null);
    navigate({ view: "recipe", recipeId });
  };

  const handleClose = async (recipeId) => {
    await closeRecipe(recipeId); // also silences any alarms still sounding
    setCloseConfirmId(null);
  };

  const filtered = allRecipes.filter((r) => {
    if (picker === "open") return !openIds.has(r.id);
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });

  return (
    <div style={t.page}>
      <div style={t.iconRow}>
        <button style={t.iconButton} title="Open a recipe" onClick={() => setPicker("open")}><FolderIcon /></button>
        <button style={t.iconButton} title="New recipe" onClick={handleNew}>＋</button>
        <button style={t.iconButton} title="Search" onClick={() => setPicker("search")}><SearchIcon /></button>
        <button style={t.iconButton} title="Menu" onClick={onOpenMenu}>☰</button>
        <div style={t.spacer} />
        <ProbesButton engine={engine} onOpen={onOpenProbes} />
      </div>

      <ProbeTemperatureLines engine={engine} />

      <h4 style={{ padding: "0 16px" }}>Recipes</h4>
      {openRecipes.length === 0 && (
        <p style={{ padding: "0 16px", color: t.colors.textMuted }}>No recipes open. Tap Open to pick one, or ＋ to create one.</p>
      )}

      {openRecipes.map(({ recipe, instances }) => {
        const running = instances.filter((i) => i.status !== "completed");
        return (
          <div key={recipe.id} style={t.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => navigate({ view: "recipe", recipeId: recipe.id })}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{recipe.name}</div>
                <div style={{ ...t.clamp(3), fontSize: 13, color: t.colors.textMuted, marginTop: 2 }}>{recipe.description}</div>
              </div>
              {closeConfirmId === recipe.id ? (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button style={t.smallButton} onClick={() => setCloseConfirmId(null)}>Cancel</button>
                  <button style={{ ...t.smallButton, color: t.colors.accentRed }} onClick={() => handleClose(recipe.id)}>Close</button>
                </div>
              ) : (
                <button
                  // Not t.iconButton here — that's white text for the gradient
                  // header bar. Reused on this white card tile, the ✕ rendered
                  // as white-on-white: present and clickable, just invisible.
                  style={{ ...t.iconButton, color: t.colors.text }}
                  title="Close"
                  onClick={() => (running.length > 0 ? setCloseConfirmId(recipe.id) : handleClose(recipe.id))}
                >
                  ✕
                </button>
              )}
            </div>
            {closeConfirmId === recipe.id && (
              <p style={{ fontSize: 12.5, color: t.colors.accentRed, marginTop: 6 }}>
                Closing will complete all {running.length} running step{running.length === 1 ? "" : "s"} of this recipe.
              </p>
            )}

            {running.map((instance) => {
              const step = recipe.steps.find((s) => s.id === instance.stepId);
              if (!step) return null;
              return (
                <InstanceRow
                  key={instance.id}
                  engine={engine}
                  step={step}
                  instance={instance}
                  onOpen={() => navigate({ view: "step", recipeId: recipe.id, stepId: step.id, instanceId: instance.id })}
                />
              );
            })}
          </div>
        );
      })}

      {picker && (
        <div style={t.overlay} onClick={() => setPicker(null)}>
          <div style={t.overlayCard} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{picker === "open" ? "Open a recipe" : "Search recipes"}</h3>
            {picker === "search" && (
              <input style={t.input} autoFocus placeholder="Search name or description" value={query} onChange={(e) => setQuery(e.target.value)} />
            )}
            <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
              {filtered.map((r) => (
                <li key={r.id} style={{ padding: "8px 0", borderBottom: `1px solid ${t.colors.border}`, cursor: "pointer" }} onClick={() => handleOpenPicked(r.id)}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ ...t.clamp(2), fontSize: 12.5, color: t.colors.textMuted }}>{r.description}</div>
                </li>
              ))}
              {filtered.length === 0 && <p style={{ color: t.colors.textMuted }}>Nothing found.</p>}
            </ul>
            <button style={{ ...t.secondaryButton, marginTop: 8 }} onClick={() => setPicker(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
