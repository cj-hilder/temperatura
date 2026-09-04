import * as t from "./theme.js";

// The seven items the spec lists under the hamburger icon. Only Settings is
// wired up so far — the rest are deliberately disabled rows rather than
// missing entirely, so the menu already matches the spec's shape and each
// item just needs its onClick filled in when it's built.
const ROWS = [
  { label: "Import" },
  { label: "Export" },
  { label: "Backup" },
  { label: "Restore" },
  { label: "Settings", enabled: true },
  { label: "Help" },
  { label: "About" },
];

export default function HamburgerMenu({ onClose, onOpenSettings }) {
  const handlers = { Settings: onOpenSettings };
  return (
    <div style={t.overlay} onClick={onClose}>
      <div style={t.overlayCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Menu</h3>
        {ROWS.map((row) => (
          <div
            key={row.label}
            style={{
              padding: "12px 0",
              borderBottom: `1px solid ${t.colors.border}`,
              cursor: row.enabled ? "pointer" : "default",
              color: row.enabled ? t.colors.text : t.colors.textMuted,
            }}
            onClick={row.enabled ? handlers[row.label] : undefined}
          >
            {row.label}
            {!row.enabled && " — coming soon"}
          </div>
        ))}
        <button style={{ ...t.secondaryButton, marginTop: 12, width: "100%" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
