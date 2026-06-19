/**
 * test/generate.test.js
 *
 * Tests for POST /api/trees/:treeId/generate.
 *
 * Uses createApp() + supertest with an in-memory repo and the default mock
 * adapter.  No network calls, no database required.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";

import { createApp } from "../src/server/app.js";
import { _setRepoForTesting, MemoryRepo } from "../src/server/repo/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshEnv() {
  _setRepoForTesting(new MemoryRepo());
  const app = createApp();
  return supertest(app);
}

/**
 * Create a tree and return { request, treeId, branchId }.
 */
async function createTree(request, name = "Test Tree") {
  const res = await request.post("/api/trees").send({ name });
  assert.equal(res.status, 201);
  return {
    treeId: res.body.id,
    branchId: res.body.branches[0].id,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("POST /api/trees/:treeId/generate — happy path", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 201 with node and cost on success", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "a sunny meadow" });

    assert.equal(res.status, 201);
    assert.ok(res.body.node, "response should have a node field");
    assert.ok(res.body.cost, "response should have a cost field");
  });

  it("persisted node has status 'done' and a non-null asset_url", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "a rainy forest" });

    assert.equal(res.status, 201);
    const { node } = res.body;
    assert.equal(node.status, "done");
    assert.ok(node.asset_url, "asset_url should be set on success");
    assert.equal(node.tree_id, treeId);
    assert.equal(node.branch_id, branchId);
  });

  it("cost.credits is a number in the response", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "mountain lake" });

    assert.equal(res.status, 201);
    assert.equal(typeof res.body.cost.credits, "number");
  });

  it("node is persisted and retrievable via GET /api/nodes/:id", async () => {
    const { treeId, branchId } = await createTree(request);

    const genRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "ocean wave" });

    assert.equal(genRes.status, 201);
    const nodeId = genRes.body.node.id;

    const getRes = await request.get(`/api/nodes/${nodeId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.id, nodeId);
    assert.equal(getRes.body.status, "done");
    assert.ok(getRes.body.asset_url);
  });

  it("node appears in GET /api/trees/:id after generation", async () => {
    const { treeId, branchId } = await createTree(request);

    const genRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "desert dunes" });

    assert.equal(genRes.status, 201);

    const treeRes = await request.get(`/api/trees/${treeId}`);
    assert.equal(treeRes.status, 200);
    assert.equal(treeRes.body.nodes.length, 1);
    assert.equal(treeRes.body.nodes[0].status, "done");
  });
});

// ---------------------------------------------------------------------------
// Cost captured in settings
// ---------------------------------------------------------------------------

describe("POST /api/trees/:treeId/generate — cost persistence", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("response cost.credits is a number", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "nebula" });

    assert.equal(res.status, 201);
    assert.equal(typeof res.body.cost.credits, "number");
  });

  it("persisted node.settings carries cost_credits", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "aurora borealis" });

    assert.equal(res.status, 201);
    const { node, cost } = res.body;
    assert.equal(typeof node.settings.cost_credits, "number");
    assert.equal(node.settings.cost_credits, cost.credits);
  });

  it("caller settings are merged with cost_credits", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "volcano", settings: { style: "photorealistic" } });

    assert.equal(res.status, 201);
    const { node } = res.body;
    assert.equal(node.settings.style, "photorealistic");
    assert.equal(typeof node.settings.cost_credits, "number");
  });
});

// ---------------------------------------------------------------------------
// Parent lineage
// ---------------------------------------------------------------------------

describe("POST /api/trees/:treeId/generate — parent lineage", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("child node is persisted with parent_id pointing to a prior node", async () => {
    const { treeId, branchId } = await createTree(request);

    // Generate the parent node
    const parentRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "root image" });
    assert.equal(parentRes.status, 201);
    const parentNodeId = parentRes.body.node.id;

    // Generate the child node with parentId
    const childRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, parentId: parentNodeId, prompt: "child image" });
    assert.equal(childRes.status, 201);

    assert.equal(childRes.body.node.parent_id, parentNodeId);
  });

  it("tree contains both parent and child nodes after two generations", async () => {
    const { treeId, branchId } = await createTree(request);

    const parentRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "first" });
    assert.equal(parentRes.status, 201);
    const parentNodeId = parentRes.body.node.id;

    const childRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, parentId: parentNodeId, prompt: "second" });
    assert.equal(childRes.status, 201);

    const treeRes = await request.get(`/api/trees/${treeId}`);
    assert.equal(treeRes.status, 200);
    assert.equal(treeRes.body.nodes.length, 2);
    const child = treeRes.body.nodes.find((n) => n.parent_id === parentNodeId);
    assert.ok(child, "should find child node with parent_id set");
  });
});

// ---------------------------------------------------------------------------
// Failure path (mock '__fail__' prompt)
// ---------------------------------------------------------------------------

describe("POST /api/trees/:treeId/generate — failure path", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 502 with error and cost when generation fails", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "__fail__" });

    assert.equal(res.status, 502);
    assert.ok(res.body.error, "response should have an error field");
    assert.ok(res.body.cost, "response should have a cost field on failure");
  });

  it("no node is persisted when generation fails", async () => {
    const { treeId, branchId } = await createTree(request);

    const failRes = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "__fail__" });
    assert.equal(failRes.status, 502);

    // Tree node count should still be zero
    const treeRes = await request.get(`/api/trees/${treeId}`);
    assert.equal(treeRes.status, 200);
    assert.equal(treeRes.body.nodes.length, 0);
  });

  it("cost.credits is 0 for a failed generation", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, prompt: "__fail__" });

    assert.equal(res.status, 502);
    assert.equal(res.body.cost.credits, 0);
  });
});

// ---------------------------------------------------------------------------
// Validation (happens before adapter is called)
// ---------------------------------------------------------------------------

describe("POST /api/trees/:treeId/generate — validation", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 404 for an unknown treeId", async () => {
    const res = await request
      .post("/api/trees/9999/generate")
      .send({ branchId: "1", prompt: "test" });

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  it("returns 400 when branchId is missing", async () => {
    const { treeId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ prompt: "no branch" });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it("returns 400 when branchId does not belong to the tree", async () => {
    const { treeId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId: "9999", prompt: "bad branch" });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it("returns 400 when parentId does not exist on the tree", async () => {
    const { treeId, branchId } = await createTree(request);

    const res = await request
      .post(`/api/trees/${treeId}/generate`)
      .send({ branchId, parentId: "9999", prompt: "orphan" });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it("validation failure takes precedence — 404 for bad tree even with __fail__ prompt", async () => {
    const res = await request
      .post("/api/trees/9999/generate")
      .send({ branchId: "1", prompt: "__fail__" });

    // Should be 404 (tree not found), not 502 (adapter failure)
    assert.equal(res.status, 404);
  });
});
