import { useRef, useState } from "react";
import { createBlankStep, moveItem, withEditKeys, withoutEditKeys } from "./lib/recipe.js";
import * as t from "./theme.js";

// Reorderable list (steps, ingredients) — smooth drag via Pointer Events, not a library:
// this is an Android PWA, and HTML5's native `draggable` attribute is a
// mouse-era API with poor/inconsistent touch support, which is the only
// input this app actually needs to handle well. Pointer Events unify
// mouse/touch/pen behind one API and support setPointerCapture, so the
// handle keeps receiving move/up events even once the pointer has moved off
// it — exactly what a drag handle needs.
//
// The underlying array is left untouched for the whole drag; only a
// CSS transform per row is updated (translateY, driven straight off the
// pointer's total movement for the dragged row — always exact, never
// drifts). Neighboring rows are shifted by one row-height with their own
// CSS transition, which is what makes them visibly slide out of the way
// instead of snapping. The array itself is only spliced once, on release —
// by then every row's transform already shows the end state, so the actual
// reorder is invisible. That last step needs every row to have a stable
// `getKey` — see withEditKeys for why ingredients get throwaway keys.
function DraggableList({ items, getKey, onReorder, renderRow }) {
  const rowRefs = useRef([]);
  const dragInfo = useRef(null); // { startY, rowHeight, startIndex } — not visual, no re-render needed
  const [dragIndex, setDragIndex] = useState(null);
  const [deltaY, setDeltaY] = useState(0);
  const [overIndex, setOverIndex] = useState(null);

  const handlePointerDown = (i, e) => {
    dragInfo.current = { startY: e.clientY, rowHeight: rowRefs.current[i].offsetHeight, startIndex: i };
    setDragIndex(i);
    setOverIndex(i);
    setDeltaY(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragInfo.current) return;
    const { startY, rowHeight, startIndex } = dragInfo.current;
    const dy = e.clientY - startY;
    setDeltaY(dy);
    setOverIndex(Math.max(0, Math.min(items.length - 1, startIndex + Math.round(dy / rowHeight))));
  };

  const endDrag = () => {
    if (dragInfo.current && overIndex != null && overIndex !== dragInfo.current.startIndex) {
      onReorder(dragInfo.current.startIndex, overIndex);
    }
    dragInfo.current = null;
    setDragIndex(null);
    setOverIndex(null);
    setDeltaY(0);
  };

  return (
    <>
      {items.map((item, i) => {
        let transform = 0;
        if (dragIndex != null) {
          if (i === dragIndex) transform = deltaY;
          else if (dragIndex < overIndex && i > dragIndex && i <= overIndex) transform = -dragInfo.current.rowHeight;
          else if (dragIndex > overIndex && i < dragIndex && i >= overIndex) transform = dragInfo.current.rowHeight;
        }
        return (
          <div
            key={getKey(item)}
            ref={(el) => (rowRefs.current[i] = el)}
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 6,
              transform: `translateY(${transform}px)`,
              transition: i === dragIndex ? "none" : "transform 150ms ease",
              position: i === dragIndex ? "relative" : "static",
              zIndex: i === dragIndex ? 1 : "auto",
            }}
          >
            <button
              style={{ ...t.iconButton, color: t.colors.text, touchAction: "none", cursor: "grab" }}
              title="Drag to reorder"
              onPointerDown={(e) => handlePointerDown(i, e)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              ⠿
            </button>
            {renderRow(item, i)}
          </div>
        );
      })}
    </>
  );
}

export default function RecipeEditor({ engine, recipe, onDone, onDeleted }) {
  const { app } = engine;
  const [name, setName] = useState(recipe.name);
  const [description, setDescription] = useState(recipe.description);
  const [servings, setServings] = useState(recipe.servings);
  const [notes, setNotes] = useState(recipe.notes);
  const [ingredients, setIngredients] = useState(() => withEditKeys(recipe.ingredients, () => crypto.randomUUID()));
  const [steps, setSteps] = useState(recipe.steps);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const addNote = () => setNotes([...notes, ""]);
  const updateNote = (i, v) => setNotes(notes.map((n, j) => (j === i ? v : n)));
  const removeNote = (i) => setNotes(notes.filter((_, j) => j !== i));

  const addIngredient = () => setIngredients([...ingredients, { name: "", quantity: "", unit: "", _key: crypto.randomUUID() }]);
  const updateIngredient = (i, patch) => setIngredients(ingredients.map((ing, j) => (j === i ? { ...ing, ...patch } : ing)));
  const removeIngredient = (i) => setIngredients(ingredients.filter((_, j) => j !== i));
  const reorderIngredients = (from, to) => setIngredients((prev) => moveItem(prev, from, to));

  const addStep = () => setSteps([...steps, createBlankStep(crypto.randomUUID())]);
  const updateStepName = (i, v) => setSteps(steps.map((s, j) => (j === i ? { ...s, name: v } : s)));
  const removeStep = (i) => setSteps(steps.filter((_, j) => j !== i));
  const reorderSteps = (from, to) => setSteps((prev) => moveItem(prev, from, to));

  const save = async () => {
    setError(null);
    try {
      await app.updateRecipe(recipe.id, { name, description, servings, notes, ingredients: withoutEditKeys(ingredients), steps });
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
        <DraggableList
          items={ingredients}
          getKey={(ing) => ing._key}
          onReorder={reorderIngredients}
          renderRow={(ing, i) => (
            <>
              <input style={{ ...t.input, flex: 2 }} placeholder="Name" value={ing.name} onChange={(e) => updateIngredient(i, { name: e.target.value })} />
              <input style={{ ...t.input, flex: 1 }} placeholder="0.5 or 1/2" value={ing.quantity} onChange={(e) => updateIngredient(i, { quantity: e.target.value })} />
              <input style={{ ...t.input, flex: 1 }} placeholder="Unit" value={ing.unit} onChange={(e) => updateIngredient(i, { unit: e.target.value })} />
              <button style={t.smallButton} onClick={() => removeIngredient(i)}>✕</button>
            </>
          )}
        />
        <button style={t.smallButton} onClick={addIngredient}>+ Add ingredient</button>

        <label style={t.label}>Steps</label>
        <p style={{ fontSize: 12, color: t.colors.textMuted, marginTop: -4 }}>
          Duration, temperature band, and alarms are edited on the step's own page.
        </p>
        <DraggableList
          items={steps}
          getKey={(step) => step.id}
          onReorder={reorderSteps}
          renderRow={(step, i) => (
            <>
              <input style={t.input} placeholder="Step name" value={step.name} onChange={(e) => updateStepName(i, e.target.value)} />
              <button style={t.smallButton} onClick={() => removeStep(i)}>✕</button>
            </>
          )}
        />
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
