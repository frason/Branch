/**
 * test/byok.test.js
 *
 * Tests for the BYOK (Bring Your Own Key) key-plumbing on
 * POST /api/trees/:treeId/generate.
 *
 * Covers:
 *   - x-provider-key header flows to createAdapter config.apiKey
 *   - Authorization: Bearer <key> fallback
 *   - Key is absent from the response body and persisted node
 *   - Missing key for a key-requiring provider → 400 { error: 'API key required' }
 *   - No node is persisted on a MISSING_KEY error
 *   - Mock provider (default) still works with NO key header
 *   - Unknown settings keys are dropped by validateSettings before generate()
 *
 * Zero network calls. No real API key used.
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";

import { createApp } from "../src/server/app.js";
import { _setRepoForTesting, MemoryRepo } from "../src/server/repo/index.js";
import {
  registerAdapter,
  GenerationAdapter,
  GenerationError,
} from "../src/server/generation/index.js";

// ---------------------------------------------------------------------------
// In-test adapter: captures apiKey so tests can assert on what arrived
// ---------------------------------------------------------------------------

/**
 * The last apiKey value received by the test-byok factory.
 * Reset to undefined before each test that checks key capture.
 */
let capturedApiKey = undefined;

/**
 * Minimal generation result shape the test adapter returns on success.
 * @param {string} jobId
 */
function _makeSuccessResult(jobId) {
  return {
    jobId,
    status: "succeeded",
    assetUrl: "https://test.branch.local/assets/byok-test.png",
    provider: "test-byok",
    model: "test-model-v1",
    cost: { credits: 1, currency: "TEST_CREDITS" },
    raw: {},
    error: null,
  };
}

// Register a test-byok adapter that captures the apiKey it was constructed
// with and resolves immediately — no polling, no network.
registerAdapter("test-byok", (config) => {
  capturedApiKey = config.apiKey;

  return new (class extends GenerationAdapter {
    async submit(_request) {
      return { jobId: "test-byok-job-1", status: "pending" };
    }
    async poll(jobId) {
      return _makeSuccessResult(jobId);
    }
  })();
});

