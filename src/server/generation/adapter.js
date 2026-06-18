/**
 * src/server/generation/adapter.js
 *
 * Abstract base class for all generation adapters.
 *
 * Concrete adapters (e.g. MockGenerationAdapter, FluxFalAdapter) must extend
 * this class and override `submit` and `poll`.  The `generate` convenience
 * method is implemented once here in terms of submit + poll so concrete
 * adapters never need to rewrite the polling loop.
 *
 * Usage contract for the async queue:
 *   - Queue workers call `submit(request)` to kick off a job and receive a jobId.
 *   - Workers later call `poll(jobId)` to check status / retrieve the result.
 *   - Callers that do not care about the queue (e.g. tests, simple routes) call
 *     `generate(request)` which does both and awaits completion.
 */

/**
 * Provider-agnostic error class.
 *
 * All concrete adapters must catch their own provider-specific errors and
 * rethrow (or wrap) them as `GenerationError` so callers and the budget
 * service deal with a single error type.
 *
 * @property {string}  provider  - Registry name of the adapter that threw (e.g. "flux-fal").
 * @property {string}  code      - Short machine-readable code (e.g. "TIMEOUT", "AUTH_FAILED").
 * @property {unknown} raw       - Original provider error for debugging.
 */
export class GenerationError extends Error {
  /**
   * @param {string}  message
   * @param {Object}  [options]
   * @param {string}  [options.provider]
   * @param {string}  [options.code]
   * @param {unknown} [options.raw]
   */
  constructor(message, { provider = "unknown", code = "UNKNOWN", raw = null } = {}) {
    super(message);
    this.name = "GenerationError";
    this.provider = provider;
    this.code = code;
    this.raw = raw;
  }
}

/**
 * Abstract base class for generation adapters.
 *
 * Extend this class and implement `submit` and `poll`.
 * Do NOT call provider SDKs or HTTP clients directly from route handlers —
 * all provider calls must go through a concrete subclass of this adapter.
 */
export class GenerationAdapter {
  /**
   * Kick off an async generation job.
   *
   * Must be overridden by concrete adapters.
   *
   * @param {import('./types.js').GenerationRequest} _request
   * @returns {Promise<{ jobId: string, status: 'pending'|'running' }>}
   */
  // eslint-disable-next-line no-unused-vars
  async submit(_request) {
    throw new GenerationError("submit() not implemented", {
      provider: "base",
      code: "NOT_IMPLEMENTED",
    });
  }

  /**
   * Poll the status of an async generation job.
   *
   * Must be overridden by concrete adapters.
   *
   * @param {string} _jobId
   * @returns {Promise<import('./types.js').GenerationResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async poll(_jobId) {
    throw new GenerationError("poll() not implemented", {
      provider: "base",
      code: "NOT_IMPLEMENTED",
    });
  }

  /**
   * Convenience: submit a request and poll to completion.
   *
   * Implemented once here so concrete adapters do not need to repeat the
   * polling loop.  The queue will generally use submit + poll directly; this
   * method is for callers that want a single awaitable result.
   *
   * @param {import('./types.js').GenerationRequest} request
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs=500]   - How often to poll (ms).
   * @param {number} [options.timeoutMs=60000]      - Max total wait (ms).
   * @returns {Promise<import('./types.js').GenerationResult>}
   * @throws {GenerationError} on timeout or terminal failure.
   */
  async generate(request, { pollIntervalMs = 500, timeoutMs = 60_000 } = {}) {
    const { jobId } = await this.submit(request);

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await this.poll(jobId);

      if (result.status === "succeeded" || result.status === "failed") {
        return result;
      }

      // Still pending or running — wait before next poll
      await _sleep(pollIntervalMs);
    }

    throw new GenerationError(
      `Generation job ${jobId} timed out after ${timeoutMs}ms`,
      { provider: "base", code: "TIMEOUT" }
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
