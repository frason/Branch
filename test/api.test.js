/**
 * test/api.test.js
 *
 * REST API tests for trees & nodes.
 *
 * Uses createApp() + supertest — no port binding, no live database.
 * Each test group creates its own repo instance via _setRepoForTesting so
 * state never leaks between tests.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";

import { createApp } from "../src/server/app.js";
import { _setRepoForTesting, MemoryRepo } from "../src/server/repo/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset the singleton to a fresh MemoryRepo and return a supertest agent
 * bound to a newly created app.
 */
function freshEnv() {
  _setRepoForTesting(new MemoryRepo());
  const app = createApp();
  return supertest(app);
}

// ---------------------------------------------------------------------------
// POST /api/trees
// ---------------------------------------------------------------------------

describe("POST /api/trees", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 201 with the created tree", async () => {
    const res = await request.post("/api/trees").send({ name: "My Tree" });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, "My Tree");
    assert.ok(res.body.id, "should have an id");
    assert.ok(res.body.created_at, "should have created_at");
  });

  it("includes a default branch in the response", async () => {
    const res = await request.post("/api/trees").send({ name: "Branchy" });
    assert.equal(res.status, 201);
    assert.ok(Array.isArray(res.body.branches), "branches should be an array");
    assert.equal(res.body.branches.length, 1);
    assert.equal(res.body.branches[0].name, "main");
  });

  it("includes an empty nodes array in the response", async () => {
    const res = await request.post("/api/trees").send({ name: "Empty" });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.nodes, []);
  });

  it("accepts optional aspectRatio and modelVersion for the default branch", async () => {
    const res = await request.post("/api/trees").send({
      name: "Configured",
      aspectRatio: "16:9",
      modelVersion: "flux-1",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.branches[0].aspect_ratio, "16:9");
    assert.equal(res.body.branches[0].model_version, "flux-1");
  });

  it("returns 400 when name is missing", async () => {
    const res = await request.post("/api/trees").send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.error, "should have an error field");
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request.post("/api/trees").send({ name: "   " });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });
});

// ---------------------------------------------------------------------------
// GET /api/trees
// ---------------------------------------------------------------------------

describe("GET /api/trees", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 200 and an empty array initially", async () => {
    const res = await request.get("/api/trees");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it("lists all created trees", async () => {
    await request.post("/api/trees").send({ name: "Alpha" });
    await request.post("/api/trees").send({ name: "Beta" });

    const res = await request.get("/api/trees");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    const names = res.body.map((t) => t.name);
    assert.ok(names.includes("Alpha"));
    assert.ok(names.includes("Beta"));
  });
});

// ---------------------------------------------------------------------------
// GET /api/trees/:id
// ---------------------------------------------------------------------------

