/**
 * test/flux-fal.test.js
 *
 * Tests for the FluxFalAdapter (fal.ai Flux generation adapter).
 *
 * ALL HTTP calls go through an injected stub fetch — zero live network, zero
 * real API key required.  The apiKey used in tests is a fake sentinel string.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FluxFalAdapter } from "../src/server/generation/adapters/flux-fal.js";
import { GenerationError, createAdapter, registeredAdapters } from "../src/server/generation/index.js";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

const FAKE_KEY = "fal-test-key-never-real";
const FAKE_REQUEST_ID = "req-abc-123";
const FAKE_IMAGE_URL = "https://fal.ai/output/test-image.jpg";

/**
 * Build a minimal stub fetch that returns canned responses per URL.
 * `routes` is a Map<string, { status, body }> keyed on URL substring or
 * exact URL.  Falls through to a 500 if no route matches.
 *
 * The stub records every call so tests can assert on request details.
 */
function makeFetch(responses) {
  const calls = [];

  async function stubFetch(url, init = {}) {
    const call = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null };
    calls.push(call);

    const matched = responses.find((r) => url.includes(r.urlMatch));
    if (!matched) {
      return makeResponse(500, { error: "stub: no route matched", url });
    }
    // Support a sequence: if matched.responses is an array, pop from front
    if (Array.isArray(matched.responses)) {
      const next = matched.responses.shift();
      return makeResponse(next.status ?? 200, next.body ?? {});
    }
    return makeResponse(matched.status ?? 200, matched.body ?? {});
  }

  stubFetch.calls = calls;
  return stubFetch;
}

function makeResponse(status, body) {
  const json = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(json),
  };
}

/** Canned fal submit response */
function submitResponse(requestId = FAKE_REQUEST_ID) {
  return {
    request_id: requestId,
    response_url: `https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}`,
    status_url: `https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}/status`,
    cancel_url: `https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}/cancel`,
    queue_position: 0,
  };
}

/** Canned fal status responses */
function inQueueStatus() {
  return { status: "IN_QUEUE", queue_position: 1 };
}
function inProgressStatus() {
  return { status: "IN_PROGRESS", logs: [] };
}
function completedStatus() {
  return { status: "COMPLETED" };
}

/** Canned fal result response */
function resultResponse(imageUrl = FAKE_IMAGE_URL, numImages = 1) {
  return {
    images: Array.from({ length: numImages }, () => ({
      url: imageUrl,
      width: 1024,
      height: 768,
      content_type: "image/jpeg",
    })),
    prompt: "test prompt",
    seed: 42,
    timings: {},
    has_nsfw_concepts: [false],
  };
}

// ---------------------------------------------------------------------------
// 1. Registration
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — registration", () => {
  it("registers 'flux-fal' in the adapter registry", () => {
    assert.ok(
      registeredAdapters().includes("flux-fal"),
      "'flux-fal' should be listed in registeredAdapters()"
    );
  });

  it("createAdapter('flux-fal', config) returns a FluxFalAdapter", () => {
    const adapter = createAdapter("flux-fal", { apiKey: FAKE_KEY });
    assert.ok(adapter instanceof FluxFalAdapter);
  });
});

