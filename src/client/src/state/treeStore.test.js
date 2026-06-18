/**
 * Unit tests for the treeStore reducer — pure state transitions.
 * No React, no network, no WebGL required.
 */
import { describe, it, expect } from "vitest";
import { treeReducer, INITIAL_STATE, ACTIONS } from "./treeReducer.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function reduce(state, type, payload) {
  return treeReducer(state, { type, payload });
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("treeReducer — initial state", () => {
  it("has status idle", () => {
    expect(INITIAL_STATE.status).toBe("idle");
  });

  it("has empty nodes array", () => {
    expect(INITIAL_STATE.nodes).toEqual([]);
  });

  it("has null tree and null error", () => {
    expect(INITIAL_STATE.tree).toBeNull();
    expect(INITIAL_STATE.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LOAD_START
// ---------------------------------------------------------------------------

describe("LOAD_START", () => {
  it("transitions status to loading", () => {
    const next = reduce(INITIAL_STATE, ACTIONS.LOAD_START);
    expect(next.status).toBe("loading");
  });

  it("clears any previous error", () => {
    const withError = { ...INITIAL_STATE, status: "error", error: "oops" };
    const next = reduce(withError, ACTIONS.LOAD_START);
    expect(next.error).toBeNull();
  });

  it("does not mutate the previous state", () => {
    const prev = { ...INITIAL_STATE };
    reduce(prev, ACTIONS.LOAD_START);
    expect(prev.status).toBe("idle"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// LOAD_SUCCESS
// ---------------------------------------------------------------------------

describe("LOAD_SUCCESS", () => {
  const mockTree = {
    id: "1",
    name: "My Tree",
    branches: [],
    nodes: [{ id: "n1" }, { id: "n2" }],
  };

  it("transitions status to ready", () => {
    const next = reduce(INITIAL_STATE, ACTIONS.LOAD_SUCCESS, { tree: mockTree });
    expect(next.status).toBe("ready");
  });

  it("stores the tree", () => {
    const next = reduce(INITIAL_STATE, ACTIONS.LOAD_SUCCESS, { tree: mockTree });
    expect(next.tree).toBe(mockTree);
  });

  it("populates nodes from tree.nodes", () => {
    const next = reduce(INITIAL_STATE, ACTIONS.LOAD_SUCCESS, { tree: mockTree });
    expect(next.nodes).toHaveLength(2);
    expect(next.nodes[0].id).toBe("n1");
  });

  it("handles a tree with no nodes array gracefully", () => {
    const treeNoNodes = { id: "2", name: "Empty", branches: [] };
    const next = reduce(INITIAL_STATE, ACTIONS.LOAD_SUCCESS, { tree: treeNoNodes });
    expect(next.nodes).toEqual([]);
  });

  it("clears the error field", () => {
    const withError = { ...INITIAL_STATE, error: "previous error" };
    const next = reduce(withError, ACTIONS.LOAD_SUCCESS, { tree: mockTree });
    expect(next.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LOAD_ERROR
// ---------------------------------------------------------------------------

describe("LOAD_ERROR", () => {
  it("transitions status to error", () => {
    const loading = { ...INITIAL_STATE, status: "loading" };
    const next = reduce(loading, ACTIONS.LOAD_ERROR, "Network failed");
    expect(next.status).toBe("error");
  });

  it("stores the error message", () => {
    const next = reduce(INITIAL_STATE, ACTIONS.LOAD_ERROR, "API unreachable");
    expect(next.error).toBe("API unreachable");
  });

  it("falls back to Unknown error when payload is undefined", () => {
    const next = treeReducer(INITIAL_STATE, { type: ACTIONS.LOAD_ERROR });
    expect(next.error).toBe("Unknown error");
  });

  it("preserves existing nodes (allows graceful degradation)", () => {
    const withNodes = { ...INITIAL_STATE, nodes: [{ id: "n1" }] };
    const next = reduce(withNodes, ACTIONS.LOAD_ERROR, "timeout");
    expect(next.nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ADD_NODE
// ---------------------------------------------------------------------------

describe("ADD_NODE", () => {
  it("appends the node to the nodes array", () => {
    const ready = {
      ...INITIAL_STATE,
      status: "ready",
      nodes: [{ id: "n1" }],
    };
    const next = reduce(ready, ACTIONS.ADD_NODE, { id: "n2" });
    expect(next.nodes).toHaveLength(2);
    expect(next.nodes[1].id).toBe("n2");
  });

  it("works on an empty nodes array", () => {
    const next = reduce(INITIAL_STATE, ACTIONS.ADD_NODE, { id: "n1" });
    expect(next.nodes).toHaveLength(1);
  });

  it("does not mutate the previous nodes array", () => {
    const prev = { ...INITIAL_STATE, nodes: [{ id: "n1" }] };
    reduce(prev, ACTIONS.ADD_NODE, { id: "n2" });
    expect(prev.nodes).toHaveLength(1); // original unchanged
  });
});

// ---------------------------------------------------------------------------
// RESET
// ---------------------------------------------------------------------------

describe("RESET", () => {
  it("returns initial state regardless of current state", () => {
    const modified = {
      tree: { id: "1" },
      nodes: [{ id: "n1" }],
      status: "ready",
      error: null,
    };
    const next = reduce(modified, ACTIONS.RESET);
    expect(next).toEqual(INITIAL_STATE);
  });
});

// ---------------------------------------------------------------------------
// Unknown actions
// ---------------------------------------------------------------------------

describe("unknown action", () => {
  it("returns state unchanged", () => {
    const next = treeReducer(INITIAL_STATE, { type: "TOTALLY_UNKNOWN" });
    expect(next).toBe(INITIAL_STATE); // same reference
  });
});