// Register a test-byok-require-key adapter: mirrors flux-fal by throwing
// MISSING_KEY from submit() when no apiKey is given.
registerAdapter("test-byok-require-key", (config) => {
  return new (class extends GenerationAdapter {
    async submit(_request) {
      if (!config.apiKey) {
        throw new GenerationError(
          "test provider requires an API key",
          { provider: "test-byok-require-key", code: "MISSING_KEY" }
        );
      }
      return { jobId: "test-byok-req-1", status: "pending" };
    }
    async poll(jobId) {
      return _makeSuccessResult(jobId);
    }
  })();
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshEnv() {
  _setRepoForTesting(new MemoryRepo());
  const app = createApp();
  return supertest(app);
}

async function createTree(request, name = "BYOK Test Tree") {
  const res = await request.post("/api/trees").send({ name });
  assert.equal(res.status, 201, `createTree failed: ${JSON.stringify(res.body)}`);
  return { treeId: res.body.id, branchId: res.body.branches[0].id };
}

// Restore GENERATION_PROVIDER after tests that modify it
let savedProvider;
beforeEach(() => {
  capturedApiKey = undefined;
  savedProvider = process.env.GENERATION_PROVIDER;
});
after(() => {
  if (savedProvider !== undefined) {
    process.env.GENERATION_PROVIDER = savedProvider;
  } else {
    delete process.env.GENERATION_PROVIDER;
  }
});

// ---------------------------------------------------------------------------
// 1. Key flows from x-provider-key header to the adapter config
// ---------------------------------------------------------------------------

describe("BYOK — x-provider-key header flows to adapter", () => {
  it("adapter receives the exact key from x-provider-key", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider-key", "secret123")
      .send({ branchId, prompt: "mountain lake" });

    assert.equal(res.status, 201);
    assert.equal(capturedApiKey, "secret123", "adapter should receive apiKey === 'secret123'");
  });

  it("key does NOT appear in the response body", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider-key", "super-secret-key")
      .send({ branchId, prompt: "sunset" });

    assert.equal(res.status, 201);
    const body = JSON.stringify(res.body);
    assert.ok(
      !body.includes("super-secret-key"),
      `Response body must not contain the API key. Got: ${body}`
    );
  });

  it("key does NOT appear in the persisted node", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider-key", "leaked-key-test")
      .send({ branchId, prompt: "forest path" });

    assert.equal(res.status, 201);
    const node = res.body.node;
    const nodeStr = JSON.stringify(node);
    assert.ok(
      !nodeStr.includes("leaked-key-test"),
      `Persisted node must not contain the API key. Got: ${nodeStr}`
    );
    // Also verify it's not stored in settings
    assert.ok(
      node.settings === undefined || !JSON.stringify(node.settings).includes("leaked-key-test"),
      "Key must not appear in node.settings"
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Authorization: Bearer <key> fallback
// ---------------------------------------------------------------------------

describe("BYOK — Authorization: Bearer fallback", () => {
  it("extracts key from 'Authorization: Bearer <key>' header", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("Authorization", "Bearer bearer-key-xyz")
      .send({ branchId, prompt: "ocean wave" });

    assert.equal(res.status, 201);
    assert.equal(
      capturedApiKey,
      "bearer-key-xyz",
      "adapter should receive key extracted from Bearer token"
    );
  });

  it("x-provider-key takes precedence over Authorization: Bearer", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider-key", "primary-key")
      .set("Authorization", "Bearer fallback-key")
      .send({ branchId, prompt: "aurora" });

    assert.equal(res.status, 201);
    assert.equal(capturedApiKey, "primary-key", "x-provider-key should win over Bearer");
  });

  it("Bearer key does NOT appear in response body", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("Authorization", "Bearer bearer-secret-99")
      .send({ branchId, prompt: "desert dunes" });

    assert.equal(res.status, 201);
    assert.ok(
      !JSON.stringify(res.body).includes("bearer-secret-99"),
      "Bearer key must not appear in response"
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Mock provider works with NO key header (existing behaviour)
// ---------------------------------------------------------------------------

describe("BYOK — mock provider works with no key", () => {
  it("generate succeeds with no key header when provider is mock (default)", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    // Ensure no override — use default mock
    delete process.env.GENERATION_PROVIDER;

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "meadow" });

    assert.equal(res.status, 201);
    assert.ok(res.body.node, "should have a node");
    assert.ok(res.body.cost, "should have a cost");
  });

  it("mock adapter receives undefined apiKey when no header is set", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "volcano" });

    assert.equal(res.status, 201);
    assert.equal(capturedApiKey, undefined, "apiKey should be undefined when no header is present");
  });
});

// ---------------------------------------------------------------------------
// 4. MISSING_KEY → 400 (not 502)
// ---------------------------------------------------------------------------

describe("BYOK — MISSING_KEY maps to 400", () => {
  it("returns 400 with { error: 'API key required' } when key is absent for key-requiring provider", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok-require-key";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "glacier" }); // no key header

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "API key required");
  });

  it("no node is persisted when MISSING_KEY error occurs", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok-require-key";

    const failRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "glacier" });

    assert.equal(failRes.status, 400);

    // Tree should have zero nodes
    const treeRes = await request.get(`/api/trees/${treeId}`);
    assert.equal(treeRes.status, 200);
    assert.equal(treeRes.body.nodes.length, 0, "no node should be persisted on MISSING_KEY");
  });

  it("returns 201 when valid key is provided for key-requiring provider", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok-require-key";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider-key", "valid-key-for-required")
      .send({ branchId, prompt: "canyon" });

    assert.equal(res.status, 201);
    assert.ok(res.body.node);
  });
});

