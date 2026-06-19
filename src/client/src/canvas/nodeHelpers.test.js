/**
 * Headless unit tests for nodeHelpers — no WebGL / Babylon.js required.
 * Run with: npm test  (vitest run)
 */
import { describe, it, expect } from "vitest";
import {
  NODE_DEFAULTS,
  computeNodeTransform,
  computeOrthoFrustum,
  computeTreeLayout,
} from "./nodeHelpers.js";

// ---------------------------------------------------------------------------
// computeNodeTransform
// ---------------------------------------------------------------------------

describe("computeNodeTransform", () => {
  it("returns default position of (0, 0, 0) when x/y are omitted", () => {
    const t = computeNodeTransform({ id: "a" });
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    expect(t.z).toBe(0);
  });

  it("passes through explicit x/y values", () => {
    const t = computeNodeTransform({ id: "b", x: 320, y: -150 });
    expect(t.x).toBe(320);
    expect(t.y).toBe(-150);
  });

  it("uses NODE_DEFAULTS for width/height when omitted", () => {
    const t = computeNodeTransform({ id: "c" });
    expect(t.width).toBe(NODE_DEFAULTS.width);
    expect(t.height).toBe(NODE_DEFAULTS.height);
  });

  it("respects overridden width/height", () => {
    const t = computeNodeTransform({ id: "d", width: 300, height: 400 });
    expect(t.width).toBe(300);
    expect(t.height).toBe(400);
  });

  it("always sets depth to NODE_DEFAULTS.depth", () => {
    const t = computeNodeTransform({ id: "e" });
    expect(t.depth).toBe(NODE_DEFAULTS.depth);
  });
});

// ---------------------------------------------------------------------------
// computeOrthoFrustum
// ---------------------------------------------------------------------------

describe("computeOrthoFrustum", () => {
  it("returns a safe default frustum for an empty node list", () => {
    const f = computeOrthoFrustum([]);
    expect(f.left).toBeLessThan(0);
    expect(f.right).toBeGreaterThan(0);
    expect(f.top).toBeGreaterThan(0);
    expect(f.bottom).toBeLessThan(0);
  });

  it("frames a single centered node with the default padding", () => {
    const f = computeOrthoFrustum([{ x: 0, y: 0 }]);
    const hw = NODE_DEFAULTS.width / 2;
    const hh = NODE_DEFAULTS.height / 2;
    const pad = 100;

    expect(f.left).toBe(-(hw + pad));
    expect(f.right).toBe(hw + pad);
    expect(f.top).toBe(hh + pad);
    expect(f.bottom).toBe(-(hh + pad));
  });

  it("respects a custom padding value", () => {
    const f = computeOrthoFrustum([{ x: 0, y: 0 }], { padding: 50 });
    const hw = NODE_DEFAULTS.width / 2;
    expect(f.left).toBe(-(hw + 50));
    expect(f.right).toBe(hw + 50);
  });

  it("spans multiple nodes correctly", () => {
    const nodes = [
      { x: -200, y: 0 },
      { x: 200, y: 0 },
    ];
    const f = computeOrthoFrustum(nodes, { padding: 0 });
    const hw = NODE_DEFAULTS.width / 2;

    // left edge of left node = -200 - 100, right edge of right node = 200 + 100
    expect(f.left).toBe(-200 - hw);
    expect(f.right).toBe(200 + hw);
  });

  it("left < right and bottom < top always", () => {
    const f = computeOrthoFrustum([{ x: 500, y: -300 }]);
    expect(f.left).toBeLessThan(f.right);
    expect(f.bottom).toBeLessThan(f.top);
  });
});

// ---------------------------------------------------------------------------
// computeTreeLayout
// ---------------------------------------------------------------------------

