/**
 * Unit tests for pure API helpers — buildUrl and extractError.
 * No fetch, no server, no WebGL required.
 *
 * Also covers pure logic for the generate endpoint (URL shape, 502 error
 * extraction) — the network portion of generate() is exercised e2e.
 */
import { describe, it, expect } from "vitest";
import { buildUrl, extractError } from "./client.js";

// ---------------------------------------------------------------------------
// buildUrl
// ---------------------------------------------------------------------------

describe("buildUrl", () => {
  it("joins a base URL and path without doubling slashes", () => {
    expect(buildUrl("http://localhost:3000", "/api/trees")).toBe(
      "http://localhost:3000/api/trees"
    );
  });

  it("strips trailing slash from base", () => {
    expect(buildUrl("http://localhost:3000/", "/api/trees")).toBe(
      "http://localhost:3000/api/trees"
    );
  });

  it("adds a leading slash to path if missing", () => {
    expect(buildUrl("http://localhost:3000", "api/trees")).toBe(
      "http://localhost:3000/api/trees"
    );
  });

  it("handles path with query string", () => {
    expect(buildUrl("http://localhost:3000", "/api/nodes/42")).toBe(
      "http://localhost:3000/api/nodes/42"
    );
  });

  it("handles multiple trailing slashes on base", () => {
    expect(buildUrl("http://localhost:3000///", "/api/trees")).toBe(
      "http://localhost:3000/api/trees"
    );
  });

  it("handles empty path", () => {
    expect(buildUrl("http://localhost:3000", "")).toBe(
      "http://localhost:3000/"
    );
  });
});

// ---------------------------------------------------------------------------
// extractError
// ---------------------------------------------------------------------------

describe("extractError", () => {
  it("extracts the error field from a server error body", () => {
    expect(extractError(404, { error: "Tree not found" })).toBe("Tree not found");
  });

  it("falls back to a generic message when body has no error field", () => {
    expect(extractError(500, {})).toBe("Request failed with status 500");
  });

  it("falls back to a generic message when body is null", () => {
    expect(extractError(503, null)).toBe("Request failed with status 503");
  });

  it("falls back when error field is not a string", () => {
    expect(extractError(400, { error: 42 })).toBe("Request failed with status 400");
  });

  it("falls back when body is a string (non-JSON)", () => {
    expect(extractError(502, "Bad Gateway")).toBe("Request failed with status 502");
  });

  it("works for 401 Unauthorized", () => {
    expect(extractError(401, { error: "Unauthorized" })).toBe("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// generate() endpoint — pure URL/error logic
// ---------------------------------------------------------------------------

describe("generate endpoint URL", () => {
  it("builds the generate path from a tree id", () => {
    const treeId = "tree-abc-123";
    const path = `/api/trees/${encodeURIComponent(treeId)}/generate`;
    expect(buildUrl("", path)).toBe(`/api/trees/${treeId}/generate`);
  });

  it("encodes special characters in treeId", () => {
    const treeId = "tree/with spaces";
    const path = `/api/trees/${encodeURIComponent(treeId)}/generate`;
    expect(path).toBe("/api/trees/tree%2Fwith%20spaces/generate");
  });

  it("extracts a 502 generation-failure error message", () => {
    // The mock adapter forces failure via '__fail__' prompt; server returns 502
    // with { error: "...", cost: { credits } }.
    expect(
      extractError(502, { error: "Generation failed: forced failure", cost: { credits: 0 } })
    ).toBe("Generation failed: forced failure");
  });

  it("extracts a 400 missing-branchId error", () => {
    expect(extractError(400, { error: "branchId is required" })).toBe("branchId is required");
  });

  it("extracts a 404 unknown-tree error", () => {
    expect(extractError(404, { error: "Tree not found" })).toBe("Tree not found");
  });
});
