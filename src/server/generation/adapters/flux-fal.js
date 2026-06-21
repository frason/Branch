/**
 * src/server/generation/adapters/flux-fal.js
 *
 * FluxFalAdapter — a real GenerationAdapter backed by fal.ai's Flux models
 * via the fal.ai queue REST API.
 *
 * Queue API flow:
 *   1. submit()  → POST https://queue.fal.run/{model_id}
 *                  Returns { request_id, response_url, status_url, cancel_url }
 *                  We store request_id as jobId.
 *
 *   2. poll()    → GET  https://queue.fal.run/{model_id}/requests/{request_id}/status
 *                  Maps fal status → normalized status:
 *                    IN_QUEUE    → 'running'
 *                    IN_PROGRESS → 'running'
 *                    COMPLETED   → fetch result from response URL → 'succeeded'
 *                  Failure (non-2xx or error field) → 'failed' with GenerationError
 *
 * response_url handling:
 *   The submit response contains a response_url, but the result can also be
 *   fetched from the deterministic URL:
 *     https://queue.fal.run/{model_id}/requests/{request_id}
 *   We reconstruct this URL in poll() from model + jobId so we do NOT need to
 *   store a jobId→response_url mapping on the instance.
 *
 * Cost estimation:
 *   fal.ai does NOT return billing cost in the API response. We compute an
 *   ESTIMATE: credits = num_images * config.creditsPerImage (default 1).
 *   The currency field is set to 'FAL_ESTIMATE' to make clear this is not
 *   real billing data. Actual charges appear in the fal.ai dashboard.
 *
 * Security:
 *   The API key is never logged or included in any thrown error message.
 *   The Authorization header uses the "Key {apiKey}" scheme as required by fal.
 */

import { GenerationAdapter, GenerationError } from "../adapter.js";
import { registerAdapter } from "../registry.js";
import { CONTROL_TYPES, UNIVERSAL_KEYS } from "../settings.js";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_MODEL = "fal-ai/flux/dev";
const DEFAULT_CREDITS_PER_IMAGE = 1;

export class FluxFalAdapter extends GenerationAdapter {
  /**
   * @param {Object} [config]
   * @param {string}   config.apiKey          - fal.ai API key (REQUIRED at submit time).
   * @param {string}   [config.model]         - fal model ID (default 'fal-ai/flux/dev').
   * @param {number}   [config.creditsPerImage] - Estimated credits per image (default 1).
   * @param {Function} [config.fetch]         - Injectable fetch (default globalThis.fetch).
   *                                            Inject in tests to stub HTTP — no live network.
   */
  constructor(config = {}) {
    super();
    // Store config but never log or expose apiKey
    this._apiKey = config.apiKey ?? null;
    this._model = config.model ?? DEFAULT_MODEL;
    this._creditsPerImage = config.creditsPerImage ?? DEFAULT_CREDITS_PER_IMAGE;
    // Injectable fetch: lets tests stub HTTP without any live network
    this._fetch = config.fetch ?? globalThis.fetch;
  }

  // ---------------------------------------------------------------------------
  // getCapabilities
  // ---------------------------------------------------------------------------

