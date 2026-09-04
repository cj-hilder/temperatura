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
