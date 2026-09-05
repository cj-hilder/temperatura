// Builds a standalone, self-contained HTML document for one recipe, used by
// the hamburger menu's "Export as PDF" action. There is no PDF library here
// at all — the action opens this HTML in a blank window and calls the
// browser's own print(), and the user picks "Save as PDF" from the native
// print dialog. That's the same zero-dependency approach ble-hr-tool's own
// PDF export philosophy could have used instead of jsPDF, and it needs
// nothing beyond what a browser already has, matching CLAUDE.md's "don't add
// a dependency unless it's genuinely unavoidable" — for a static document
// like this, it isn't.
//
// Pure — a recipe object in, an HTML string out. No DOM, so it's testable in
// Node exactly like the rest of src/lib, even though it lives alongside
// stepDisplay.js rather than under lib/ (it shapes step data into
// human-readable text via describeStepAlarms, the same non-engine,
// display-shaping role stepDisplay.js already has).
import { formatDuration } from "./lib/format.js";
import { parseQuantity, scaleQuantity, formatQuantity } from "./lib/quantity.js";
import { describeStepAlarms } from "./stepDisplay.js";

// Recipe/step fields are freeform user text; they end up interpolated into
// an HTML string that a real browser then parses, so they need escaping the
// same as any other HTML-templating context, even though the only consumer
// here is the same device/user that authored the recipe.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function stepSummaryLine(step) {
  const parts = [];
  parts.push(
    step.duration
      ? `${step.duration.kind === "fixed" ? "Fixed" : "In temperature band"} duration — ${formatDuration(step.duration.ms)}`
      : "No set duration"
  );
  if (step.tempBand) parts.push(`Band ${step.tempBand.lowC}–${step.tempBand.highC}°C`);
  return parts.join(" · ");
}

// `multiplier` mirrors whatever the Recipe page is currently showing (see
// app.js's getIngredientsMultiplier) — a share/print copy showing different
// quantities than the screen the user was just looking at would be more
// confusing than helpful. Defaults to 1 (unscaled) so existing callers/tests
// don't need to know about the multiplier at all.
export function buildRecipePrintHtml(recipe, multiplier = 1) {
  const title = escapeHtml(recipe.name || "Recipe");

  const notesHtml = recipe.notes.length
    ? `<ul>${recipe.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";

  const ingredientsHtml = recipe.ingredients.length
    ? `<table>${recipe.ingredients
        .map((ing) => {
          const scaled = formatQuantity(scaleQuantity(parseQuantity(ing.quantity), multiplier)) || ing.quantity;
          return `<tr><td>${escapeHtml(ing.name)}</td><td class="qty">${escapeHtml(scaled)} ${escapeHtml(ing.unit)}</td></tr>`;
        })
        .join("")}</table>`
    : "<p class=\"muted\">No ingredients listed.</p>";

  const stepsHtml = recipe.steps.length
    ? recipe.steps
        .map((step, i) => {
          const alarmLines = describeStepAlarms(step);
          return `
            <div class="step">
              <h3>${i + 1}. ${escapeHtml(step.name)}</h3>
              ${step.description ? `<p class="muted">${escapeHtml(step.description)}</p>` : ""}
              <p class="muted">${escapeHtml(stepSummaryLine(step))}</p>
              ${alarmLines.length ? `<ul>${alarmLines.map((l) => `<li>${escapeHtml(l.text)}</li>`).join("")}</ul>` : ""}
            </div>`;
        })
        .join("")
    : "<p class=\"muted\">No steps.</p>";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #1a2a33; padding: 24px; max-width: 700px; margin: 0 auto; }
  h1 { margin-bottom: 4px; }
  h2 { margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .muted { color: #5a6b73; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  td { padding: 4px 0; border-bottom: 1px solid #eee; font-size: 13px; }
  td.qty { text-align: right; color: #5a6b73; }
  .step { margin-top: 16px; padding-top: 8px; border-top: 1px solid #eee; }
  .step h3 { margin-bottom: 2px; }
  ul { margin: 4px 0; padding-left: 20px; font-size: 13px; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${recipe.description ? `<p class="muted">${escapeHtml(recipe.description)}</p>` : ""}
  ${recipe.servings ? `<p class="muted">Servings: ${escapeHtml(recipe.servings)}</p>` : ""}
  ${notesHtml}
  <h2>Ingredients</h2>
  ${ingredientsHtml}
  <h2>Steps</h2>
  ${stepsHtml}
</body>
</html>`;
}
