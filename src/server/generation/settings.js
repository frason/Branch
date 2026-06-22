/**
 * src/server/generation/settings.js
 *
 * Provider-agnostic generation settings schema (capabilities).
 *
 * This module defines:
 *   - The UNIVERSAL control vocabulary (normalized keys common to all image generators).
 *   - The descriptor shape for an individual control.
 *   - The CAPABILITIES descriptor shape that each adapter returns from getCapabilities().
 *   - Pure helper functions: defaultSettings() and validateSettings().
 *
 * No provider SDKs or HTTP calls live here — pure data and pure functions only.
 */

// ---------------------------------------------------------------------------
// Control type vocabulary
// ---------------------------------------------------------------------------

/**
 * Control type constants.
 *
 * 'enum'    — pick one value from a fixed list (see `options`).
 * 'int'     — whole integer, constrained by min/max/step.
 * 'number'  — floating-point, constrained by min/max/step.
 * 'string'  — free-form text.
 * 'boolean' — true / false toggle.
 */
export const CONTROL_TYPES = /** @type {const} */ ({
  ENUM: "enum",
  INT: "int",
  NUMBER: "number",
  STRING: "string",
  BOOLEAN: "boolean",
});

// ---------------------------------------------------------------------------
// Universal control keys
// ---------------------------------------------------------------------------

/**
 * Normalized universal control keys common to image generation providers.
 * Adapters declare which of these they support in their capabilities descriptor.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const UNIVERSAL_KEYS = /** @type {const} */ ({
  ASPECT_RATIO: "aspectRatio",
  NUM_IMAGES: "numImages",
  SEED: "seed",
  GUIDANCE: "guidance",
  STEPS: "steps",
  NEGATIVE_PROMPT: "negativePrompt",
});

// ---------------------------------------------------------------------------
// JSDoc type definitions
// ---------------------------------------------------------------------------

/**
 * Descriptor for a single generation control.
 *
 * @typedef {Object} ControlDescriptor
 * @property {string}    key      - Normalized settings key (matches UNIVERSAL_KEYS or a provider-specific key).
 * @property {string}    label    - Human-readable label for the UI.
 * @property {string}    type     - Control type: 'enum' | 'int' | 'number' | 'string' | 'boolean'.
 * @property {string[]}  [options]  - For type 'enum': the allowed values.
 * @property {number}    [min]    - For numeric types: minimum value (inclusive).
 * @property {number}    [max]    - For numeric types: maximum value (inclusive).
 * @property {number}    [step]   - For numeric types: granularity step.
 * @property {*}         [default] - Default value for this control.
 * @property {string}    [help]   - Optional tooltip / help text.
 */

/**
 * Capabilities descriptor returned by adapter.getCapabilities().
 *
 * `universal` — a map of UNIVERSAL_KEYS entries this adapter supports.
 *   Each value is a ControlDescriptor (with the adapter's valid ranges/options/defaults).
 *   Only include keys the adapter genuinely supports; omit unsupported universal controls.
 *
 * `advanced` — an ordered array of provider/model-specific ControlDescriptors
 *   surfaced under an "Advanced" section in the UI. These keys are NOT in UNIVERSAL_KEYS.
 *
 * @typedef {Object} AdapterCapabilities
 * @property {Record<string, ControlDescriptor>} universal - Supported universal controls.
 * @property {ControlDescriptor[]}               advanced  - Provider-specific advanced controls.
 */

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build a settings object containing the default value for every control
 * declared in the capabilities descriptor.
 *
 * Controls without a `default` property are omitted from the result.
 *
 * @param {AdapterCapabilities} capabilities
 * @returns {Record<string, *>} A settings object with defaults applied.
 */
export function defaultSettings(capabilities) {
  const result = {};

  // Universal controls
  for (const [key, descriptor] of Object.entries(capabilities.universal ?? {})) {
    if (descriptor.default !== undefined) {
      result[key] = descriptor.default;
    }
  }

  // Advanced controls
  for (const descriptor of capabilities.advanced ?? []) {
    if (descriptor.default !== undefined) {
      result[descriptor.key] = descriptor.default;
    }
  }

  return result;
}

/**
 * Validate and clean a settings object against a capabilities descriptor.
 *
 * Rules applied:
 *   1. Unknown keys (not declared in universal or advanced) are dropped.
 *   2. Enum values not in the declared `options` list are replaced with the
 *      control's default (or dropped if no default exists).
 *   3. Numeric values (int / number) are clamped to [min, max] when both are
 *      declared. Out-of-range values are clamped (not rejected), because this
 *      is a UX normalization step, not a strict guard.
 *   4. For type 'int', values are rounded to the nearest integer after clamping.
 *   5. Boolean values are coerced to a real boolean.
 *   6. String values are passed through unchanged.
 *   7. Controls with no supplied value that have a `default` receive the default.
 *
 * Returns a clean settings object. Never throws.
 *
 * @param {AdapterCapabilities} capabilities
 * @param {Record<string, *>}   settings     - Raw / user-supplied settings.
 * @returns {{ settings: Record<string, *>, issues: string[] }}
 *   `settings` is the validated+cleaned object.
 *   `issues`   is a human-readable list of what was changed (for logging/debugging).
 */
