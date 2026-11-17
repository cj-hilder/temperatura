import { useRef, useState } from "react";
import { recipeToExportJSON, recipeFromImportJSON } from "./lib/recipe.js";
import { buildRecipePrintHtml } from "./recipePrint.js";
import * as t from "./theme.js";
import { formatWhen } from "./DriveSection.jsx";
import { messageFor } from "./lib/driveBackup.js";

// Browser download primitive shared by every export action here — Blob +
// object URL + a programmatically clicked <a download>, then revoke. No
// dependency needed; this is the same pattern reference/ride-the-wind/src/
// App.jsx:1210-1219 uses for its own backup export.
function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const todayStamp = () => new Date().toISOString().slice(0, 10);

export default function HamburgerMenu({ engine, currentRecipeId, navigate, onClose, onOpenSettings, onOpenHelp, onOpenAbout }) {
  const { app, refresh, drive } = engine;
  const driveConnected = !!drive.status?.connected && !drive.status?.needsReconnect;
  const [expanded, setExpanded] = useState(null); // null | "export" | "print" | "backup" | "restore"
  const [driveBackups, setDriveBackups] = useState(null); // null (not loaded) | "loading" | list
  const [pendingRestore, setPendingRestore] = useState(null); // { bundle, label } awaiting confirm
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, error } | null
  const [pickerRecipes, setPickerRecipes] = useState([]);
  const [restoreMode, setRestoreMode] = useState("merge");
  const importRef = useRef(null);
  const restoreRef = useRef(null);

  const say = (text, error = false) => setMessage({ text, error });

  const exportRecipe = async (recipeId) => {
    const recipe = await app.getRecipe(recipeId);
    if (!recipe) return say("That recipe no longer exists.", true);
    downloadJSON(`${recipe.name || "recipe"}.json`, recipeToExportJSON(recipe));
    say(`Exported "${recipe.name}".`);
    setExpanded(null);
  };

  // Export acts immediately on the recipe already in view (Recipe/Step
  // page); from Home, where there's no recipe in context, it expands into a
  // picker instead — the same choice HomePage's own "Open" icon offers.
  const handleExportClick = async () => {
    setMessage(null);
    if (currentRecipeId) {
      exportRecipe(currentRecipeId);
    } else {
      setPickerRecipes(await app.listRecipes());
      setExpanded(expanded === "export" ? null : "export");
    }
  };

  // "Export as PDF" is a separate, human-readable share format from the JSON
  // Export above — no PDF library involved (see recipePrint.js): a blank
  // window gets the recipe rendered as plain HTML, then the browser's own
  // print() is what actually produces the PDF, via "Save as PDF" in the
  // native print dialog. That dialog is outside DOM control once it opens,
  // so onafterprint (fired once it closes, print or cancel either way) is
  // used to tidy the scratch window up rather than leaving it stranded open.
  const printRecipe = async (recipeId) => {
    // window.open() FIRST, synchronously inside the click, before any await —
    // the recipe fetch below is only an IndexedDB read, but even that brief a
    // gap can be enough for a browser to decide the click's user-activation
    // has lapsed and block the popup. Opening blank immediately spends the
    // gesture while it's fresh; the fetch only decides what gets written into
    // the window that's already open.
    const win = window.open("", "_blank");
    if (!win) return say("Couldn't open the print window — check the browser's popup blocker.", true);
    const recipe = await app.getRecipe(recipeId);
    if (!recipe) {
      win.close();
      return say("That recipe no longer exists.", true);
    }
    const multiplier = await app.getIngredientsMultiplier(recipeId);
    const sixths = await app.getSixthsAndTwelfths();
    win.document.open();
    win.document.write(buildRecipePrintHtml(recipe, multiplier, { sixths }));
    win.document.close();
    win.onafterprint = () => win.close();
    win.focus();
    win.print();
    say(`Opened "${recipe.name}" for printing / Save as PDF.`);
    setExpanded(null);
  };

  const handlePrintClick = async () => {
    setMessage(null);
    if (currentRecipeId) {
      printRecipe(currentRecipeId);
    } else {
      setPickerRecipes(await app.listRecipes());
      setExpanded(expanded === "print" ? null : "print");
    }
  };

  const handleImportFile = async (file) => {
    setMessage(null);
    try {
      const bundle = JSON.parse(await file.text());
      const { valid, errors, recipe } = recipeFromImportJSON(bundle);
      if (!valid) return say(errors.join(" "), true);
      // Always a fresh id — an imported recipe is a new recipe on this
      // device, never a silent overwrite of whatever happens to already
      // hold the bundled id here.
      const created = await app.createRecipe({ ...recipe, id: crypto.randomUUID() });
      await app.openRecipe(created.id);
      await refresh();
      onClose();
      navigate({ view: "recipe", recipeId: created.id });
    } catch (e) {
      say(`Couldn't import that file: ${e.message}`, true);
    }
  };

  const downloadBackup = async () => {
    setMessage(null);
    const bundle = await app.store.exportAll();
    downloadJSON(`temperatura-backup-${todayStamp()}.json`, bundle);
    say("Backup downloaded.");
    setExpanded(null);
  };

  // With Drive connected, Backup offers both destinations. Without it, a tap
  // downloads straight away, as it always has.
  const handleBackupClick = () => {
    setMessage(null);
    if (driveConnected) setExpanded(expanded === "backup" ? null : "backup");
    else downloadBackup();
  };

  const backupToDrive = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await drive.backupNow();
      if (res?.ok) { say(`Backed up to Google Drive ${formatWhen(res.at)}.`); setExpanded(null); }
      else say(res?.error?.message ? res.error.message : "Backup to Google Drive failed.", true);
    } finally {
      setBusy(false);
    }
  };

  // Every restore, from a file or from Drive, goes through one confirm. It
  // says how much is coming in, and warns when the backup holds running
  // steps: they will run on THIS phone too, alarms included, and the phone
  // they came from is never told.
  const askToRestore = (bundle, label) => {
    if (!bundle || bundle.format !== "temperatura/backup") return say("Not a Temperatura backup file.", true);
    setPendingRestore({ bundle, label });
  };

  const confirmRestore = async () => {
    const { bundle } = pendingRestore;
    setBusy(true);
    try {
      await app.store.importAll(bundle, restoreMode);
      await refresh();
      say("Restore complete.");
      setPendingRestore(null);
      setExpanded(null);
    } catch (e) {
      say(`Couldn't restore: ${e.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFile = async (file) => {
    setMessage(null);
    try {
      askToRestore(JSON.parse(await file.text()), `the file "${file.name}"`);
    } catch (e) {
      say(`Couldn't read that file: ${e.message}`, true);
    }
  };

  const showDriveBackups = async () => {
    setMessage(null);
    setDriveBackups("loading");
    try {
      setDriveBackups(await drive.listBackups());
    } catch (e) {
      setDriveBackups(null);
      say(e?.kind ? messageFor(e) : e.message, true);
    }
  };

  const restoreFromDrive = async (entry) => {
    setMessage(null);
    setBusy(true);
    try {
      askToRestore(await drive.downloadBackup(entry.id), `the ${entry.kind === "auto" ? "automatic" : "manual"} backup from ${formatWhen(entry.exportedAt)}`);
    } catch (e) {
      say(`Couldn't fetch that backup: ${e.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const ROWS = [
    { label: "Settings", onClick: onOpenSettings, note: drive.status?.attention ? "Google Drive backup needs attention" : null },
    { label: "Import", onClick: () => { setMessage(null); importRef.current.click(); } },
    { label: "Export", onClick: handleExportClick },
    { label: "Export as PDF", onClick: handlePrintClick },
    { label: "Backup", onClick: handleBackupClick },
    { label: "Restore", onClick: () => { setMessage(null); setPendingRestore(null); setDriveBackups(null); setExpanded(expanded === "restore" ? null : "restore"); } },
    { label: "Help", onClick: onOpenHelp },
    { label: "About", onClick: onOpenAbout },
  ];

  return (
    <div style={t.overlay} onClick={onClose}>
      <div style={t.overlayCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Menu</h3>
        {ROWS.map((row) => (
          <div key={row.label}>
            <div style={{ padding: "12px 0", borderBottom: `1px solid ${t.colors.border}`, cursor: "pointer" }} onClick={row.onClick}>
              {row.label}
              {row.note && <div style={{ ...t.errorText, marginTop: 2, fontSize: 12 }}>{row.note}</div>}
            </div>
            {row.label === "Backup" && expanded === "backup" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "4px 0 10px 12px" }}>
                <button style={t.smallButton} onClick={downloadBackup}>Download file</button>
                <button style={busy ? { ...t.smallButton, ...t.disabledButton } : t.smallButton} disabled={busy} onClick={backupToDrive}>
                  {busy ? "Backing up…" : "Back up to Google Drive now"}
                </button>
              </div>
            )}
            {row.label === "Export" && expanded === "export" && (
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px" }}>
                {pickerRecipes.map((r) => (
                  <li key={r.id} style={{ padding: "6px 0 6px 12px", cursor: "pointer", fontSize: 13.5 }} onClick={() => exportRecipe(r.id)}>
                    {r.name}
                  </li>
                ))}
                {pickerRecipes.length === 0 && (
                  <li style={{ padding: "6px 0 6px 12px", fontSize: 13, color: t.colors.textMuted }}>No recipes to export.</li>
                )}
              </ul>
            )}
            {row.label === "Export as PDF" && expanded === "print" && (
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px" }}>
                {pickerRecipes.map((r) => (
                  <li key={r.id} style={{ padding: "6px 0 6px 12px", cursor: "pointer", fontSize: 13.5 }} onClick={() => printRecipe(r.id)}>
                    {r.name}
                  </li>
                ))}
                {pickerRecipes.length === 0 && (
                  <li style={{ padding: "6px 0 6px 12px", fontSize: 13, color: t.colors.textMuted }}>No recipes to export.</li>
                )}
              </ul>
            )}
            {row.label === "Restore" && expanded === "restore" && (
              <div style={{ padding: "0 0 8px 12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="radio" checked={restoreMode === "merge"} onChange={() => setRestoreMode("merge")} />
                  Keep existing (skip anything already on this device)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 4 }}>
                  <input type="radio" checked={restoreMode === "replace"} onChange={() => setRestoreMode("replace")} />
                  Overwrite matching items with the backup's version
                </label>
                {pendingRestore ? (
                  <RestoreConfirm pending={pendingRestore} mode={restoreMode} busy={busy} onConfirm={confirmRestore} onCancel={() => setPendingRestore(null)} />
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <button style={t.smallButton} onClick={() => restoreRef.current.click()}>Choose backup file</button>
                      {driveConnected && <button style={t.smallButton} onClick={showDriveBackups}>From Google Drive</button>}
                    </div>
                    {driveBackups === "loading" && <p style={{ fontSize: 12.5, color: t.colors.textMuted }}>Loading backups…</p>}
                    {Array.isArray(driveBackups) && (
                      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                        {driveBackups.length === 0 && <li style={{ fontSize: 13, color: t.colors.textMuted }}>No backups on Google Drive yet.</li>}
                        {driveBackups.map((b) => (
                          <li key={b.id} style={{ padding: "7px 0", cursor: busy ? "default" : "pointer", fontSize: 13.5, borderTop: `1px solid ${t.colors.border}` }} onClick={() => !busy && restoreFromDrive(b)}>
                            {formatWhen(b.exportedAt)}
                            <span style={{ color: t.colors.textMuted, fontSize: 12.5 }}>
                              {" "}· {b.kind === "auto" ? "automatic" : "manual"}
                              {b.recipeCount != null && ` · ${b.recipeCount} recipe${b.recipeCount === 1 ? "" : "s"}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {message && (
          <p style={message.error ? t.errorText : { fontSize: 12.5, color: t.colors.textMuted, marginTop: 8 }}>{message.text}</p>
        )}

        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files[0] && handleImportFile(e.target.files[0])} />
        <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files[0] && handleRestoreFile(e.target.files[0])} />

        <button style={{ ...t.secondaryButton, marginTop: 12, width: "100%" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function RestoreConfirm({ pending, mode, busy, onConfirm, onCancel }) {
  const { bundle, label } = pending;
  const recipes = bundle.recipes?.length ?? 0;
  const running = (bundle.instances ?? []).filter((i) => i.status !== "completed").length;
  return (
    <div style={{ ...t.card, marginTop: 8 }}>
      <div style={{ fontSize: 13.5 }}>
        Restore {recipes} recipe{recipes === 1 ? "" : "s"} from {label}?
      </div>
      <div style={{ fontSize: 12.5, color: t.colors.textMuted, marginTop: 4 }}>
        {mode === "merge" ? "Anything already on this phone is kept." : "Matching items on this phone are overwritten."}
      </div>
      {running > 0 && (
        <div style={{ ...t.errorText, fontSize: 12.5 }}>
          This backup has {running} step{running === 1 ? "" : "s"} in progress. {running === 1 ? "It" : "They"} will run on this phone too, alarms
          included. The phone it was backed up from isn't told.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={t.secondaryButton} onClick={onCancel}>Cancel</button>
        <button style={busy ? { ...t.primaryButton, ...t.disabledButton } : t.primaryButton} disabled={busy} onClick={onConfirm}>Restore</button>
      </div>
    </div>
  );
}