// ---------------------------------------------------------------------------
// 5. x-provider header selects provider per-request
// ---------------------------------------------------------------------------

describe("BYOK — x-provider header selects provider", () => {
  it("x-provider header overrides GENERATION_PROVIDER env var", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    // Set env to something different
    process.env.GENERATION_PROVIDER = "mock";

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider", "test-byok")
      .set("x-provider-key", "via-x-provider")
      .send({ branchId, prompt: "canyon" });

    assert.equal(res.status, 201);
    // Definitive: test-byok captures the apiKey it was built with; the mock
    // provider does not. capturedApiKey is reset to undefined in beforeEach,
    // so a captured value proves the x-provider override selected test-byok
    // (and NOT the env default of mock).
    assert.equal(capturedApiKey, "via-x-provider");
    assert.ok(res.body.node.asset_url.includes("byok-test"));
  });

  it("an unknown x-provider value is a 400 (client error), not a 500", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .set("x-provider", "no-such-provider")
      .send({ branchId, prompt: "x" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /provider/i);
  });
});

// ---------------------------------------------------------------------------
// 5b. FAL_KEY env var is a LOCAL-DEV server-side fallback when no header key
// ---------------------------------------------------------------------------

describe("BYOK — FAL_KEY env fallback (local dev)", () => {
  it("uses process.env.FAL_KEY when no key header is supplied", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";
    const savedFalKey = process.env.FAL_KEY;
    process.env.FAL_KEY = "env-fallback-key";
    try {
      const res = await request
        .post(`/api/trees/${treeId}/generate`)
        .send({ branchId, prompt: "from env key" }); // NO key header

      assert.equal(res.status, 201);
      assert.equal(capturedApiKey, "env-fallback-key", "adapter should fall back to FAL_KEY");
    } finally {
      if (savedFalKey !== undefined) process.env.FAL_KEY = savedFalKey;
      else delete process.env.FAL_KEY;
    }
  });

  it("a header key takes precedence over FAL_KEY env", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    process.env.GENERATION_PROVIDER = "test-byok";
    const savedFalKey = process.env.FAL_KEY;
    process.env.FAL_KEY = "env-fallback-key";
    try {
      const res = await request
        .post(`/api/trees/${treeId}/generate`)
        .set("x-provider-key", "header-wins")
        .send({ branchId, prompt: "header beats env" });

      assert.equal(res.status, 201);
      assert.equal(capturedApiKey, "header-wins");
    } finally {
      if (savedFalKey !== undefined) process.env.FAL_KEY = savedFalKey;
      else delete process.env.FAL_KEY;
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Settings validation — unknown keys dropped before generate
// ---------------------------------------------------------------------------

describe("BYOK — settings validation before generate", () => {
  it("unknown settings keys are dropped and generate still succeeds", async () => {
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    delete process.env.GENERATION_PROVIDER; // use mock

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({
        branchId,
        prompt: "test clean settings",
        settings: {
          aspectRatio: "1:1",        // valid mock capability
          unknownGarbage: "dropped", // should be dropped by validateSettings
          anotherBadKey: 999,        // should also be dropped
        },
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.node, "generate should succeed even with unknown settings");
  });

  it("caller settings (including unknowns) are preserved in persisted node for the record", async () => {
    // The route merges RAW (pre-validated) caller settings into the persisted
    // node settings — this preserves intent. Only the GENERATE CALL gets the
    // cleaned settings. This mirrors how the original route worked.
    const request = freshEnv();
    const { treeId, branchId } = await createTree(request);

    delete process.env.GENERATION_PROVIDER;

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({
        branchId,
        prompt: "preserve caller settings",
        settings: { style: "photorealistic" },
      });

    assert.equal(res.status, 201);
    // The original unknown key "style" should still be in the persisted node
    // (cost_credits is merged in, caller settings are preserved)
    assert.equal(res.body.node.settings.style, "photorealistic");
    assert.equal(typeof res.body.node.settings.cost_credits, "number");
  });
});
