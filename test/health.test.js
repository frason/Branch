import { describe, it } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { createApp } from "../src/server/app.js";

const app = createApp();
const request = supertest(app);

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request.get("/health");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });

  it("includes a numeric uptime field", async () => {
    const res = await request.get("/health");

    assert.equal(typeof res.body.uptime, "number");
  });

  it("includes a timestamp field", async () => {
    const res = await request.get("/health");

    assert.ok(res.body.timestamp, "timestamp should be present");
    // Verify it parses as a valid ISO date
    assert.ok(!isNaN(Date.parse(res.body.timestamp)), "timestamp should be a valid ISO string");
  });
});

describe("Unknown routes", () => {
  it("returns 404 for an unrecognised path", async () => {
    const res = await request.get("/this-does-not-exist");

    assert.equal(res.status, 404);
  });

  it("returns JSON error shape for an unrecognised path", async () => {
    const res = await request.get("/this-does-not-exist");

    assert.equal(res.body.error, "Not Found");
  });
});
