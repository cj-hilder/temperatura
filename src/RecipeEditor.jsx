import { useState } from "react";
import { createBlankStep } from "./lib/recipe.js";
import * as t from "./theme.js";

export default function RecipeEditor({ engine, recipe, onDone, onDeleted }) {
  const { app } = engine;
  const [name, setName] = useState(recipe.name);
  const [description, setDescription] = useState(recipe.description);
  const [servings, setServings] = useState(recipe.servings);
  const [notes, setNotes] = useState(recipe.notes);
  const [ingredients, setIngredients] = useState(recipe.ingredients);
  const [steps, setSteps] = useState(recipe.steps);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const addNote = () => setNotes([...notes, ""]);
  const updateNote = (i, v) => setNotes(notes.map((n, j) => (j === i ? v : n)));
  const removeNote = (i) => setNotes(notes.filter((_, j) => j !== i));

  const addIngredient = () => setIngredients([...ingredients, { name: "", quantity: "", unit: "" }]);
  const updateIngredient = (i, patch) => setIngredients(ingredients.map((ing, j) => (j === i ? { ...ing, ...patch } : ing)));
  const removeIngredient = (i) => setIngredients(ingredients.filter((_, j) => j !== i));

  const addStep = () => setSteps([...steps, createBlankStep(crypto.randomUUID())]);
  const updateStepName = (i, v) => setSteps(steps.map((s, j) => (j === i ? { ...s, name: v } : s)));
  const removeStep = (i) => setSteps(steps.filter((_, j) => j !== i));

  const save = async () => {
    setError(null);
    try {
      await app.updateRecipe(recipe.id, { name, description, servings, notes, ingredients, steps });
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };

  const del = async () => {
    await app.deleteRecipe(recipe.id);
    // Not onDone(): this recipe no longer exists, so re-rendering the
    // (now-gone) recipe view would strand the user on a dead-end screen.
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

        <label style={t.label}>Servings</label>
        <input style={t.input} value={servings} onChange={(e) => setServings(e.target.value)} placeholder="e.g. 4 people, 1 loaf" />

        <label style={t.label}>Notes</label>
        {notes.map((note, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input style={t.input} value={note} onChange={(e) => updateNote(i, e.target.value)} />
            <button style={t.smallButton} onClick={() => removeNote(i)}>✕</button>
          </div>
        ))}
        <button style={t.smallButton} onClick={addNote}>+ Add note</button>

        <label style={t.label}>Ingredients</label>
        {ingredients.map((ing, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input style={{ ...t.input, flex: 2 }} placeholder="Name" value={ing.name} onChange={(e) => updateIngredient(i, { name: e.target.value })} />
            <input style={{ ...t.input, flex: 1 }} placeholder="Qty" value={ing.quantity} onChange={(e) => updateIngredient(i, { quantity: e.target.value })} />
            <input style={{ ...t.input, flex: 1 }} placeholder="Unit" value={ing.unit} onChange={(e) => updateIngredient(i, { unit: e.target.value })} />
            <button style={t.smallButton} onClick={() => removeIngredient(i)}>✕</button>
          </div>
        ))}
        <button style={t.smallButton} onClick={addIngredient}>+ Add ingredient</button>

        <label style={t.label}>Steps</label>
        <p style={{ fontSize: 12, color: t.colors.textMuted, marginTop: -4 }}>
          Duration, temperature band, and alarms are edited on the step's own page.
        </p>
        {steps.map((step, i) => (
          <div key={step.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input style={t.input} placeholder="Step name" value={step.name} onChange={(e) => updateStepName(i, e.target.value)} />
            <button style={t.smallButton} onClick={() => removeStep(i)}>✕</button>
          </div>
        ))}
        <button style={t.smallButton} onClick={addStep}>+ Add step</button>

        {error && <p style={t.errorText}>{error}</p>}

        <div style={{ marginTop: 24, marginBottom: 24 }}>
          {!deleteConfirm ? (
            <button style={t.dangerButton} onClick={() => setDeleteConfirm(true)}>Delete recipe</button>
          ) : (
            <div>
              <p style={{ fontSize: 13 }}>Delete this recipe and any running instances of its steps?</p>
              <button style={t.secondaryButton} onClick={() => setDeleteConfirm(false)}>Cancel</button>{" "}
              <button style={t.dangerButton} onClick={del}>Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