describe("GET /api/trees/:id", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 200 with the tree including branches and nodes arrays", async () => {
    const created = await request.post("/api/trees").send({ name: "Oak" });
    const id = created.body.id;

    const res = await request.get(`/api/trees/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "Oak");
    assert.ok(Array.isArray(res.body.branches));
    assert.ok(Array.isArray(res.body.nodes));
  });

  it("returns 404 for an unknown tree id", async () => {
    const res = await request.get("/api/trees/9999");
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trees/:treeId/nodes
// ---------------------------------------------------------------------------

describe("POST /api/trees/:treeId/nodes", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 201 with the created node", async () => {
    const tree = (await request.post("/api/trees").send({ name: "T1" })).body;
    const branchId = tree.branches[0].id;

    const res = await request
      .post(`/api/trees/${tree.id}/nodes`)
      .send({ branchId, prompt: "a red cat" });

    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.equal(res.body.prompt, "a red cat");
    assert.equal(res.body.branch_id, branchId);
    assert.equal(res.body.tree_id, tree.id);
    assert.equal(res.body.status, "pending");
  });

  it("returns 404 when tree does not exist", async () => {
    const res = await request
      .post("/api/trees/9999/nodes")
      .send({ branchId: "1" });
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  it("returns 400 when branchId is missing", async () => {
    const tree = (await request.post("/api/trees").send({ name: "T2" })).body;

    const res = await request
      .post(`/api/trees/${tree.id}/nodes`)
      .send({ prompt: "no branch" });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it("returns 400 when branchId does not belong to the tree", async () => {
    const tree = (await request.post("/api/trees").send({ name: "T3" })).body;

    const res = await request
      .post(`/api/trees/${tree.id}/nodes`)
      .send({ branchId: "9999" });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it("returns 400 for an invalid status value", async () => {
    const tree = (await request.post("/api/trees").send({ name: "T4" })).body;
    const branchId = tree.branches[0].id;

    const res = await request
      .post(`/api/trees/${tree.id}/nodes`)
      .send({ branchId, status: "invalid-status" });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });
});

// ---------------------------------------------------------------------------
// GET /api/nodes/:id
// ---------------------------------------------------------------------------

describe("GET /api/nodes/:id", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("returns 200 with the node", async () => {
    const tree = (await request.post("/api/trees").send({ name: "T5" })).body;
    const branchId = tree.branches[0].id;

    const node = (
      await request
        .post(`/api/trees/${tree.id}/nodes`)
        .send({ branchId, prompt: "blue fox" })
    ).body;

    const res = await request.get(`/api/nodes/${node.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, node.id);
    assert.equal(res.body.prompt, "blue fox");
  });

  it("returns 404 for an unknown node id", async () => {
    const res = await request.get("/api/nodes/9999");
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });
});

// ---------------------------------------------------------------------------
// parent_id lineage
// ---------------------------------------------------------------------------

describe("parent_id lineage", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("child node persists with parent_id pointing to parent node", async () => {
    const tree = (await request.post("/api/trees").send({ name: "Lineage" })).body;
    const branchId = tree.branches[0].id;
    const treeId = tree.id;

    const parent = (
      await request
        .post(`/api/trees/${treeId}/nodes`)
        .send({ branchId, prompt: "root image" })
    ).body;

    const child = (
      await request
        .post(`/api/trees/${treeId}/nodes`)
        .send({ branchId, parentId: parent.id, prompt: "child image" })
    ).body;

    assert.equal(child.parent_id, parent.id);
  });

  it("getTree returns both parent and child nodes", async () => {
    const tree = (await request.post("/api/trees").send({ name: "Family" })).body;
    const branchId = tree.branches[0].id;
    const treeId = tree.id;

    const parent = (
      await request
        .post(`/api/trees/${treeId}/nodes`)
        .send({ branchId, prompt: "parent" })
    ).body;

    await request
      .post(`/api/trees/${treeId}/nodes`)
      .send({ branchId, parentId: parent.id, prompt: "child" });

    const res = await request.get(`/api/trees/${treeId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.nodes.length, 2);

    const child = res.body.nodes.find((n) => n.parent_id === parent.id);
    assert.ok(child, "should find child node with parent_id set");
    assert.equal(child.prompt, "child");
  });

  it("returns 400 when parentId does not exist on the tree", async () => {
    const tree = (await request.post("/api/trees").send({ name: "Orphan" })).body;
    const branchId = tree.branches[0].id;

    const res = await request
      .post(`/api/trees/${tree.id}/nodes`)
      .send({ branchId, parentId: "9999", prompt: "no parent" });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });
});

// ---------------------------------------------------------------------------
// Existing catch-all still works (ensure routes don't break 404 handler)
// ---------------------------------------------------------------------------

describe("catch-all 404 still works after mounting API routes", () => {
  let request;
  beforeEach(() => { request = freshEnv(); });

  it("unknown path returns 404 JSON", async () => {
    const res = await request.get("/this-does-not-exist-at-all");
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Not Found");
  });
});
