import * as t from "./theme.js";

// The ☰ button in every page's icon row, with the spec's Drive-backup dot.
// The dot shows when Google access has been lost, or when a change has gone a
// day without being backed up. It is quiet on purpose: no alarm, no popup, because
// a backup problem is never as urgent as a running step.
export default function MenuButton({ engine, onOpenMenu }) {
  const attention = !!engine.drive?.status?.attention;
  return (
    <button
      style={{ ...t.iconButton, position: "relative" }}
      title={attention ? "Menu: Google Drive backup needs attention" : "Menu"}
      onClick={onOpenMenu}
    >
      ☰
      {attention && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: "50%",
            background: t.colors.accentRed, border: "1.5px solid #fff",
          }}
        />
      )}
    </button>
  );
}
