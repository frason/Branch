/**
 * Headless unit tests for nodeHelpers — no WebGL / Babylon.js required.
 * Run with: npm test  (vitest run)
 */
import { describe, it, expect } from "vitest";
import {
  NODE_DEFAULTS,
  computeNodeTransform,
  computeOrthoFrustum,
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