  /**
   * Return the capabilities descriptor for the Flux fal.ai adapter.
   *
   * Universal controls supported by Flux dev:
   *   - aspectRatio   — mapped to fal image_size enum presets.
   *   - numImages     — num_images (fal supports 1..8).
   *   - seed          — deterministic reproducibility seed.
   *   - guidance      — guidance_scale (prompt adherence, default 3.5).
   *   - steps         — num_inference_steps (quality/speed tradeoff, default 28).
   *   NOTE: negativePrompt is NOT supported by Flux dev — omitted so UI won't show it.
   *
   * Advanced (Flux-specific) controls:
   *   - model         — model variant (flux/dev | flux/schnell).
   *   - outputFormat  — output image format (jpeg | png).
   *   - enableSafetyChecker — content safety filtering toggle.
   *   - acceleration  — inference speed mode (none | regular | high).
   *
   * @returns {import('../settings.js').AdapterCapabilities}
   */
  getCapabilities() {
    return {
      universal: {
        [UNIVERSAL_KEYS.ASPECT_RATIO]: {
          key: UNIVERSAL_KEYS.ASPECT_RATIO,
          label: "Aspect ratio",
          type: CONTROL_TYPES.ENUM,
          options: ["1:1", "4:3", "3:4", "16:9", "9:16"],
          default: "4:3",
          help: "Output image aspect ratio. Mapped to fal image_size presets.",
        },
        [UNIVERSAL_KEYS.NUM_IMAGES]: {
          key: UNIVERSAL_KEYS.NUM_IMAGES,
          label: "Number of images",
          type: CONTROL_TYPES.INT,
          min: 1,
          max: 8,
          step: 1,
          default: 1,
          help: "How many images to generate per request.",
        },
        [UNIVERSAL_KEYS.SEED]: {
          key: UNIVERSAL_KEYS.SEED,
          label: "Seed",
          type: CONTROL_TYPES.INT,
          min: 0,
          max: 2147483647,
          step: 1,
          help: "Reproducibility seed. Leave unset for a random result.",
        },
        [UNIVERSAL_KEYS.GUIDANCE]: {
          key: UNIVERSAL_KEYS.GUIDANCE,
          label: "Guidance scale",
          type: CONTROL_TYPES.NUMBER,
          min: 1,
          max: 20,
          step: 0.5,
          default: 3.5,
          help: "How closely the output follows the prompt. Higher = more literal.",
        },
        [UNIVERSAL_KEYS.STEPS]: {
          key: UNIVERSAL_KEYS.STEPS,
          label: "Inference steps",
          type: CONTROL_TYPES.INT,
          min: 1,
          max: 50,
          step: 1,
          default: 28,
          help: "Number of denoising steps. More steps = higher quality but slower.",
        },
        // negativePrompt intentionally omitted — not supported by Flux dev.
      },
      advanced: [
        {
          // NOTE: this selects the fal endpoint, not a request-body field —
          // it's wired at adapter construction (config.model). The generate
          // route (#24) maps this setting to createAdapter('flux-fal', { model }).
          key: "model",
          label: "Model variant",
          type: CONTROL_TYPES.ENUM,
          options: ["fal-ai/flux/dev", "fal-ai/flux/schnell"],
          default: "fal-ai/flux/dev",
          help: "Flux model variant. 'schnell' is faster; 'dev' produces higher quality.",
        },
        {
          key: "outputFormat",
          label: "Output format",
          type: CONTROL_TYPES.ENUM,
          options: ["jpeg", "png"],
          default: "jpeg",
          help: "Format of the generated image. JPEG is smaller; PNG is lossless.",
        },
        {
          key: "enableSafetyChecker",
          label: "Safety checker",
          type: CONTROL_TYPES.BOOLEAN,
          default: true,
          help: "Enable fal.ai content-safety filtering on the generated image.",
        },
        {
          key: "acceleration",
          label: "Acceleration",
          type: CONTROL_TYPES.ENUM,
          options: ["none", "regular", "high"],
          default: "none",
          help: "Inference speed mode. Higher acceleration may reduce quality.",
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // submit
  // ---------------------------------------------------------------------------

  /**
   * POST the generation job to fal's queue API.
   *
   * @param {import('../types.js').GenerationRequest} request
   * @returns {Promise<{ jobId: string, status: 'pending' }>}
   * @throws {GenerationError} MISSING_KEY if no API key was provided.
   * @throws {GenerationError} on HTTP errors from fal.
   */
  async submit(request) {
    if (!this._apiKey) {
      throw new GenerationError(
        "fal.ai API key is required. Pass apiKey in adapter config.",
        { provider: "flux-fal", code: "MISSING_KEY" }
      );
    }

    const body = _buildFalInput(request);
    const url = `${FAL_QUEUE_BASE}/${this._model}`;

    let response;
    try {
      response = await this._fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Key ${this._apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      throw new GenerationError("Network error contacting fal.ai", {
        provider: "flux-fal",
        code: "PROVIDER_ERROR",
        raw: networkErr?.message ?? String(networkErr),
      });
    }

    if (!response.ok) {
      await _throwForStatus(response, "submit");
    }

    const data = await response.json();

    // data: { request_id, response_url, status_url, cancel_url, queue_position }
    return { jobId: data.request_id, status: "pending" };
  }

  // ---------------------------------------------------------------------------
  // poll
  // ---------------------------------------------------------------------------

  /**
   * Poll the fal queue status for a job. When COMPLETED, fetches and returns
   * the result.
   *
   * @param {string} jobId  - The request_id returned by submit().
   * @returns {Promise<import('../types.js').GenerationResult>}
   */
  async poll(jobId) {
    const statusUrl = `${FAL_QUEUE_BASE}/${this._model}/requests/${jobId}/status`;

    let statusRes;
    try {
      statusRes = await this._fetch(statusUrl, {
        headers: { Authorization: `Key ${this._apiKey}` },
      });
    } catch (networkErr) {
      throw new GenerationError("Network error polling fal.ai", {
        provider: "flux-fal",
        code: "PROVIDER_ERROR",
        raw: networkErr?.message ?? String(networkErr),
      });
    }

    if (!statusRes.ok) {
      await _throwForStatus(statusRes, "poll");
    }

    const statusData = await statusRes.json();

    // Map fal status enum to normalized status
    if (statusData.status === "IN_QUEUE" || statusData.status === "IN_PROGRESS") {
      return {
        jobId,
        status: "running",
        assetUrl: null,
        provider: "flux-fal",
        model: this._model,
        cost: { credits: 0, currency: "FAL_ESTIMATE" },
        raw: statusData,
        error: null,
      };
    }

    if (statusData.status === "COMPLETED") {
      return await this._fetchResult(jobId);
    }

    // Unexpected status or error field present — treat as failure
    const err = new GenerationError(
      `fal.ai job failed: ${statusData.error ?? statusData.status ?? "unknown error"}`,
      {
        provider: "flux-fal",
        code: statusData.error_type ?? "PROVIDER_ERROR",
        raw: statusData,
      }
    );
    return {
      jobId,
      status: "failed",
      assetUrl: null,
      provider: "flux-fal",
      model: this._model,
      cost: { credits: 0, currency: "FAL_ESTIMATE" },
      raw: statusData,
      error: err,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch the completed result from fal.ai.
   * Uses the deterministic result URL: https://queue.fal.run/{model}/requests/{jobId}
   *
   * @param {string} jobId
   * @returns {Promise<import('../types.js').GenerationResult>}
   */
  async _fetchResult(jobId) {
    const resultUrl = `${FAL_QUEUE_BASE}/${this._model}/requests/${jobId}`;

    let resultRes;
    try {
      resultRes = await this._fetch(resultUrl, {
        headers: { Authorization: `Key ${this._apiKey}` },
      });
    } catch (networkErr) {
      throw new GenerationError("Network error fetching fal.ai result", {
        provider: "flux-fal",
        code: "PROVIDER_ERROR",
        raw: networkErr?.message ?? String(networkErr),
      });
    }

    if (!resultRes.ok) {
      await _throwForStatus(resultRes, "fetch result");
    }

    // Result JSON: { images: [{ url, width, height, content_type }], prompt, seed, ... }
    const data = await resultRes.json();

    const assetUrl = data.images?.[0]?.url ?? null;

    // A COMPLETED job with no image is a failure, not a success: there's
    // nothing to render and nothing to charge for. Surface it as a normalized
    // failed result (not a misleading 'succeeded' with assetUrl:null/cost:0).
    if (!assetUrl) {
      return {
        jobId,
        status: "failed",
        assetUrl: null,
        provider: "flux-fal",
        model: this._model,
        cost: { credits: 0, currency: "FAL_ESTIMATE" },
        raw: data,
        error: new GenerationError("fal.ai returned no image", {
          provider: "flux-fal",
          code: "NO_IMAGE",
          raw: data,
        }),
      };
    }

    const numImages = data.images.length;

    return {
      jobId,
      status: "succeeded",
      assetUrl,
      provider: "flux-fal",
      model: this._model,
      // ESTIMATED cost — fal does not return billing data in the API response.
      // Actual charges appear in the fal.ai dashboard.
      cost: {
        credits: numImages * this._creditsPerImage,
        currency: "FAL_ESTIMATE",
      },
      raw: data,
      error: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Map a normalized GenerationRequest to the fal.ai Flux input body.
 *
 * Settings mapping:
 *   request.settings.imageSize | aspectRatio → image_size (enum or {width,height})
 *   request.settings.steps                   → num_inference_steps
 *   request.settings.seed | request.seed     → seed
 *   request.settings.guidance                → guidance_scale
 *   request.settings.numImages               → num_images
 *
 * @param {import('../types.js').GenerationRequest} request
 * @returns {Object} fal input body
 */
function _buildFalInput(request) {
  const s = request.settings ?? {};

  const body = {
    prompt: request.prompt ?? "",
  };

  // image_size: prefer explicit imageSize, fall back to aspectRatio mapping
  const imageSize = s.imageSize ?? _aspectRatioToImageSize(s.aspectRatio);
  if (imageSize !== undefined) {
    body.image_size = imageSize;
  } else {
    body.image_size = "landscape_4_3"; // fal default
  }

  // num_inference_steps
  if (s.steps !== undefined) {
    body.num_inference_steps = s.steps;
  }

  // seed — prefer settings.seed, then top-level request.seed
  const seed = s.seed ?? request.seed;
  if (seed !== undefined) {
    body.seed = seed;
  }

  // guidance_scale
  if (s.guidance !== undefined) {
    body.guidance_scale = s.guidance;
  }

  // num_images
  if (s.numImages !== undefined) {
    body.num_images = s.numImages;
  }

  // enable_safety_checker — default true (fal default)
  if (s.enableSafetyChecker !== undefined) {
    body.enable_safety_checker = s.enableSafetyChecker;
  }

  // output_format — default jpeg (fal default)
  if (s.outputFormat !== undefined) {
    body.output_format = s.outputFormat;
  }

  // acceleration — fal speed mode (none|regular|high), default none
  if (s.acceleration !== undefined) {
    body.acceleration = s.acceleration;
  }

  // NOTE: settings.model is intentionally NOT a body param. The model variant
  // (flux dev|schnell) selects the fal ENDPOINT (the URL path), so it is wired
  // at adapter construction via config.model — the generate route (#24) maps
  // settings.model -> createAdapter('flux-fal', { model }) per request. Within
  // a synchronous generate() the same instance's this._model is used for both
  // submit and poll, so the URLs stay consistent.

  return body;
}

/**
 * Map the normalized aspectRatio string (e.g. "16:9") to a fal image_size enum.
 * Returns undefined if ratio is unknown so callers can supply their own default.
 *
 * @param {string|undefined} aspectRatio
 * @returns {string|undefined}
 */
function _aspectRatioToImageSize(aspectRatio) {
  if (!aspectRatio) return undefined;
  const map = {
    "1:1": "square_hd",
    "4:3": "landscape_4_3",
    "3:4": "portrait_4_3",
    "16:9": "landscape_16_9",
    "9:16": "portrait_16_9",
  };
  return map[aspectRatio]; // undefined if not found
}

/**
 * Throw a normalized GenerationError from a non-ok HTTP response.
 * Never includes the raw Authorization header or API key.
 *
 * @param {Response} response
 * @param {string}   context  - Short label for where this was called (for the message).
 */
async function _throwForStatus(response, context) {
  let raw = null;
  try {
    raw = await response.json();
  } catch {
    // ignore parse failures; raw stays null
  }

  const { status } = response;
  let code;
  let message;

  if (status === 401 || status === 403) {
    code = "AUTH";
    message = `fal.ai authentication failed during ${context} (HTTP ${status}).`;
  } else if (status === 422) {
    code = "INVALID_INPUT";
    message = `fal.ai rejected the request as invalid during ${context} (HTTP ${status}).`;
  } else if (status === 429) {
    code = "RATE_LIMIT";
    message = `fal.ai rate limit exceeded during ${context} (HTTP ${status}).`;
  } else {
    code = "PROVIDER_ERROR";
    message = `fal.ai returned an unexpected error during ${context} (HTTP ${status}).`;
  }

  throw new GenerationError(message, { provider: "flux-fal", code, raw });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// Register 'flux-fal' in the global registry so callers can use
//   createAdapter('flux-fal', { apiKey: '...' })
// or set GENERATION_PROVIDER=flux-fal.
// The default provider remains 'mock' — this does not change the default.
registerAdapter("flux-fal", (config) => new FluxFalAdapter(config));
