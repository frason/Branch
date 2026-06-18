/**
 * src/server/generation/types.js
 *
 * JSDoc typedefs for the generation adapter contract.
 * No runtime code — import only for IDE/type-checking support.
 *
 * These types are the shared language between:
 *  - The generation adapter implementations (concrete providers)
 *  - The async generation queue (uses submit + poll)
 *  - The budget / velocity tracking service (reads cost on every result)
 */

/**
 * Merged per-generation settings.
 *
 * Branch-level settings (fixed per branch):
 *   aspectRatio, modelVersion
 *
 * Node-level settings (vary per generation iteration):
 *   lens, style, fStop, and any other provider-specific knobs
 *
 * The `settings` object is intentionally open so new providers can accept
 * their own keys without changing the contract.
 *
 * @typedef {Object} GenerationRequest
 * @property {string}  prompt                    - User-supplied generation prompt.
 * @property {Object}  [settings]                - Merged branch + node settings.
 * @property {string}  [settings.aspectRatio]    - e.g. "1:1", "16:9" (branch-level).
 * @property {string}  [settings.modelVersion]   - Provider model version (branch-level).
 * @property {string}  [settings.lens]           - Lens descriptor (node-level).
 * @property {string}  [settings.style]          - Style hint (node-level).
 * @property {number}  [settings.fStop]          - Aperture / depth-of-field (node-level).
 * @property {number}  [seed]                    - Optional reproducibility seed.
 */

/**
 * Cost metadata attached to every GenerationResult.
 *
 * This field is REQUIRED in the contract because it feeds the token-budget
 * and velocity-tracking system.  Every adapter MUST populate it, even if the
 * value is 0 (e.g. during local development or for a free tier).
 *
 * `credits`  — provider-native unit (Flux uses "credits", other providers may
 *              use tokens, compute-units, etc.).  Always a finite number >= 0.
 * `currency` — ISO 4217 code or provider label (e.g. "USD", "FAL_CREDITS").
 *              Optional; defaults to the provider's native unit.
 *
 * @typedef {Object} GenerationCost
 * @property {number} credits    - Numeric cost in provider-native units (>= 0).
 * @property {string} [currency] - Optional label for the unit (e.g. "FAL_CREDITS").
 */

/**
 * Normalised result returned by every adapter method.
 *
 * Status lifecycle:
 *   pending  -> The job has been accepted but work has not started.
 *   running  -> The provider is actively generating.
 *   succeeded -> Generation finished; assetUrl is non-null.
 *   failed   -> Generation failed; error is non-null.
 *
 * @typedef {Object} GenerationResult
 * @property {string}          jobId     - Provider-assigned or adapter-generated job ID.
 * @property {'pending'|'running'|'succeeded'|'failed'} status - Current lifecycle state.
 * @property {string|null}     assetUrl  - Public URL of the generated asset, or null if not yet available.
 * @property {string}          provider  - Adapter name as registered in the registry (e.g. "mock", "flux-fal").
 * @property {string}          model     - Specific model/version used (e.g. "flux-pro-1.1").
 * @property {GenerationCost}  cost      - Cost metadata. REQUIRED for budget + velocity tracking.
 * @property {unknown}         raw       - Unmodified provider response payload (for debugging/auditing).
 * @property {import('./adapter.js').GenerationError|null} error - Normalised error, or null on success.
 */