// ---------------------------------------------------------------------------
// 2. MISSING_KEY guard
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — missing API key", () => {
  it("submit() throws GenerationError with code MISSING_KEY when no apiKey given", async () => {
    const adapter = new FluxFalAdapter({ fetch: makeFetch([]) });
    await assert.rejects(
      () => adapter.submit({ prompt: "test" }),
      (err) => {
        assert.ok(err instanceof GenerationError, "should be GenerationError");
        assert.equal(err.code, "MISSING_KEY");
        assert.equal(err.provider, "flux-fal");
        return true;
      }
    );
  });

  it("MISSING_KEY message does NOT contain any API key", async () => {
    const adapter = new FluxFalAdapter({ fetch: makeFetch([]) });
    try {
      await adapter.submit({ prompt: "test" });
      assert.fail("Should have thrown");
    } catch (err) {
      // No key to leak (key is null), but confirm message is safe
      assert.ok(!err.message.includes("null"), "message should not expose null key");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. submit() — request mapping
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — submit() request mapping", () => {
  it("POSTs to the correct fal queue URL", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run/fal-ai/flux/dev", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "sunset over mountains" });

    const call = fetch.calls[0];
    assert.equal(call.method, "POST");
    assert.ok(call.url.includes("queue.fal.run/fal-ai/flux/dev"), `URL was: ${call.url}`);
    // Must NOT include the /requests/ path (that is the status endpoint)
    assert.ok(!call.url.includes("/requests/"), "submit should not POST to the status URL");
  });

  it("sends Authorization: Key <apiKey> header", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test" });

    const { headers } = fetch.calls[0];
    assert.equal(headers["Authorization"], `Key ${FAKE_KEY}`);
  });

  it("API key does NOT appear in any thrown error message", async () => {
    // Simulate a 401 from fal
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 401, body: { error: "Unauthorized" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    try {
      await adapter.submit({ prompt: "test" });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        !err.message.includes(FAKE_KEY),
        `Error message must not contain the API key. Got: "${err.message}"`
      );
    }
  });

  it("maps prompt to the fal input body", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "a golden retriever on a beach" });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.prompt, "a golden retriever on a beach");
  });

  it("maps settings.steps → num_inference_steps", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { steps: 20 } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.num_inference_steps, 20);
  });

  it("maps settings.guidance → guidance_scale", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { guidance: 7.5 } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.guidance_scale, 7.5);
  });

  it("maps settings.numImages → num_images", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { numImages: 3 } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.num_images, 3);
  });

  it("maps settings.seed → seed", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { seed: 99 } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.seed, 99);
  });

  it("maps top-level request.seed → seed when settings.seed is absent", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", seed: 55 });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.seed, 55);
  });

  it("maps settings.aspectRatio '16:9' → image_size 'landscape_16_9'", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { aspectRatio: "16:9" } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "landscape_16_9");
  });

  it("maps settings.aspectRatio '1:1' → image_size 'square_hd'", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { aspectRatio: "1:1" } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "square_hd");
  });

  it("maps settings.imageSize directly when provided", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test", settings: { imageSize: "portrait_16_9" } });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "portrait_16_9");
  });

  it("defaults image_size to landscape_4_3 when no aspect ratio given", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test" });

    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "landscape_4_3");
  });

  it("returns { jobId: request_id, status: 'pending' }", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse("req-xyz-789") },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    const result = await adapter.submit({ prompt: "test" });

    assert.equal(result.jobId, "req-xyz-789");
    assert.equal(result.status, "pending");
  });
});

