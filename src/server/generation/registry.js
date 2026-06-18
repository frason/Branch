/**
 * src/server/generation/registry.js
 *
 * Adapter registry + factory.
 *
 * How it works
 * ------------
 * Adapters register themselves under a string name.  The factory function
 * receives a config object (typically derived from environment variables) and
 * returns a new adapter instance.  The registry is a simple Map so it works
 * in any ESM context with no build step.
 *
 * Selecting a provider
 * --------------------
 * Set the GENERATION_PROVIDER environment variable to the registered adapter
 * name before starting the server, e.g.:
 *
 *   GENERATION_PROVIDER=flux-fal node src/server/index.js
 *
 * If GENERATION_PROVIDER is not set, the registry falls back to "mock".
 *
 * Adding a new provider (e.g. Flux via fal.ai)
 * --------------------------------------------
 * 1. Create `src/server/generation/adapters/flux-fal.js` and export a class
 *    that extends GenerationAdapter, implementing `submit` and `poll`.
 * 2. In that file (or in an init module), call:
 *
 *      import { registerAdapter } from '../registry.js';
 *      registerAdapter('flux-fal', (config) => new FluxFalAdapter(config));
 *
 * 3. Set GENERATION_PROVIDER=flux-fal in your environment.
 * 4. Done — no other files need to change.
 *
 * The mock adapter is registered by this module itself so it is always
 * available without any additional setup.
 */

import { MockGenerationAdapter } from "./adapters/mock.js";

/** @type {Map<string, (config: object) => import('./adapter.js').GenerationAdapter>} */
const _registry = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an adapter factory under a name.
 *
 * Call this once per provider, typically at module load time (top-level
 * `import` side-effect or explicit initialisation call).
 *
 * @param {string}   name    - Unique provider name (e.g. "mock", "flux-fal").
 * @param {(config: object) => import('./adapter.js').GenerationAdapter} factory
 *   - A function that receives a config object and returns a new adapter instance.
 */
export function registerAdapter(name, factory) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("Adapter name must be a non-empty string");
  }
  if (typeof factory !== "function") {
    throw new TypeError("Adapter factory must be a function");
  }
  _registry.set(name, factory);
}

/**
 * Create (instantiate) an adapter by name.
 *
 * @param {string} [name]     - Registered adapter name.  Defaults to the value
 *                              of the GENERATION_PROVIDER env var, which itself
 *                              defaults to "mock".
 * @param {object} [config]   - Passed verbatim to the factory (e.g. API keys,
 *                              base URLs, timeouts).
 * @returns {import('./adapter.js').GenerationAdapter}
 * @throws {Error} if `name` is not registered.
 */
export function createAdapter(name, config = {}) {
  const resolvedName = name ?? process.env.GENERATION_PROVIDER ?? "mock";
  const factory = _registry.get(resolvedName);

  if (!factory) {
    throw new Error(
      `No generation adapter registered under "${resolvedName}". ` +
        `Available adapters: ${[..._registry.keys()].join(", ") || "(none)"}.`
    );
  }

  return factory(config);
}

/**
 * Return the list of currently registered adapter names.
 * Useful for introspection and health-check endpoints.
 *
 * @returns {string[]}
 */
export function registeredAdapters() {
  return [..._registry.keys()];
}

// ---------------------------------------------------------------------------
// Built-in registrations
// ---------------------------------------------------------------------------

// The mock adapter is always registered so tests and local dev work out of
// the box with no environment variables.
registerAdapter("mock", (config) => new MockGenerationAdapter(config));
