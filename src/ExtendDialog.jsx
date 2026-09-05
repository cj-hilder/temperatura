import { useState } from "react";
import TimeInput from "./TimeInput.jsx";
import * as t from "./theme.js";

// Opened by engine.requestExtend — from the step page's own Extend button,
// or a notification's Extend action arriving via the SW message listener.
// Confirming here is the only thing that actually changes the instance;
// requestExtend itself only silenced the duration alarm and opened this.
export default function ExtendDialog({ onCancel, onConfirm }) {
  const [ms, setMs] = useState(5 * 60_000);

  const confirm = () => {
    if (ms > 0) onConfirm(ms);
  };

  return (
    <div style={t.overlay} onClick={onCancel}>
      <div style={{ ...t.overlayCard, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Extend duration</h3>
        <p style={{ fontSize: 13, color: t.colors.textMuted, textAlign: "left" }}>
          This is a temporary extension. If you want to extend the duration permanently you need
          to edit the recipe step.
        </p>
        <label style={{ ...t.label, textAlign: "left" }}>Time to add</label>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <TimeInput valueMs={ms} onChangeMs={setMs} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button style={{ ...t.secondaryButton, flex: 1 }} onClick={onCancel}>Cancel</button>
          <button style={{ ...t.primaryButton, flex: 1 }} onClick={confirm}>Extend</button>
        </div>
      </div>
    </div>
  );
}
