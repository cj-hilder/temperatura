// Shared style constants — inline style={{}} objects throughout, no CSS
// files, matching RTW's house style exactly (verified: RTW has zero .css
// files). Palette from the spec's Style section.

export const colors = {
  gradientStart: "#B1DCED",
  gradientEnd: "#5CAADB",
  dialFace: "#F7F4ED",
  accentRed: "#C20104",
  text: "#1a2a33",
  textMuted: "#5a6b73",
  border: "rgba(0,0,0,0.12)",
  cardBg: "#ffffff",
};

export const page = {
  minHeight: "100dvh",
  background: colors.dialFace,
  color: colors.text,
  fontFamily: "system-ui, -apple-system, sans-serif",
  paddingBottom: 24,
};

export const iconRow = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  padding: "10px 8px",
  background: `linear-gradient(135deg, ${colors.gradientStart}, ${colors.gradientEnd})`,
};

export const iconButton = {
  border: "none",
  background: "transparent",
  fontSize: 20,
  padding: 8,
  cursor: "pointer",
  color: "#fff",
  lineHeight: 1,
};

export const spacer = { flex: 1 };

export const card = {
  background: colors.cardBg,
  border: `1px solid ${colors.border}`,
  borderRadius: 14,
  padding: 14,
  margin: "10px 12px",
};

export const primaryButton = {
  padding: "10px 16px",
  borderRadius: 100,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  background: colors.gradientEnd,
  color: "#fff",
};

export const dangerButton = {
  ...primaryButton,
  background: colors.accentRed,
};

export const secondaryButton = {
  padding: "10px 16px",
  borderRadius: 100,
  border: `1px solid ${colors.border}`,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  background: "transparent",
  color: colors.text,
};

export const smallButton = {
  padding: "6px 12px",
  borderRadius: 100,
  border: `1px solid ${colors.border}`,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 12.5,
  background: "transparent",
  color: colors.text,
};

export const input = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const label = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: colors.textMuted,
  marginBottom: 4,
  marginTop: 10,
};

export const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.45)",
  padding: 20,
};

export const overlayCard = {
  maxWidth: 360,
  width: "100%",
  maxHeight: "80vh",
  overflowY: "auto",
  background: colors.cardBg,
  borderRadius: 16,
  padding: 20,
};

export const fullScreenOverlay = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  overflowY: "auto",
  background: colors.dialFace,
};

export const errorText = {
  color: colors.accentRed,
  fontSize: 13,
  marginTop: 6,
};

export const clamp = (lines) => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});
