import { useEffect, useState } from "react";
import { buildRecipePrintHtml } from "./recipePrint.js";
import { useBackDismiss } from "./useBackDismiss.js";
import * as t from "./theme.js";

// A recipe's journal: dated snapshots recorded with "Record in journal" on
// the Recipe page (app.js recordJournal). A full-screen panel over the
// Recipe page, like Settings: a list, newest first, and one entry at a time.
// Back steps from an entry to the list, then closes the panel.
const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function JournalPage({ engine, recipe, running, onClose }) {
  const { app } = engine;
  const [entries, setEntries] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const load = async () => setEntries(await app.listJournal(recipe.id));
  useEffect(() => {
    load();
  }, [recipe.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useBackDismiss(true, () => (selectedId ? setSelectedId(null) : onClose()));

  const selected = entries?.find((e) => e.id === selectedId) ?? null;

  return (
    <div style={{ ...t.fullScreenOverlay, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {selected ? (
          <JournalEntry
            engine={engine}
            entry={selected}
            running={running}
            onBack={() => setSelectedId(null)}
            onChanged={load}
            onDeleted={async () => {
              setSelectedId(null);
              await load();
            }}
            onRestored={onClose}
          />
        ) : (
          <>
            <h1 style={{ marginTop: 0, marginBottom: 4 }}>Journal</h1>
            <p style={{ color: t.colors.textMuted, marginTop: 0 }}>{recipe.name}</p>
            {entries?.length === 0 && (
              <p style={{ color: t.colors.textMuted }}>
                Nothing recorded yet. "Record in journal" on the recipe page saves a dated copy of the recipe as it stands.
              </p>
            )}
            {entries?.map((e) => (
              <div key={e.id} style={{ ...t.card, margin: "0 0 8px", cursor: "pointer" }} onClick={() => setSelectedId(e.id)}>
                <div style={{ fontWeight: 700 }}>{when(e.recordedAt)}</div>
                {e.recipe.name !== recipe.name && <div style={{ fontSize: 12.5, color: t.colors.textMuted }}>as "{e.recipe.name}"</div>}
                {e.notes && <div style={{ ...t.clamp(2), fontSize: 13, marginTop: 4 }}>{e.notes}</div>}
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ padding: 16, borderTop: `1px solid ${t.colors.border}` }}>
        <button style={{ ...t.primaryButton, width: "100%" }} onClick={selected ? () => setSelectedId(null) : onClose}>
          {selected ? "Back to journal" : "Done"}
        </button>
      </div>
    </div>
  );
}

function JournalEntry({ engine, entry, running, onBack, onChanged, onDeleted, onRestored }) {
  const { app } = engine;
  const [notes, setNotes] = useState(entry.notes);
  const [confirm, setConfirm] = useState(null); // "delete" | "restore" | null
  const [error, setError] = useState(null);
  const tallies = entry.recipe.steps
    .filter((s) => (entry.completionTicks?.[s.id] ?? 0) > 0)
    .map((s) => `${s.name} ×${entry.completionTicks[s.id]}`);

  const saveNotes = async () => {
    if (notes === entry.notes) return;
    await app.setJournalNotes(entry.id, notes);
    await onChanged();
  };
  const remove = async () => {
    await app.deleteJournalEntry(entry.id);
    await onDeleted();
  };
  const restore = async () => {
    setError(null);
    try {
      await app.restoreJournalEntry(entry.id);
      await engine.refresh();
      onRestored();
    } catch (e) {
      setError(e.message);
      setConfirm(null);
    }
  };

  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.colors.textMuted, cursor: "pointer", marginBottom: 6 }} onClick={onBack}>
        ← Journal
      </div>
      <h2 style={{ margin: "0 0 4px" }}>{when(entry.recordedAt)}</h2>
      <p style={{ fontSize: 13, color: t.colors.textMuted, margin: "0 0 12px" }}>
        Ingredients ×{entry.multiplier}
        {tallies.length ? ` · Completed: ${tallies.join(", ")}` : ""}
      </p>

      <label style={t.label}>Notes</label>
      <textarea
        style={{ ...t.input, minHeight: 70 }}
        placeholder="e.g. yield was 950 g; next time less salt"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
      />

      {/* The recipe as it was, laid out exactly like the PDF export (and
          scaled by the multiplier it had then). A sandboxed frame keeps the
          export's own stylesheet from touching the app's; allow-same-origin
          only so the frame can be sized to its content — no scripts run. */}
      <iframe
        title="Recipe as recorded"
        sandbox="allow-same-origin"
        srcDoc={buildRecipePrintHtml(entry.recipe, entry.multiplier, { sixths: engine.sixthsAndTwelfths })}
        style={{ width: "100%", border: `1px solid ${t.colors.border}`, borderRadius: 8, marginTop: 12, background: "#fff" }}
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (doc) e.currentTarget.style.height = `${doc.documentElement.scrollHeight}px`;
        }}
      />

      {error && <p style={t.errorText}>{error}</p>}

      <div style={{ marginTop: 16 }}>
        {confirm === "restore" ? (
          <div>
            <p style={{ fontSize: 13 }}>
              Replace the current recipe with this version? The current version is recorded in the journal first, so it can be restored too.
            </p>
            <button style={t.secondaryButton} onClick={() => setConfirm(null)}>Cancel</button>{" "}
            <button style={t.primaryButton} onClick={restore}>Restore</button>
          </div>
        ) : confirm === "delete" ? (
          <div>
            <p style={{ fontSize: 13 }}>Delete this journal entry?</p>
            <button style={t.secondaryButton} onClick={() => setConfirm(null)}>Cancel</button>{" "}
            <button style={t.dangerButton} onClick={remove}>Delete</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              style={{ ...t.secondaryButton, ...(running ? t.disabledButton : null) }}
              disabled={running}
              onClick={() => setConfirm("restore")}
            >
              Restore this version
            </button>
            <button style={t.dangerButton} onClick={() => setConfirm("delete")}>Delete entry</button>
          </div>
        )}
        {running && confirm === null && (
          <p style={{ fontSize: 12, color: t.colors.textMuted }}>
            Restoring is unavailable while any of this recipe's steps is in progress.
          </p>
        )}
      </div>
    </>
  );
}