export function validateSettings(capabilities, settings) {
  const cleaned = {};
  const issues = [];

  // Build a combined lookup of all declared controls
  /** @type {Map<string, ControlDescriptor>} */
  const knownControls = new Map();

  for (const [key, descriptor] of Object.entries(capabilities.universal ?? {})) {
    knownControls.set(key, descriptor);
  }
  for (const descriptor of capabilities.advanced ?? []) {
    knownControls.set(descriptor.key, descriptor);
  }

  // First pass: validate all supplied settings keys
  for (const [key, value] of Object.entries(settings ?? {})) {
    const descriptor = knownControls.get(key);

    if (!descriptor) {
      issues.push(`Unknown key "${key}" dropped.`);
      continue;
    }

    const coerced = _coerce(descriptor, value, issues);
    if (coerced !== undefined) {
      cleaned[key] = coerced;
    }
  }

  // Second pass: apply defaults for any declared control that wasn't supplied
  for (const [key, descriptor] of knownControls) {
    if (!(key in cleaned) && descriptor.default !== undefined) {
      cleaned[key] = descriptor.default;
    }
  }

  return { settings: cleaned, issues };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerce and validate a single value against its control descriptor.
 * Returns the cleaned value, or undefined if the value is invalid and has no default.
 *
 * @param {ControlDescriptor} descriptor
 * @param {*}                 value
 * @param {string[]}          issues     - Mutated to record any problems found.
 * @returns {*}
 */
function _coerce(descriptor, value, issues) {
  const { key, type } = descriptor;

  // Treat null/undefined as "not provided" — fall back to the default (which
  // may itself be undefined, i.e. leave the control unset). For typed controls,
  // an empty string is also "not provided": without this, `Number("")` → 0
  // would silently turn an empty seed into seed 0, and `Boolean("")` → false
  // would silently disable a boolean — changing behavior the user never asked
  // for. A STRING control may legitimately be empty, so it's exempt.
  if (value === null || value === undefined) {
    return descriptor.default;
  }
  if (value === "" && type !== CONTROL_TYPES.STRING) {
    return descriptor.default;
  }

  switch (type) {
    case CONTROL_TYPES.ENUM: {
      const options = descriptor.options ?? [];
      if (options.includes(value)) {
        return value;
      }
      issues.push(
        `"${key}" value "${value}" is not a valid option (${options.join(", ")}). ` +
          (descriptor.default !== undefined
            ? `Replaced with default "${descriptor.default}".`
            : "Dropped (no default).")
      );
      return descriptor.default; // may be undefined
    }

    case CONTROL_TYPES.INT: {
      let num = Number(value);
      if (!isFinite(num)) {
        issues.push(`"${key}" value ${JSON.stringify(value)} is not a valid number. Dropped.`);
        return descriptor.default;
      }
      num = Math.round(num);
      if (descriptor.min !== undefined && num < descriptor.min) {
        issues.push(`"${key}" value ${num} below minimum ${descriptor.min}. Clamped.`);
        num = descriptor.min;
      }
      if (descriptor.max !== undefined && num > descriptor.max) {
        issues.push(`"${key}" value ${num} above maximum ${descriptor.max}. Clamped.`);
        num = descriptor.max;
      }
      return num;
    }

    case CONTROL_TYPES.NUMBER: {
      let num = Number(value);
      if (!isFinite(num)) {
        issues.push(`"${key}" value ${JSON.stringify(value)} is not a valid number. Dropped.`);
        return descriptor.default;
      }
      if (descriptor.min !== undefined && num < descriptor.min) {
        issues.push(`"${key}" value ${num} below minimum ${descriptor.min}. Clamped.`);
        num = descriptor.min;
      }
      if (descriptor.max !== undefined && num > descriptor.max) {
        issues.push(`"${key}" value ${num} above maximum ${descriptor.max}. Clamped.`);
        num = descriptor.max;
      }
      return num;
    }

    case CONTROL_TYPES.BOOLEAN: {
      return Boolean(value);
    }

    case CONTROL_TYPES.STRING: {
      return String(value);
    }

    default: {
      // Unknown type — pass through unchanged
      return value;
    }
  }
}
