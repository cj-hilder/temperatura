// Ingredient quantity parsing, scaling, and display — pure, no DOM. Backs the
// ingredients multiplier: a transient, per-recipe scale factor that is never
// saved into the recipe's own data (see app.js's getIngredientsMultiplier).
//
// An ingredient quantity is entered as a plain decimal ("0.5"), a simple
// fraction ("1/2") or a mixed number ("1 1/2") — all accepted, per spec. The
// display rule for a scaled result depends on which one the user typed, not
// on which one looks "nicer" after scaling:
//   - A decimal input always displays its scaled result as a decimal, e.g.
//     0.5 cup x0.25 = 0.125 cup.
//   - A fraction or mixed-number input always displays a fraction (a mixed
//     number above 1: "2 1/4") that a measuring set can actually measure.
//     The result is rounded two ways — to the nearest 1/64 (a standard
//     set's spoons: 1, 1/2, 1/4 … 1/64) and to the nearest 1/3 (1/3 cup is
//     a standard measure that no number of 64ths equals) — and whichever
//     rounding lands closer to the true amount is shown, simplified. A
//     kitchen has no use for 9/20 of a cup (→ 29/64), and 0.3335 of a cup is
//     really 1/3, not 21/64.
//   - Only if that rounds to nothing is a decimal shown, since "0" would
//     hide a real, if tiny, amount (1 1/2 x0.005 = 0.0075).
// The multiplier itself is always a plain decimal, never a fraction.
//
// Sixths and twelfths are opt-in (the "Sixths and twelfths" setting): only
// some measuring sets have those spoons. With it on, the second rounding is
// to the nearest 1/12 instead of 1/3 (which covers thirds and sixths too).
const SPOON_STEPS = 64;
const THIRDS_STEPS = 3;
const TWELFTHS_STEPS = 12;

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
 *   A mixed number comes back as one improper fraction ("1 1/2" → 3/2).
 *   null for a blank string (no quantity given — a valid, common case, e.g.
 *   "salt, to taste") or text that is none of decimal, fraction or mixed
 *   number.
 */
export function parseQuantity(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(s);
  if (fraction) {
    const whole = fraction[1] === undefined ? 0 : Number(fraction[1]);
    const denominator = Number(fraction[3]);
    if (denominator === 0) return null;
    return { kind: "fraction", numerator: whole * denominator + Number(fraction[2]), denominator };
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
 * @param {{sixths?: boolean}} [opts] - the "Sixths and twelfths" setting
 * @returns {ReturnType<typeof parseQuantity>} same shape as parseQuantity's
 *   result, so formatQuantity can render either — but the returned `kind`
 *   is the DISPLAY kind: a fraction input only comes back as a decimal when
 *   rounding to 1/64 would leave nothing.
 */
export function scaleQuantity(parsed, multiplier, { sixths = false } = {}) {
  if (!parsed) return null;
  if (parsed.kind === "decimal") {
    return { kind: "decimal", value: parsed.value * multiplier };
  }
  const m = decimalToFraction(multiplier);
  const exact = reduce(parsed.numerator * m.numerator, parsed.denominator * m.denominator);
  const spoon = roundTo(exact, SPOON_STEPS);
  const other = roundTo(exact, sixths ? TWELFTHS_STEPS : THIRDS_STEPS);
  // A tie goes to the 64ths: the standard set is the one every kitchen has.
  const chosen = other.error < spoon.error ? other : spoon;
  // Both roundings are 0 together, since 1/128 (half a 64th) is far below
  // 1/24 (half a twelfth).
  if (chosen.numerator === 0) {
    return { kind: "decimal", value: (parsed.numerator / parsed.denominator) * multiplier };
  }
  return { kind: "fraction", ...reduce(chosen.numerator, chosen.denominator) };
}

// `exact` (n/d) rounded to the nearest 1/steps, and how far that is from
// the true amount. All integer arithmetic on the exact fraction, never
// float, so "nearest" and "closer" are decided on the true value: the error
// is |n/d − k/steps| expressed in units of 1/(d·768). 768 = 64 × 12, which
// every `steps` used here (64, 12, 3) divides, so the division is exact and
// errors from different roundings are directly comparable.
function roundTo(exact, steps) {
  const k = Math.round((exact.numerator * steps) / exact.denominator);
  const error = (Math.abs(exact.numerator * steps - k * exact.denominator) * (SPOON_STEPS * TWELFTHS_STEPS)) / steps;
  return { numerator: k, denominator: steps, error };
}

function reduce(numerator, denominator) {
  const g = gcd(numerator, denominator);
  return { numerator: numerator / g, denominator: denominator / g };
}

export function formatQuantity(scaled) {
  if (!scaled) return "";
  if (scaled.kind === "fraction") {
    const { numerator: n, denominator: d } = scaled;
    const whole = Math.floor(n / d);
    const rest = n % d;
    if (rest === 0) return String(whole);
    return whole === 0 ? `${rest}/${d}` : `${whole} ${rest}/${d}`;
  }
  // Rounded before stringifying so float noise (e.g. 0.1 + 0.2) never
  // surfaces as a quantity nobody typed; four places is far past what any
  // kitchen measurement needs, so this never trims a real digit a user
  // entered.
  return String(Math.round(scaled.value * 10_000) / 10_000);
}