// ---------------------------------------------------------------------------
// 4. poll() — status mapping
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — poll() status mapping", () => {
  function makeAdapter(responses) {
    const fetch = makeFetch(responses);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    return { adapter, fetch };
  }

  it("IN_QUEUE → status 'running'", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: inQueueStatus() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.status, "running");
  });

  it("IN_PROGRESS → status 'running'", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: inProgressStatus() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.status, "running");
  });

  it("running result has null assetUrl", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: inQueueStatus() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.assetUrl, null);
  });

  it("COMPLETED → fetches result and returns status 'succeeded'", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.status, "succeeded");
  });

  it("COMPLETED → assetUrl = images[0].url", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse(FAKE_IMAGE_URL) },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.assetUrl, FAKE_IMAGE_URL);
  });

  it("COMPLETED with an empty images array → 'failed' with code NO_IMAGE (not a misleading success)", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: { images: [], prompt: "x" } },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.status, "failed");
    assert.equal(result.assetUrl, null);
    assert.equal(result.cost.credits, 0);
    assert.ok(result.error instanceof GenerationError);
    assert.equal(result.error.code, "NO_IMAGE");
  });

  it("COMPLETED with a malformed result (no images key) → 'failed', no TypeError", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: { prompt: "x" } },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "NO_IMAGE");
  });

  it("COMPLETED → cost.credits = num_images * creditsPerImage", async () => {
    const fetch = makeFetch([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse(FAKE_IMAGE_URL, 2) },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch, creditsPerImage: 3 });

    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.cost.credits, 6); // 2 images * 3 credits each
    assert.equal(typeof result.cost.credits, "number");
  });

  it("COMPLETED → cost.currency is 'FAL_ESTIMATE'", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.cost.currency, "FAL_ESTIMATE");
  });

  it("COMPLETED → cost.credits >= 0 with default creditsPerImage", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse(FAKE_IMAGE_URL, 1) },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.ok(result.cost.credits >= 0);
    assert.equal(result.cost.credits, 1); // 1 image * 1 default creditsPerImage
  });

  it("COMPLETED → provider is 'flux-fal'", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.provider, "flux-fal");
  });

  it("COMPLETED → model matches configured model", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.model, "fal-ai/flux/dev");
  });

  it("COMPLETED → error is null on success", async () => {
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: resultResponse() },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.error, null);
  });

  it("COMPLETED → raw contains provider response", async () => {
    const raw = resultResponse();
    const { adapter } = makeAdapter([
      { urlMatch: "/status", status: 200, body: completedStatus() },
      { urlMatch: `/requests/${FAKE_REQUEST_ID}`, status: 200, body: raw },
    ]);
    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.ok(result.raw !== null);
    assert.equal(result.raw.prompt, raw.prompt);
  });
});

