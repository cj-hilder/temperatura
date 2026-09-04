import { useEffect, useRef, useState } from "react";
import { decodeSound, isSoundTooLong, MAX_SOUND_SECONDS } from "./lib/alarmPlayer.js";
import * as t from "./theme.js";

const NEW_THEME = Symbol("new-theme");

export default function SettingsPage({ engine, onClose }) {
  const { app } = engine;
  const [themes, setThemes] = useState([]);
  const [dataLossThemeId, setDataLossThemeId] = useState(null);
  const [expanded, setExpanded] = useState(null); // theme id | NEW_THEME | null

  const load = async () => {
    const [list, dataLossId] = await Promise.all([app.store.listAlarmThemes(), app.getDataLossAlarmTheme()]);
    setThemes(list);
    setDataLossThemeId(dataLossId);
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const defaultTheme = themes.find((th) => th.isDefault);
  const customThemes = themes.filter((th) => !th.isDefault);

  const changeDataLossTheme = async (themeId) => {
    setDataLossThemeId(themeId);
    await app.setDataLossAlarmTheme(themeId);
  };

  return (
    <div style={{ ...t.fullScreenOverlay, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <h1 style={{ marginTop: 0 }}>Settings</h1>

        {themes.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: `1px solid ${t.colors.border}` }}>
            <span style={{ ...t.label, margin: 0 }}>Lost connection alarm</span>
            <select style={{ ...t.input, width: "auto" }} value={dataLossThemeId ?? ""} onChange={(e) => changeDataLossTheme(e.target.value)}>
              {themes.map((th) => (
                <option key={th.id} value={th.id}>{th.name}</option>
              ))}
            </select>
          </div>
        )}

        <h3>Alarm themes</h3>
        {defaultTheme && (
          <ThemeCard
            engine={engine}
            theme={defaultTheme}
            expanded={expanded === defaultTheme.id}
            onToggle={() => setExpanded(expanded === defaultTheme.id ? null : defaultTheme.id)}
            onSaved={async () => { await load(); setExpanded(null); }}
          />
        )}
        {customThemes.map((theme) => (
          <ThemeCard
            key={theme.id}
            engine={engine}
            theme={theme}
            expanded={expanded === theme.id}
            onToggle={() => setExpanded(expanded === theme.id ? null : theme.id)}
            onSaved={async () => { await load(); setExpanded(null); }}
            onDeleted={async () => { await load(); setExpanded(null); }}
          />
        ))}
        {expanded === NEW_THEME ? (
          <ThemeCard
            engine={engine}
            theme={null}
            expanded
            onToggle={() => setExpanded(null)}
            onSaved={async () => { await load(); setExpanded(null); }}
          />
        ) : (
          <button style={t.smallButton} onClick={() => setExpanded(NEW_THEME)}>+ New theme</button>
        )}
      </div>
      <div style={{ padding: 16, borderTop: `1px solid ${t.colors.border}` }}>
        <button style={{ ...t.primaryButton, width: "100%" }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function ThemeCard({ engine, theme, expanded, onToggle, onSaved, onDeleted }) {
  const { app } = engine;
  const isNew = theme === null;
  const isDefault = !!theme?.isDefault;

  const [name, setName] = useState(theme?.name ?? "");
  const [rampSeconds, setRampSeconds] = useState(theme?.rampSeconds ?? 2);
  const [vibrate, setVibrate] = useState(theme?.vibrate ?? true);
  const [pickedSound, setPickedSound] = useState(null); // { arrayBuffer, fileName } | null
  const [pickError, setPickError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const fileRef = useRef(null);

  const pickFile = async (file) => {
    setPickError(null);
    const arrayBuffer = await file.arrayBuffer();
    const ctx = engine.getAudioContext();
    if (!ctx) {
      setPickError("Audio isn't ready yet — try again in a moment.");
      return;
    }
    const decoded = await decodeSound(ctx, arrayBuffer);
    if (!decoded) {
      setPickError("Couldn't read that file as audio.");
      return;
    }
    if (isSoundTooLong(decoded.duration)) {
      setPickError(`That file is ${decoded.duration.toFixed(1)}s long — the limit is ${MAX_SOUND_SECONDS}s.`);
      return;
    }
    setPickedSound({ arrayBuffer, fileName: file.name });
  };

  const save = async () => {
    setSaveError(null);
    if (isNew && !pickedSound) {
      setSaveError("Pick a sound file first.");
      return;
    }
    try {
      const saved = isNew
        ? await app.store.createAlarmTheme({ name, rampSeconds: Number(rampSeconds), vibrate })
        : await app.store.updateAlarmTheme(theme.id, { name, rampSeconds: Number(rampSeconds), vibrate });
      if (pickedSound) await app.store.saveSound(saved.id, pickedSound.arrayBuffer);
      onSaved();
    } catch (e) {
      setSaveError(e.message);
    }
  };

  const del = async () => {
    await app.store.deleteAlarmTheme(theme.id);
    onDeleted();
  };

  if (!expanded) {
    return (
      <div style={{ ...t.card, cursor: "pointer" }} onClick={onToggle}>
        <div style={{ fontWeight: 700 }}>{theme.name}</div>
        <div style={{ fontSize: 12.5, color: t.colors.textMuted }}>
          Ramp {theme.rampSeconds}s · {theme.vibrate ? "Vibrate" : "No vibrate"}
        </div>
      </div>
    );
  }

  return (
    <div style={t.card}>
      <label style={{ ...t.label, marginTop: 0 }}>Name</label>
      <input style={t.input} value={name} onChange={(e) => setName(e.target.value)} disabled={isDefault} />

      {isDefault ? (
        <p style={{ fontSize: 12.5, color: t.colors.textMuted }}>Uses the built-in tone — it can't be replaced.</p>
      ) : (
        <>
          <label style={t.label}>Sound</label>
          <button style={t.smallButton} onClick={() => fileRef.current.click()}>
            {pickedSound ? "Change file" : "Choose file"}
          </button>
          <input ref={fileRef} type="file" accept="audio/mpeg" hidden onChange={(e) => e.target.files[0] && pickFile(e.target.files[0])} />
          {pickedSound && <span style={{ marginLeft: 8, fontSize: 12.5, color: t.colors.textMuted }}>{pickedSound.fileName}</span>}
          {!pickedSound && !isNew && <span style={{ marginLeft: 8, fontSize: 12.5, color: t.colors.textMuted }}>Current sound kept unless you pick a new one.</span>}
          {pickError && <p style={t.errorText}>{pickError}</p>}
        </>
      )}

      <label style={t.label}>Ramp (seconds to full volume)</label>
      <input style={{ ...t.input, width: 100 }} type="number" min={0} value={rampSeconds} onChange={(e) => setRampSeconds(e.target.value)} />

      <label style={{ ...t.label, display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} /> Vibrate
      </label>

      {saveError && <p style={t.errorText}>{saveError}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={t.secondaryButton} onClick={onToggle}>Cancel</button>
        <button style={t.primaryButton} onClick={save}>Save</button>
        {!isDefault && !isNew && (
          deleteConfirm ? (
            <>
              <span style={{ fontSize: 12.5, alignSelf: "center" }}>Delete this theme?</span>
              <button style={t.dangerButton} onClick={del}>Delete</button>
            </>
          ) : (
            <button style={{ ...t.smallButton, marginLeft: "auto" }} onClick={() => setDeleteConfirm(true)}>Delete</button>
          )
        )}
      </div>
    </div>
  );
}