describe("computeTreeLayout", () => {
  it("returns an empty Map for an empty input", () => {
    const result = computeTreeLayout([]);
    expect(result.size).toBe(0);
  });

  it("places a single node at the origin (x≈0, y≈0)", () => {
    const result = computeTreeLayout([{ id: "a", parent_id: null }]);
    expect(result.size).toBe(1);
    const pos = result.get("a");
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it("places two siblings (same null parent) at the same depth (y) with distinct x", () => {
    const nodes = [
      { id: "root", parent_id: null },
      { id: "a",    parent_id: null },
    ];
    const result = computeTreeLayout(nodes);
    const rootPos = result.get("root");
    const aPos    = result.get("a");
    expect(rootPos.y).toBeCloseTo(aPos.y); // same depth level
    expect(rootPos.x).not.toBeCloseTo(aPos.x); // distinct horizontal positions
    // Must not overlap: gap >= NODE_DEFAULTS.width
    expect(Math.abs(rootPos.x - aPos.x)).toBeGreaterThanOrEqual(NODE_DEFAULTS.width);
  });

  it("positions a child at a greater depth (lower y) than its parent", () => {
    const nodes = [
      { id: "root",  parent_id: null },
      { id: "child", parent_id: "root" },
    ];
    const result = computeTreeLayout(nodes);
    const rootPos  = result.get("root");
    const childPos = result.get("child");
    // Roots are at y=0; children have negative y (downward on canvas)
    expect(rootPos.y).toBeGreaterThan(childPos.y);
  });

  it("produces increasing depth for a root→child→grandchild chain", () => {
    const nodes = [
      { id: "root",  parent_id: null },
      { id: "child", parent_id: "root" },
      { id: "grand", parent_id: "child" },
    ];
    const result = computeTreeLayout(nodes);
    const yRoot  = result.get("root").y;
    const yChild = result.get("child").y;
    const yGrand = result.get("grand").y;
    expect(yRoot).toBeGreaterThan(yChild);
    expect(yChild).toBeGreaterThan(yGrand);
  });

  it("roots with null parent_id are at the top level (y = 0)", () => {
    const nodes = [
      { id: "r1", parent_id: null },
      { id: "r2", parent_id: null },
    ];
    const result = computeTreeLayout(nodes);
    expect(result.get("r1").y).toBeCloseTo(0);
    expect(result.get("r2").y).toBeCloseTo(0);
  });

  it("is deterministic — same input always produces same output", () => {
    const nodes = [
      { id: "root",  parent_id: null },
      { id: "childA", parent_id: "root" },
      { id: "childB", parent_id: "root" },
    ];
    const r1 = computeTreeLayout(nodes);
    const r2 = computeTreeLayout(nodes);
    for (const node of nodes) {
      expect(r1.get(node.id).x).toBe(r2.get(node.id).x);
      expect(r1.get(node.id).y).toBe(r2.get(node.id).y);
    }
  });

  it("siblings under a parent do not overlap (gap >= node width)", () => {
    const nodes = [
      { id: "root",   parent_id: null },
      { id: "childA", parent_id: "root" },
      { id: "childB", parent_id: "root" },
    ];
    const result = computeTreeLayout(nodes);
    const xA = result.get("childA").x;
    const xB = result.get("childB").x;
    expect(Math.abs(xA - xB)).toBeGreaterThanOrEqual(NODE_DEFAULTS.width);
  });

  it("centers the layout so the root of a single-root tree is at x≈0", () => {
    const nodes = [
      { id: "root",   parent_id: null },
      { id: "childA", parent_id: "root" },
      { id: "childB", parent_id: "root" },
    ];
    const result = computeTreeLayout(nodes);
    // Root should be centered between its two children
    const xRoot  = result.get("root").x;
    const xA     = result.get("childA").x;
    const xB     = result.get("childB").x;
    expect(xRoot).toBeCloseTo((xA + xB) / 2);
    // And the whole tree is roughly centered around 0
    expect((xA + xB) / 2).toBeCloseTo(0, 5);
  });

  it("ignores parent_id references that point to nodes not in the set", () => {
    // parent_id "ghost" doesn't exist in the node list — treat as a root
    const nodes = [{ id: "orphan", parent_id: "ghost" }];
    const result = computeTreeLayout(nodes);
    expect(result.size).toBe(1);
    expect(result.get("orphan").x).toBeCloseTo(0);
    expect(result.get("orphan").y).toBeCloseTo(0);
  });

  it("handles a parent_id cycle without crashing or producing NaN", () => {
    // A↔B mutually reference each other — a malformed (cyclic) input.
    // Every node must still get a finite position (no silent collapse/NaN).
    const nodes = [
      { id: "A", parent_id: "B" },
      { id: "B", parent_id: "A" },
    ];
    const result = computeTreeLayout(nodes);
    expect(result.size).toBe(2);
    for (const id of ["A", "B"]) {
      const p = result.get(id);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("lays out two disconnected root→child chains without horizontal overlap", () => {
    const nodes = [
      { id: "r1", parent_id: null },
      { id: "c1", parent_id: "r1" },
      { id: "r2", parent_id: null },
      { id: "c2", parent_id: "r2" },
    ];
    const result = computeTreeLayout(nodes);
    expect(result.size).toBe(4);
    // The two chains occupy distinct horizontal space (no collision).
    const xs = [...result.values()].map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    expect(maxX - minX).toBeGreaterThan(0);
    // Each child sits directly under its own root (same x as its root).
    expect(result.get("c1").x).toBeCloseTo(result.get("r1").x);
    expect(result.get("c2").x).toBeCloseTo(result.get("r2").x);
    expect(result.get("r1").x).not.toBeCloseTo(result.get("r2").x);
  });
});
