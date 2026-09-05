// Small inline SVG icons, stroked with currentColor so they pick up
// t.iconButton's white color automatically — matching the plain Unicode
// glyphs used for the rest of the icon row (☰ ⌂ ✎ ← ✕ ✓), which render as
// plain white outlines because they have no emoji presentation. 📂 and 🔍
// don't have a text presentation at all, so Android renders them as full-
// color emoji regardless of surrounding styling — these replace them.

export function FolderIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// Fill bar scales with `percent` (0-100) — the outline and nub are always
// full, only the interior bar's width reports the level, same convention as
// every OS battery glyph. Color is deliberately left to the caller (via the
// wrapping element's `color`, which `currentColor` picks up) rather than
// fixed here, since red-at-15%-or-below is a display rule about the reading,
// not a property of the icon itself.
export function BatteryIcon({ percent, ...props }) {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const fillWidth = (16 * clamped) / 100;
  return (
    <svg width="22" height="13" viewBox="0 0 22 13" fill="none" stroke="currentColor" strokeWidth="1.2" {...props}>
      <rect x="0.6" y="0.6" width="18.8" height="11.8" rx="2" />
      <rect x="20" y="4" width="1.4" height="5" rx="0.7" fill="currentColor" stroke="none" />
      <rect x="2.5" y="2.5" width={fillWidth} height="8" fill="currentColor" stroke="none" />
    </svg>
  );
}
