// Ingredient quantity parsing, scaling, and display — pure, no DOM. Backs the
// ingredients multiplier: a transient, per-recipe scale factor that is never
// saved into the recipe's own data (see app.js's getIngredientsMultiplier).
//
// An ingredient quantity is entered as either a plain decimal ("0.5") or a
// simple fraction ("1/2") — both accepted, per spec. The display rule for a
// scaled result depends on which one the user typed, not on which one looks
// "nicer" after scaling:
//   - A decimal input always displays its scaled result as a decimal, e.g.
//     0.5 cup x0.25 = 0.125 cup.
//   - A fraction input displays its scaled result as a fraction ONLY when
//     that result reduces to one of the standard kitchen fraction
//     denominators (halves, thirds, quarters, eighths, sixteenths, or their
//     doublings — thirty-seconds, sixty-fourths); anything else falls back
//     to decimal, e.g. 1/2 cup x0.25 = 1/8 cup, but 1/2 cup x0.24 = 0.12 cup.
// The multiplier itself is always a plain decimal, never a fraction.
const NICE_DENOMINATORS = new Set([2, 3, 4, 8, 16, 32, 64]);

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

// Converts a plain decimal number to an exact fraction by reading its own
// shortest decimal string representation (e.g. 0.24 -> 24/100) rather than
// doing float arithmetic on it directly, which would reintroduce the
// binary-floating-point error this whole exact-fraction path exists to
// avoid (0.1 + 0.2 !== 0.3, but "0.1".length and "0.2".length are exact).
function decimalToFraction(num) {
  if (Number.isInteger(num)) return { numerator: num, denominator: 1 };
  const s = Math.abs(num).toString();
  const dot = s.indexOf(".");
  if (dot === -1 || s.includes("e")) {
    // Scientific notation or similar — not a shape a hand-typed multiplier
    // produces, but never throw over it.
    return { numerator: Math.round(num * 1_000_000), denominator: 1_000_000 };
  }
  const decimalDigits = s.length - dot - 1;
  const denominator = 10 ** decimalDigits;
  const numerator = Number(s.replace(".", ""));
  return { numerator: (num < 0 ? -1 : 1) * numerator, denominator };
}

/**
 * @returns {{kind: "decimal", value: number} | {kind: "fraction", numerator: number, denominator: number} | null}
 *   null for a blank string (no quantity given — a valid, common case, e.g.
 *   "salt, to taste") or text that is neither a decimal nor a simple
 *   fraction.
 */
export function parseQuantity(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const fraction = /^(\d+)\/(\d+)$/.exec(s);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return { kind: "fraction", numerator: Number(fraction[1]), denominator };
  }
  const value = Number(s);
  return Number.isFinite(value) ? { kind: "decimal", value } : null;
}

// True for a blank quantity (nothing to validate) or one parseQuantity
// accepts — the one check recipe.js's validateRecipe needs, without every
// caller having to know parseQuantity's null-vs-blank distinction.
export function isValidQuantityString(raw) {
  const s = String(raw ?? "").trim();
  return s === "" || parseQuantity(s) !== null;
}

/**
 * @param {ReturnType<typeof parseQuantity>} parsed
 * @param {number} multiplier
 * @returns {ReturnType<typeof parseQuantity>} same shape as parseQuantity's
 *   result, so formatQuantity can render either — but the returned `kind`
 *   is the DISPLAY kind (post fraction-niceness check), not necessarily the
 *   input's own kind.
 */
export function scaleQuantity(parsed, multiplier) {
  if (!parsed) return null;
  if (parsed.kind === "decimal") {
    return { kind: "decimal", value: parsed.value * multiplier };
  }
  const m = decimalToFraction(multiplier);
  let numerator = parsed.numerator * m.numerator;
  let denominator = parsed.denominator * m.denominator;
  const g = gcd(numerator, denominator);
  numerator /= g;
  denominator /= g;
  if (NICE_DENOMINATORS.has(Math.abs(denominator))) {
    return { kind: "fraction", numerator, denominator };
  }
  // Not a nice kitchen fraction — fall back to the exact decimal value
  // (computed from the original fraction, not from the already-reduced
  // numerator/denominator, so it's not affected by the reduction above).
  return { kind: "decimal", value: (parsed.numerator / parsed.denominator) * multiplier };
}

export function formatQuantity(scaled) {
  if (!scaled) return "";
  if (scaled.kind === "fraction") return `${scaled.numerator}/${scaled.denominator}`;
  // Rounded before stringifying so float noise (e.g. 0.1 + 0.2) never
  // surfaces as a quantity nobody typed; four places is far past what any
  // kitchen measurement needs, so this never trims a real digit a user
  // entered.
  return String(Math.round(scaled.value * 10_000) / 10_000);
}
