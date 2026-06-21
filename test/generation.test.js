/**
 * test/generation.test.js
 *
 * Tests for the generation adapter interface, registry, and mock adapter.
 * Zero network calls — all assertions run fully in-process.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GenerationAdapter,
  GenerationError,
  createAdapter,
  registerAdapter,
  registeredAdapters,
} from "../src/server/generation/index.js";

// ---------------------------------------------------------------------------
// 1. Base class — unimplemented methods must throw GenerationError
// ---------------------------------------------------------------------------

describe("GenerationAdapter base class", () => {
  it("submit() throws a GenerationError with code NOT_IMPLEMENTED", async () => {
    const base = new GenerationAdapter();
    await assert.rejects(
      () => base.submit({ prompt: "test" }),
      (err) => {
        assert.ok(err instanceof GenerationError, "Should be a GenerationError");
        assert.equal(err.code, "NOT_IMPLEMENTED");
        return true;
      }
    );
  });

  it("poll() throws a GenerationError with code NOT_IMPLEMENTED", async () => {
    const base = new GenerationAdapter();
    await assert.rejects(
      () => base.poll("some-job-id"),
      (err) => {
        assert.ok(err instanceof GenerationError, "Should be a GenerationError");
        assert.equal(err.code, "NOT_IMPLEMENTED");
        return true;
      }
    );
  });

  it("generate() propagates GenerationError from submit()", async () => {
    const base = new GenerationAdapter();
    await assert.rejects(
      () => base.generate({ prompt: "test" }),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "NOT_IMPLEMENTED");
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 2. GenerationError class
// ---------------------------------------------------------------------------

describe("GenerationError", () => {
  it("is an instance of Error", () => {
    const err = new GenerationError("oops");
    assert.ok(err instanceof Error);
  });

  it("has name GenerationError", () => {
    const err = new GenerationError("oops");
    assert.equal(err.name, "GenerationError");
  });

  it("stores provider and code from options", () => {
    const err = new GenerationError("auth failed", {
      provider: "flux-fal",
      code: "AUTH_FAILED",
      raw: { status: 401 },
    });
    assert.equal(err.provider, "flux-fal");
    assert.equal(err.code, "AUTH_FAILED");
    assert.deepEqual(err.raw, { status: 401 });
  });

  it("defaults provider to 'unknown' and code to 'UNKNOWN'", () => {
    const err = new GenerationError("something went wrong");
    assert.equal(err.provider, "unknown");
    assert.equal(err.code, "UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// 3. Registry
// ---------------------------------------------------------------------------

describe("Registry — createAdapter", () => {
  it("returns a mock adapter by default (no name arg, no env var)", () => {
    // Ensure GENERATION_PROVIDER is unset for this assertion
    const saved = process.env.GENERATION_PROVIDER;
    delete process.env.GENERATION_PROVIDER;

    const adapter = createAdapter();
    assert.ok(
      adapter instanceof GenerationAdapter,
      "Should be a GenerationAdapter"
    );

    if (saved !== undefined) process.env.GENERATION_PROVIDER = saved;
  });

  it("returns a mock adapter when called with name 'mock'", () => {
    const adapter = createAdapter("mock");
    assert.ok(adapter instanceof GenerationAdapter);
  });

  it("throws a clear error for an unknown provider name", () => {
    assert.throws(
      () => createAdapter("no-such-provider"),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("no-such-provider"),
          `Error message should mention the unknown name: ${err.message}`
        );
        return true;
      }
    );
  });

  it("uses GENERATION_PROVIDER env var when no name is passed", () => {
    process.env.GENERATION_PROVIDER = "mock";
    const adapter = createAdapter();
    assert.ok(adapter instanceof GenerationAdapter);
    delete process.env.GENERATION_PROVIDER;
  });

  it("registerAdapter + createAdapter round-trips with a custom factory", () => {
    class MinimalAdapter extends GenerationAdapter {}
    registerAdapter("test-minimal", () => new MinimalAdapter());

    const adapter = createAdapter("test-minimal");
    assert.ok(adapter instanceof MinimalAdapter);
    assert.ok(adapter instanceof GenerationAdapter);

    // Clean up — no public deregister API needed; just verify it's listed
    assert.ok(registeredAdapters().includes("test-minimal"));
  });
});

describe("Registry — registeredAdapters", () => {
  it("includes 'mock' by default", () => {
    assert.ok(registeredAdapters().includes("mock"));
  });

  it("includes 'flux-fal' via the public index (built-in adapters self-register)", () => {
    // Regression guard: this file imports ONLY from index.js (never the
    // adapters/ files directly), so flux-fal must be registered as a result
    // of importing the generation entry point — not just when a test imports
    // the adapter module. createAdapter('flux-fal') must resolve here.
    assert.ok(registeredAdapters().includes("flux-fal"));
    const adapter = createAdapter("flux-fal", { apiKey: "x" });
    assert.equal(adapter.constructor.name, "FluxFalAdapter");
  });
});

// ---------------------------------------------------------------------------
// 4. MockGenerationAdapter — generate() produces a normalised result
// ---------------------------------------------------------------------------

describe("MockGenerationAdapter — generate()", () => {
  // Use a very short poll interval so generate() completes in < 5ms per call.
  const FAST = { pollIntervalMs: 1, timeoutMs: 5000 };

  it("resolves with status 'succeeded'", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "A stormy sea at dusk" }, FAST);
    assert.equal(result.status, "succeeded");
  });

  it("result has a non-null assetUrl on success", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "Mountain sunrise" }, FAST);
    assert.ok(result.assetUrl !== null, "assetUrl should be non-null on success");
    assert.equal(typeof result.assetUrl, "string");
    assert.ok(result.assetUrl.length > 0);
  });

  it("result has a numeric cost.credits", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "Coastal cliffs" }, FAST);
    assert.ok(
      typeof result.cost?.credits === "number",
      "cost.credits must be a number"
    );
    assert.ok(isFinite(result.cost.credits), "cost.credits must be finite");
  });

  it("result.cost.credits is >= 0", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "Forest floor" }, FAST);
    assert.ok(result.cost.credits >= 0);
  });

  it("result includes provider field", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "Desert dunes" }, FAST);
    assert.equal(typeof result.provider, "string");
    assert.ok(result.provider.length > 0);
  });

  it("result includes model field", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "Snow leopard" }, FAST);
    assert.equal(typeof result.model, "string");
    assert.ok(result.model.length > 0);
  });

  it("result.error is null on success", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "City skyline" }, FAST);
    assert.equal(result.error, null);
  });

  it("result.jobId is a string", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "Autumn leaves" }, FAST);
    assert.equal(typeof result.jobId, "string");
    assert.ok(result.jobId.length > 0);
  });
});

// ---------------------------------------------------------------------------
// 5. MockGenerationAdapter — forced failure path
// ---------------------------------------------------------------------------

describe("MockGenerationAdapter — forced failure path", () => {
  const FAST = { pollIntervalMs: 1, timeoutMs: 5000 };

  it("resolves with status 'failed' when prompt is '__fail__'", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "__fail__" }, FAST);
    assert.equal(result.status, "failed");
  });

  it("failed result has null assetUrl", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "__fail__" }, FAST);
    assert.equal(result.assetUrl, null);
  });

  it("failed result has a non-null error field", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "__fail__" }, FAST);
    assert.ok(result.error !== null, "error should be non-null on failure");
  });

  it("failed result error is a GenerationError", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "__fail__" }, FAST);
    assert.ok(
      result.error instanceof GenerationError,
      "error should be a GenerationError"
    );
  });

  it("failed result cost.credits is 0", async () => {
    const adapter = createAdapter("mock");
    const result = await adapter.generate({ prompt: "__fail__" }, FAST);
    assert.equal(result.cost.credits, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. MockGenerationAdapter — submit + poll independently
// ---------------------------------------------------------------------------

describe("MockGenerationAdapter — submit + poll", () => {
  it("submit returns a jobId and initial status 'pending'", async () => {
    const adapter = createAdapter("mock");
    const { jobId, status } = await adapter.submit({ prompt: "Volcano" });
    assert.equal(typeof jobId, "string");
    assert.ok(jobId.length > 0);
    assert.equal(status, "pending");
  });

  it("polling transitions through running to succeeded", async () => {
    const adapter = createAdapter("mock");
    const { jobId } = await adapter.submit({ prompt: "Galaxy" });

    const poll1 = await adapter.poll(jobId);
    assert.equal(poll1.status, "running");

    const poll2 = await adapter.poll(jobId);
    assert.equal(poll2.status, "succeeded");
  });

  it("poll throws GenerationError for an unknown jobId", async () => {
    const adapter = createAdapter("mock");
    await assert.rejects(
      () => adapter.poll("does-not-exist"),
      (err) => {
        assert.ok(err instanceof GenerationError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 7. generate() timeout — a job that never reaches a terminal state must
//    reject with a GenerationError code TIMEOUT (the queue relies on this).
// ---------------------------------------------------------------------------

describe("GenerationAdapter.generate() timeout", () => {
  it("rejects with code TIMEOUT when polling never reaches a terminal state", async () => {
    // An adapter whose poll() is forever 'running' — exercises the deadline path.
    class StuckAdapter extends GenerationAdapter {
      async submit() {
        return { jobId: "stuck-1", status: "pending" };
      }
      async poll(jobId) {
        return {
          jobId,
          status: "running",
          assetUrl: null,
          provider: "stuck",
          model: "stuck-v1",
          cost: { credits: 0 },
          raw: {},
          error: null,
        };
      }
    }

    const adapter = new StuckAdapter();
    await assert.rejects(
      () => adapter.generate({ prompt: "x" }, { pollIntervalMs: 1, timeoutMs: 10 }),
      (err) => {
        assert.ok(err instanceof GenerationError, "Should be a GenerationError");
        assert.equal(err.code, "TIMEOUT");
        return true;
      }
    );
  });
});
