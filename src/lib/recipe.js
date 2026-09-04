// Recipe and step schema, validation, and JSON import/export shaping. Pure —
// no DOM, no clock, no BLE. Id assignment is deliberately NOT this module's
// job — storage.js's Store already owns id generation (mirroring RTW's
// Store.createRoute), so a blank recipe/step here just takes whatever id its
// caller already decided on.

export function createBlankRecipe(id) {
  return {
    id,
    name: "",
    description: "",
    notes: [],
    servings: "",
    ingredients: [],
    steps: [],
  };
}

export function createBlankStep(id) {
  return {
    id,
    name: "",
    description: "",
    duration: null, // { ms, kind: "fixed" | "inBand" }
    timeAlarms: [], // { id, name, atMs, repeat, intervalMs, theme }
    tempBand: null, // { lowC, highC }
    tempAlarms: [], // { id, name, thresholdC, direction: "heating" | "cooling", theme }
    durationReachedAlarm: null, // { enabled, theme } — only meaningful when duration is set
    // Implicit band-boundary alarms — always present whenever tempBand is
    // set, never individually disabled, only themeable. See
    // buildStepAlarmDefs. { theme } only, unlike durationReachedAlarm — spec
    // gives these no enabled/disabled toggle.
    bandMinAlarm: { theme: null },
    bandMaxAlarm: { theme: null },
  };
}

/**
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateStep(step) {
  const errors = [];
  if (!step.name || typeof step.name !== "string") errors.push("Step name is required.");

  if (step.duration) {
    if (!["fixed", "inBand"].includes(step.duration.kind)) {
      errors.push(`Step "${step.name}": duration kind must be "fixed" or "inBand".`);
    }
    // The one combination the spec calls out explicitly as invalid.
    if (step.duration.kind === "inBand" && !step.tempBand) {
      errors.push(`Step "${step.name}": a duration "in temperature band" needs a temperature band.`);
    }
    if (!(step.duration.ms > 0)) {
      errors.push(`Step "${step.name}": duration must be a positive number of milliseconds.`);
    }
  }

  if (step.tempBand) {
    const { lowC, highC } = step.tempBand;
    if (!(typeof lowC === "number" && typeof highC === "number" && lowC < highC)) {
      errors.push(`Step "${step.name}": temperature band must have lowC < highC.`);
    }
  }

  for (const alarm of step.timeAlarms) {
    if (!alarm.name) errors.push(`Step "${step.name}": every time alarm needs a name.`);
    if (!(alarm.atMs >= 0)) errors.push(`Step "${step.name}": time alarm "${alarm.name}" needs a valid time.`);
    if (alarm.repeat && !(alarm.intervalMs > 0)) {
      errors.push(`Step "${step.name}": repeating time alarm "${alarm.name}" needs a positive repeat interval.`);
    }
  }

  for (const alarm of step.tempAlarms) {
    if (!alarm.name) errors.push(`Step "${step.name}": every temperature alarm needs a name.`);
    if (!["heating", "cooling"].includes(alarm.direction)) {
      errors.push(`Step "${step.name}": temperature alarm "${alarm.name}" needs a heating/cooling direction.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateRecipe(recipe) {
  const errors = [];
  if (!recipe.name || typeof recipe.name !== "string") errors.push("Recipe name is required.");
  for (const step of recipe.steps) {
    const stepResult = validateStep(step);
    errors.push(...stepResult.errors);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Bridges this module's storage shape to alarms.js's evaluation shape.
 * timeAlarms/tempAlarms are stored as separate untagged arrays, and the
 * duration-reached alarm lives in its own field, separate from user-created
 * time alarms — evaluateAlarms() wants one flat, kind-tagged array.
 * @returns {Array} stepAlarmDefs, ready for alarms.js
 */
export function buildStepAlarmDefs(step) {
  const defs = [
    ...step.timeAlarms.map((a) => ({ ...a, kind: "time" })),
    ...step.tempAlarms.map((a) => ({ ...a, kind: "temperature" })),
  ];
  if (step.duration && step.durationReachedAlarm?.enabled) {
    defs.push({
      id: `${step.id}-duration-reached`,
      kind: "duration",
      name: "Duration reached",
      atMs: step.duration.ms,
      repeat: false,
      intervalMs: null,
      theme: step.durationReachedAlarm.theme,
    });
  }
  // A temperature band always carries two implicit alarms — a cooling alarm
  // at the band's low edge and a heating alarm at its high edge — alerting
  // whenever the reading actually leaves the band, not just failing to
  // accumulate in-band time silently. Unlike durationReachedAlarm these have
  // no enabled/disabled toggle: they exist whenever the band does.
  if (step.tempBand) {
    defs.push({
      id: `${step.id}-band-min`,
      kind: "temperature",
      name: "Below band",
      thresholdC: step.tempBand.lowC,
      direction: "cooling",
      theme: step.bandMinAlarm?.theme ?? null,
    });
    defs.push({
      id: `${step.id}-band-max`,
      kind: "temperature",
      name: "Above band",
      thresholdC: step.tempBand.highC,
      direction: "heating",
      theme: step.bandMaxAlarm?.theme ?? null,
    });
  }
  return defs;
}

const EXPORT_FORMAT = "temperatura/recipe";
const EXPORT_VERSION = 1;

export function recipeToExportJSON(recipe) {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: Date.now(), recipe };
}

/**
 * Validates and unwraps a single-recipe export bundle. Does not assign an id —
 * the caller decides whether to reuse the bundled id or generate a fresh one.
 * @returns {{valid: boolean, errors: string[], recipe: object|null}}
 */
export function recipeFromImportJSON(bundle) {
  if (!bundle || bundle.format !== EXPORT_FORMAT) {
    return { valid: false, errors: ["Not a Temperatura recipe export file."], recipe: null };
  }
  const { valid, errors } = validateRecipe(bundle.recipe || {});
  return { valid, errors, recipe: valid ? bundle.recipe : null };
}