// ---------------------------------------------------------------------------
// 5. poll() — failure / error paths
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — poll() error handling", () => {
  it("401 on status poll → throws GenerationError code AUTH", async () => {
    const fetch = makeFetch([
      { urlMatch: "/status", status: 401, body: { error: "Unauthorized" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.poll(FAKE_REQUEST_ID),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "AUTH");
        assert.equal(err.provider, "flux-fal");
        return true;
      }
    );
  });

  it("403 on status poll → throws GenerationError code AUTH", async () => {
    const fetch = makeFetch([
      { urlMatch: "/status", status: 403, body: { error: "Forbidden" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.poll(FAKE_REQUEST_ID),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "AUTH");
        return true;
      }
    );
  });

  it("429 on status poll → throws GenerationError code RATE_LIMIT", async () => {
    const fetch = makeFetch([
      { urlMatch: "/status", status: 429, body: { error: "Too Many Requests" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.poll(FAKE_REQUEST_ID),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "RATE_LIMIT");
        return true;
      }
    );
  });

  it("500 on status poll → throws GenerationError code PROVIDER_ERROR", async () => {
    const fetch = makeFetch([
      { urlMatch: "/status", status: 500, body: { error: "Internal Server Error" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.poll(FAKE_REQUEST_ID),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "PROVIDER_ERROR");
        return true;
      }
    );
  });

  it("fal status body with error field → returns failed GenerationResult", async () => {
    const fetch = makeFetch([
      {
        urlMatch: "/status",
        status: 200,
        body: { status: "FAILED", error: "Content policy violation", error_type: "CONTENT_POLICY" },
      },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    const result = await adapter.poll(FAKE_REQUEST_ID);
    assert.equal(result.status, "failed");
    assert.ok(result.error instanceof GenerationError);
    assert.equal(result.assetUrl, null);
    assert.equal(result.provider, "flux-fal");
  });

  it("error thrown by poll() does NOT contain the API key", async () => {
    const fetch = makeFetch([
      { urlMatch: "/status", status: 401, body: { error: "Unauthorized" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    try {
      await adapter.poll(FAKE_REQUEST_ID);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        !err.message.includes(FAKE_KEY),
        `Error message must not contain the API key. Got: "${err.message}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. submit() error paths
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — submit() error handling", () => {
  it("401 on submit → throws GenerationError code AUTH", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 401, body: { error: "Unauthorized" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.submit({ prompt: "test" }),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "AUTH");
        return true;
      }
    );
  });

  it("422 on submit → throws GenerationError code INVALID_INPUT", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 422, body: { error: "Validation failed" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.submit({ prompt: "test" }),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "INVALID_INPUT");
        return true;
      }
    );
  });

  it("429 on submit → throws GenerationError code RATE_LIMIT", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 429, body: { error: "Too Many Requests" } },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await assert.rejects(
      () => adapter.submit({ prompt: "test" }),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "RATE_LIMIT");
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 7. generate() — end-to-end with stubbed fetch (submit → poll → succeeded)
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — generate() end-to-end (stubbed)", () => {
  it("resolves with status 'succeeded' after submit → poll cycle", async () => {
    // The stub routes must handle:
    //   1. POST  queue.fal.run/fal-ai/flux/dev              (submit)
    //   2. GET   .../requests/{id}/status                    (poll: COMPLETED)
    //   3. GET   .../requests/{id}                           (fetch result)
    //
    // makeFetch matches by URL substring in order, so we list most-specific first.

    const requestId = "req-gen-e2e";
    const fetch = makeFetch([
      // status check comes before result fetch because URL is more specific
      {
        urlMatch: `/requests/${requestId}/status`,
        status: 200,
        body: completedStatus(),
      },
      {
        urlMatch: `/requests/${requestId}`,
        status: 200,
        body: resultResponse(FAKE_IMAGE_URL, 1),
      },
      // submit route (matches the base model URL, no /requests/ path)
      {
        urlMatch: "queue.fal.run/fal-ai/flux/dev",
        status: 200,
        body: submitResponse(requestId),
      },
    ]);

    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    const result = await adapter.generate(
      { prompt: "A mountain at sunrise", settings: { numImages: 1 } },
      { pollIntervalMs: 1, timeoutMs: 5000 }
    );

    assert.equal(result.status, "succeeded");
    assert.equal(result.assetUrl, FAKE_IMAGE_URL);
    assert.equal(result.provider, "flux-fal");
    assert.equal(typeof result.cost.credits, "number");
    assert.ok(result.cost.credits >= 0);
    assert.equal(result.error, null);
  });

  it("generate() respects the polling loop — goes through IN_QUEUE before COMPLETED", async () => {
    const requestId = "req-gen-poll";
    const fetch = makeFetch([
      // First status call → IN_QUEUE (still running)
      // Second status call → COMPLETED
      {
        urlMatch: `/requests/${requestId}/status`,
        responses: [
          { status: 200, body: inQueueStatus() },
          { status: 200, body: completedStatus() },
        ],
      },
      {
        urlMatch: `/requests/${requestId}`,
        status: 200,
        body: resultResponse(FAKE_IMAGE_URL, 1),
      },
      {
        urlMatch: "queue.fal.run/fal-ai/flux/dev",
        status: 200,
        body: submitResponse(requestId),
      },
    ]);

    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    const result = await adapter.generate(
      { prompt: "Two polls before done" },
      { pollIntervalMs: 1, timeoutMs: 5000 }
    );

    assert.equal(result.status, "succeeded");
    // Two status calls were made (IN_QUEUE + COMPLETED)
    const statusCalls = fetch.calls.filter((c) => c.url.includes("/status"));
    assert.equal(statusCalls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// 8. Authorization header format
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — Authorization header", () => {
  it("uses 'Key <apiKey>' format (not 'Bearer')", async () => {
    const fetch = makeFetch([
      { urlMatch: "queue.fal.run", status: 200, body: submitResponse() },
    ]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });

    await adapter.submit({ prompt: "test" });

    const { headers } = fetch.calls[0];
    assert.match(headers["Authorization"], /^Key /);
    assert.ok(!headers["Authorization"].startsWith("Bearer "));
  });
});
