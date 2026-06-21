/**
 * src/server/generation/index.js
 *
 * Public surface of the generation subsystem.
 *
 * Import from here rather than from individual files so internal paths can
 * change without updating every callsite.
 *
 * Example usage:
 *
 *   import {
 *     GenerationAdapter,
 *     GenerationError,
 *     registerAdapter,
 *     createAdapter,
 *     registeredAdapters,
 *   } from './generation/index.js';
 *
 *   const adapter = createAdapter(); // uses GENERATION_PROVIDER or 'mock'
 *   const result  = await adapter.generate({ prompt: 'A stormy sea at dusk' });
 *   console.log(result.assetUrl, result.cost.credits);
 */

export { GenerationAdapter, GenerationError } from "./adapter.js";
export { registerAdapter, createAdapter, registeredAdapters } from "./registry.js";

// Re-export the built-in adapters. These re-exports also ensure each adapter
// module is imported, so its registerAdapter(...) side-effect runs and the
// provider is reachable via createAdapter(name) through this entry point
// (not just when a test imports the file directly).
export { MockGenerationAdapter } from "./adapters/mock.js";
export { FluxFalAdapter } from "./adapters/flux-fal.js";
