import { useState } from "react";
import CurrentTemperatureLine from "./CurrentTemperatureLine.jsx";
import { useBackDismiss } from "./useBackDismiss.js";
import { formatTemperature } from "./lib/format.js";
import * as t from "./theme.js";

// "Recipe · Step — tag" for the instance a probe is currently used by, looked
// up from the open recipes (an assignment only ever exists for a running
// instance of an open recipe). Falls back to nothing rather than guessing.
export function describeInstance(openRecipes, instanceId) {
  for (const { recipe, instances } of openRecipes) {
    const instance = instances.find((i) => i.id === instanceId);
    const step = instance && recipe.steps.find((s) => s.id === instance.stepId);
    if (step) return `${recipe.name} · ${step.name}${instance.tag ? ` — ${instance.tag}` : ""}`;
  }
  return null;
}

const instanceUsingProbe = (assignments, probeId) =>
  Object.keys(assignments).find((i) => assignments[i] === probeId) ?? null;

// The connect icon on every page: opens the Probes panel rather than
// connecting one thing. Its colour summarises all probes at once.
export function ProbesButton({ engine, onOpen }) {
  const { connectionSummary } = engine;
  return (
    <button style={t.iconButton} title="Probes" onClick={onOpen}>
      {connectionSummary === "connected" ? "🔵" : connectionSummary === "connecting" ? "🟡" : "⚪"}
    </button>
  );
}

// One "current temperature" line per connected probe (Home and Recipe) —
// the raw readings, independent of which step uses which.
export function ProbeTemperatureLines({ engine }) {
  return engine.probes
    .filter((p) => p.connected)
    .map((p) => <CurrentTemperatureLine key={p.id} sample={p.sample} probeName={p.name} />);
}

function stateLabel(probe) {
  return probe.state === "gave up" ? "gave up reconnecting" : probe.state;
}

function readingText(probe) {
  if (!probe.connected) return null;
  const temp = probe.sample?.tempC == null ? "no data" : formatTemperature(probe.sample.tempC);
  return probe.sample?.battery != null ? `${temp} · battery ${probe.sample.battery}%` : temp;
}

// The Probes panel: every probe the app knows about, with connect/
// disconnect/rename/forget, plus "Add probe" (the browser's device picker).
// Adding needs a user gesture each time and the picker returns one device per
// call, so several probes are added one tap at a time.
export function ProbesPanel({ engine, onClose }) {
  const { probes, assignments, openRecipes, addProbe, connectProbe, disconnectProbe, renameProbe, forgetProbe } = engine;
  const [renaming, setRenaming] = useState(null); // { id, draft } | null
  const [forgetting, setForgetting] = useState(null); // probe id | null
  useBackDismiss(true, onClose);

  const commitRename = () => {
    if (renaming) renameProbe(renaming.id, renaming.draft);
    setRenaming(null);
  };

  return (
    <div style={t.overlay} onClick={onClose}>
      <div style={{ ...t.overlayCard, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Probes</h3>
        {probes.length === 0 && <p style={{ color: t.colors.textMuted }}>No probes yet. Add one to get started.</p>}
        {probes.map((p) => {
          const usedBy = instanceUsingProbe(assignments, p.id);
          const usedByText = usedBy ? describeInstance(openRecipes, usedBy) : null;
          return (
            <div key={p.id} style={{ padding: "10px 0", borderBottom: `1px solid ${t.colors.border}` }}>
              {renaming?.id === p.id ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={t.input}
                    autoFocus
                    value={renaming.draft}
                    onChange={(e) => setRenaming({ id: p.id, draft: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && commitRename()}
                  />
                  <button style={t.smallButton} onClick={commitRename}>Save</button>
                </div>
              ) : (
                <div style={{ fontWeight: 700 }}>{p.name}</div>
              )}
              <div style={{ fontSize: 12.5, color: t.colors.textMuted }}>
                {p.label} · {stateLabel(p)}
              </div>
              {readingText(p) && <div style={{ fontSize: 13 }}>{readingText(p)}</div>}
              {usedByText && <div style={{ fontSize: 12.5, color: t.colors.textMuted }}>Used by {usedByText}</div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {p.connected ? (
                  <button style={t.smallButton} onClick={() => disconnectProbe(p.id)}>Disconnect</button>
                ) : (
                  <button style={t.smallButton} onClick={() => connectProbe(p.id)}>Connect</button>
                )}
                <button style={t.smallButton} onClick={() => setRenaming({ id: p.id, draft: p.name })}>Rename</button>
                {forgetting === p.id ? (
                  <>
                    <button style={t.smallButton} onClick={() => setForgetting(null)}>Cancel</button>
                    <button style={{ ...t.smallButton, color: t.colors.accentRed }} onClick={() => { forgetProbe(p.id); setForgetting(null); }}>Forget</button>
                  </>
                ) : (
                  <button style={t.smallButton} onClick={() => setForgetting(p.id)}>Forget</button>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button style={t.primaryButton} onClick={addProbe}>Add probe</button>
          <button style={t.secondaryButton} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// The step page's thermometer icon: choose which connected probe this
// instance uses. A probe another instance is using is still offered —
// choosing it transfers it (the user has physically moved it) — but is
// labelled with who has it.
export function ProbeChooser({ engine, instanceId, onClose, onOpenProbes }) {
  const { probes, assignments, openRecipes, assignProbeToInstance } = engine;
  useBackDismiss(true, onClose);
  const mine = assignments[instanceId] ?? null;
  const connected = probes.filter((p) => p.connected);

  const choose = async (probeId) => {
    await assignProbeToInstance(instanceId, probeId);
    onClose();
  };

  return (
    <div style={t.overlay} onClick={onClose}>
      <div style={t.overlayCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Probe for this step</h3>
        {connected.length === 0 && (
          <p style={{ color: t.colors.textMuted }}>No probes are connected.</p>
        )}
        {connected.map((p) => {
          const holder = instanceUsingProbe(assignments, p.id);
          const elsewhere = holder && holder !== instanceId ? describeInstance(openRecipes, holder) : null;
          return (
            <div
              key={p.id}
              style={{ padding: "10px 0", borderBottom: `1px solid ${t.colors.border}`, cursor: "pointer" }}
              onClick={() => choose(p.id)}
            >
              <div style={{ fontWeight: 700 }}>
                {p.name}
                {p.id === mine && <span style={{ fontWeight: 400, color: t.colors.textMuted }}> — used by this step</span>}
              </div>
              <div style={{ fontSize: 13 }}>{readingText(p)}</div>
              {elsewhere && (
                <div style={{ fontSize: 12.5, color: t.colors.textMuted }}>
                  Used by {elsewhere} — choosing it moves it here
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          {mine && <button style={t.secondaryButton} onClick={() => choose(null)}>Use no probe</button>}
          {connected.length === 0 && <button style={t.primaryButton} onClick={() => { onClose(); onOpenProbes(); }}>Open Probes</button>}
          <button style={t.secondaryButton} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
