/**
 * src/server/generation/adapters/mock.js
 *
 * MockGenerationAdapter — a fully deterministic adapter that makes zero
 * network calls.  Used for tests, local development, and as the default
 * provider when GENERATION_PROVIDER is not set.
 *
 * Behaviour:
 *   - submit()  immediately returns a synthetic jobId with status 'pending'.
 *   - poll()    transitions: pending -> running -> succeeded across calls.
 *               On the first poll the status advances to 'running', on the
 *               second (and any subsequent) poll to 'succeeded'.
 *   - A forced-failure path is available: set `prompt` to the string
 *     "__fail__" and submit/poll will resolve to status 'failed'.
 *
 * Cost:
 *   - Each succeeded job reports cost.credits = 1 (a fixed placeholder).
 *   - Failed jobs report cost.credits = 0 (no charge on failure).
 */

import { GenerationAdapter, GenerationError } from "../adapter.js";

/** @type {Map<string, { status: string, prompt: string, pollCount: number }>} */
const _store = new Map();

let _idCounter = 0;

function _nextId() {
  return `mock-job-${++_idCounter}`;
}

export class MockGenerationAdapter extends GenerationAdapter {
  /**
   * @param {Record<string, unknown>} [config] — accepted for factory-pattern
   *   symmetry with real adapters (which take provider config). The mock
   *   ignores it but stores it so it serves as a template for new adapters.
   */
  constructor(config = {}) {
    super();
    this.config = config;
  }

  /**
   * @param {import('../types.js').GenerationRequest} request
   * @returns {Promise<{ jobId: string, status: 'pending' }>}
   */
  async submit(request) {
    const jobId = _nextId();
    _store.set(jobId, {
      status: "pending",
      prompt: request.prompt ?? "",
      pollCount: 0,
    });
    return { jobId, status: "pending" };
  }

  /**
   * @param {string} jobId
   * @returns {Promise<import('../types.js').GenerationResult>}
   */
  async poll(jobId) {
    const job = _store.get(jobId);

    if (!job) {
      throw new GenerationError(`Unknown jobId: ${jobId}`, {
        provider: "mock",
        code: "NOT_FOUND",
      });
    }

    const shouldFail = job.prompt === "__fail__";

    // Advance state machine each poll: pending -> running -> terminal
    if (job.status === "pending") {
      job.status = "running";
    } else if (job.status === "running") {
      job.status = shouldFail ? "failed" : "succeeded";
    }

    const terminal = job.status === "succeeded" || job.status === "failed";

    if (terminal) {
      // Clean up completed jobs (success OR failure) to keep memory bounded
      _store.delete(jobId);
    }

    if (job.status === "failed") {
      const err = new GenerationError("Mock forced failure", {
        provider: "mock",
        code: "FORCED_FAILURE",
        raw: { prompt: job.prompt },
      });
      return {
        jobId,
        status: "failed",
        assetUrl: null,
        provider: "mock",
        model: "mock-v1",
        cost: { credits: 0, currency: "MOCK_CREDITS" },
        raw: { prompt: job.prompt },
        error: err,
      };
    }

    return {
      jobId,
      status: job.status,
      assetUrl:
        job.status === "succeeded"
          ? `https://mock.branch.local/assets/${jobId}.png`
          : null,
      provider: "mock",
      model: "mock-v1",
      cost:
        job.status === "succeeded"
          ? { credits: 1, currency: "MOCK_CREDITS" }
          : { credits: 0, currency: "MOCK_CREDITS" },
      raw: { prompt: job.prompt },
      error: null,
    };
  }
}
