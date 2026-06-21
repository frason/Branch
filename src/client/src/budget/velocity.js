/**
 * velocity.js
 *
 * Pure, deterministic budget + velocity math — no React, no DOM, no Date.now()
 * calls inside the functions. All callers pass `now` explicitly so these
 * functions are trivially unit-testable.
 *
 * Spend event shape: { ts: number (ms epoch), credits: number }
 *
 * NOTE: the configured budget (TOTAL_BUDGET) lives here as a documented
 * constant.  A backend-authoritative version could replace these functions with
 * API-fetched totals while keeping the same call signatures — callers (the
 * budget store) would just pass the server-returned balance instead.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Total credit budget for the session.
 * Change this value to adjust the starting budget without touching UI or store.
 */
export const TOTAL_BUDGET = 100;

/**
 * Default trailing window for rolling velocity, in milliseconds.
 * 60 000 ms = 1 minute, so velocity is naturally expressed in credits/minute.
 */
export const DEFAULT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

/**
 * Compute spent + remaining credits given a list of spend events.
 *
 * @param {Array<{ts: number, credits: number}>} events  — ordered or unordered
 * @param {number} totalBudget                           — configured cap (e.g. TOTAL_BUDGET)
 * @returns {{ spent: number, remaining: number, overBudget: boolean }}
 */
export function computeBalance(events, totalBudget) {
  const spent = events.reduce((acc, e) => acc + (e.credits ?? 0), 0);
  const remaining = Math.max(0, totalBudget - spent);
  const overBudget = spent > totalBudget;
  return { spent, remaining, overBudget };
}

// ---------------------------------------------------------------------------
// Rolling velocity
// ---------------------------------------------------------------------------

/**
 * Compute rolling spend velocity over a trailing window.
 *
 * Only events whose timestamp falls within [now - windowMs, now] are counted.
 * The result is expressed as credits per minute, so it matches the window:
 *   velocity = (credits in window) / (windowMs / 60_000)
 *
 * @param {Array<{ts: number, credits: number}>} events  — all historical events
 * @param {number} windowMs                              — trailing window in ms
 * @param {number} now                                   — reference timestamp (ms epoch)
 * @returns {number}  credits per minute (0 if no events in window)
 */
export function computeVelocity(events, windowMs, now) {
  // A non-positive window has no meaningful rate (and would divide by zero).
  if (!(windowMs > 0)) return 0;
  const cutoff = now - windowMs;
  const windowCredits = events
    .filter((e) => e.ts >= cutoff && e.ts <= now)
    .reduce((acc, e) => acc + (e.credits ?? 0), 0);

  if (windowCredits === 0) return 0;

  // credits / (window in minutes)
  return windowCredits / (windowMs / 60_000);
}
