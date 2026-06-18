/**
 * src/server/repo/index.js
 *
 * Repository factory — mirrors the generation adapter registry pattern:
 * - No DATABASE_URL  →  in-memory repo (default; dev + tests, no infra needed)
 * - DATABASE_URL set →  Postgres-backed repo
 *
 * A singleton is returned so state is shared across all callers within a
 * single process lifetime.  Tests that need isolation should construct a
 * fresh MemoryRepo directly rather than going through getRepo().
 */

import { MemoryRepo } from "./memory.js";
import { PostgresRepo } from "./postgres.js";

/** @type {MemoryRepo | PostgresRepo | null} */
let _instance = null;

/**
 * Return the active repository instance.
 * Call once at startup or lazily — subsequent calls return the same instance.
 *
 * @returns {MemoryRepo | PostgresRepo}
 */
export function getRepo() {
  if (_instance) return _instance;

  if (process.env.DATABASE_URL) {
    _instance = new PostgresRepo();
  } else {
    _instance = new MemoryRepo();
  }

  return _instance;
}

/**
 * Replace the singleton with a fresh instance.
 * Intended for test isolation — not for production use.
 *
 * @param {MemoryRepo | PostgresRepo | null} [repo]
 *   Pass an instance to inject, or omit/null to force re-initialisation on
 *   the next getRepo() call.
 */
export function _setRepoForTesting(repo = null) {
  _instance = repo;
}

export { MemoryRepo } from "./memory.js";
export { PostgresRepo } from "./postgres.js";
export { NotFoundError } from "./errors.js";
