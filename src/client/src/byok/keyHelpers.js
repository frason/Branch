/**
 * keyHelpers.js
 *
 * Pure, side-effect-free helpers for BYOK key handling.
 * No localStorage, no React, no fetch — fully unit-testable in a headless
 * Node environment.
 *
 * The fal.ai key stays in the browser's localStorage and is forwarded ONLY to
 * Branch's own backend proxy via the `x-provider-key` header.  It is never
 * sent directly to fal.ai or any other third party, and is never logged.
 */

// ---------------------------------------------------------------------------
// Key format check
// ---------------------------------------------------------------------------

/**
 * Light format check for a fal.ai API key.
 * fal.ai keys are in the format `key_id:key_secret` — they contain a colon
 * and are at least 10 characters long.  This is intentionally non-blocking:
 * formats can change, so we warn rather than hard-block on failure.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function looksLikeFalKey(key) {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  // Must be non-empty, contain a colon (key_id:key_secret format), and be
  // at least 10 chars (too short → clearly wrong).
  return trimmed.length >= 10 && trimmed.includes(":");
}

// ---------------------------------------------------------------------------
// Key masking
// ---------------------------------------------------------------------------

/**
 * Mask a key for display.  Shows the first segment before the colon (or up to
 * 8 chars) then "…" then the last 4 characters.
 *
 * Examples:
 *   "abc123def:ghijklmnop" → "abc123def…mnop"
 *   "short"                → "sh…ort"   (fallback for unexpected formats)
 *   ""                     → ""
 *
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  if (!key || typeof key !== "string") return "";
  const trimmed = key.trim();
  if (trimmed.length === 0) return "";

  const last4 = trimmed.slice(-4);

  // If there's a colon, show everything before it as the visible prefix.
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const prefix = trimmed.slice(0, colonIdx);
    return `${prefix}…${last4}`;
  }

  // Fallback for keys without a colon. For very short strings, a prefix + last4
  // would overlap and reveal (almost) the whole value, so mask aggressively
  // instead (such strings aren't valid fal keys anyway — looksLikeFalKey warns).
  if (trimmed.length <= 8) {
    return `…${trimmed.slice(-2)}`;
  }
  // Otherwise show first 4 chars + ellipsis + last 4 (no overlap).
  return `${trimmed.slice(0, 4)}…${last4}`;
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

/**
 * Build the extra headers needed to attach an API key to a generate request.
 * Returns an object with `x-provider-key` when apiKey is a non-empty string,
 * otherwise returns an empty object (no header is added).
 *
 * The key is sent ONLY to Branch's backend proxy (/api/trees/:id/generate)
 * and never to any third-party service directly.
 *
 * @param {string|null|undefined} apiKey
 * @returns {Record<string, string>}
 */
export function buildProviderKeyHeaders(apiKey) {
  if (apiKey && typeof apiKey === "string" && apiKey.trim().length > 0) {
    return { "x-provider-key": apiKey.trim() };
  }
  return {};
}
