import { useEffect, useRef, useState } from "react";
import * as t from "./theme.js";

// "When" in words a cook reads at a glance: today's backups by time alone,
// older ones with the date.
export function formatWhen(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} ${time}`;
}

// Settings → Google Drive backup (spec, Storage → Google Drive backup).
export default function DriveSection({ engine }) {
  const { drive } = engine;
  const s = drive.status;
  const [busy, setBusy] = useState(null); // null | "connecting" | "backing-up" | "disconnecting"
  const [error, setError] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const abortRef = useRef(null);

  // Status is computed from storage, so read it fresh on open rather than
  // trust whatever was last emitted.
  useEffect(() => { drive.refreshStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abortRef.current?.abort(), []);

  // Not async up to the popup: connect() opens it synchronously, inside the tap.
  const connect = () => {
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy("connecting");
    // A first backup that fails after a good Connect shows up in the status
    // line (lastError), not here. Here is only for Connect itself failing.
    drive.connect({ signal: ac.signal })
      .catch((e) => { if (e?.kind !== "cancelled") setError(e?.message || String(e)); })
      .finally(() => { abortRef.current = null; setBusy(null); });
  };

  const backupNow = async () => {
    setError(null);
    setBusy("backing-up");
    try { await drive.backupNow(); } finally { setBusy(null); }
  };

  const disconnect = async () => {
    setError(null);
    setBusy("disconnecting");
    try { await drive.disconnect(); } finally { setBusy(null); setConfirmDisconnect(false); }
  };

  const muted = { fontSize: 12.5, color: t.colors.textMuted, marginTop: 4 };
  const row = { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" };

  let body;
  if (!s) {
    body = <p style={muted}>Checking…</p>;
  } else if (busy === "connecting") {
    body = (
      <>
        <p style={muted}>Waiting for Google. Finish signing in in the window that opened, then come back here.</p>
        <div style={row}><button style={t.smallButton} onClick={() => abortRef.current?.abort()}>Cancel</button></div>
      </>
    );
  } else if (!s.connected) {
    body = (
      <>
        <p style={muted}>
          Back up recipes, the journal and alarm sounds to your own Google Drive, automatically after every change.
          Only Temperatura's own hidden folder is used. The app can't see your other files.
        </p>
        <div style={row}><button style={t.primaryButton} onClick={connect}>Connect Google Drive</button></div>
      </>
    );
  } else {
    body = (
      <>
        <p style={{ ...muted, color: t.colors.text }}>
          {s.account ? <>Connected as <strong>{s.account}</strong></> : "Connected"}
        </p>
        {s.needsReconnect ? (
          <p style={t.errorText}>Google Drive access was removed or has expired. Automatic backup is stopped until you reconnect.</p>
        ) : (
          <p style={muted}>
            {busy === "backing-up" ? "Backing up…" : s.lastBackupAt ? `Last backup ${formatWhen(s.lastBackupAt)}` : "Not backed up yet"}
            {s.owedSince != null && busy !== "backing-up" && !s.lastError && " · changes waiting to back up"}
          </p>
        )}
        {s.lastError && !s.needsReconnect && <p style={t.errorText}>{s.lastError.message}</p>}
        <div style={row}>
          {s.needsReconnect ? (
            <button style={t.primaryButton} onClick={connect}>Reconnect</button>
          ) : (
            <button style={busy ? { ...t.smallButton, ...t.disabledButton } : t.smallButton} disabled={!!busy} onClick={backupNow}>Back up now</button>
          )}
          {confirmDisconnect ? (
            <>
              <span style={{ fontSize: 12.5 }}>Stop backing up? Backups already on Drive are kept.</span>
              <button style={t.dangerButton} disabled={!!busy} onClick={disconnect}>Disconnect</button>
              <button style={t.smallButton} onClick={() => setConfirmDisconnect(false)}>Keep</button>
            </>
          ) : (
            <button style={{ ...t.smallButton, marginLeft: "auto" }} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
          )}
        </div>
      </>
    );
  }

  return (
    <div style={{ padding: "13px 0", borderBottom: `1px solid ${t.colors.border}` }}>
      <div style={{ ...t.label, margin: 0 }}>Google Drive backup</div>
      {body}
      {error && <p style={t.errorText}>{error}</p>}
    </div>
  );
}
