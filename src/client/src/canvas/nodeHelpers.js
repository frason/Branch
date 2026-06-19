/**
 * nodeHelpers.js
 *
 * Pure functions for computing node geometry and layout data.
 * These are intentionally free of Babylon.js imports so they can be
 * unit-tested headlessly (no WebGL context required).
 *
 * When adding many nodes + edges later, all spatial math (position,
 * size, z-ordering) should live here and be tested here before any
 * mesh creation touches them.
 */

/**
 * Default dimensions for a node card in world-space units.
 * 1 world unit = 1 pixel at the default orthographic zoom level.
 */
export const NODE_DEFAULTS = {
  width: 200,
  height: 200,
  depth: 1, // near-flat slab — gives a shadow/outline option later
};

/**
 * Compute the world-space position and size for a node given its
 * logical data. Centralises the mapping so layout algorithms (e.g.
 * force-directed, tree) only need to update `x` / `y` on the data
 * object, not scatter Babylon Vector3 construction everywhere.
 *
 * @param {{ id: string, x?: number, y?: number, width?: number, height?: number }} nodeData
 * @returns {{ x: number, y: number, z: number, width: number, height: number, depth: number }}
 */
export function computeNodeTransform(nodeData) {
  return {
    x: nodeData.x ?? 0,
    y: nodeData.y ?? 0,
    z: 0,
    width: nodeData.width ?? NODE_DEFAULTS.width,
    height: nodeData.height ?? NODE_DEFAULTS.height,
    depth: NODE_DEFAULTS.depth,
  };
}

/**
 * Compute a deterministic tree layout from an array of backend node rows.
 *
 * Orientation: roots are at the TOP (y = 0); children grow DOWNWARD (negative
 * y). Siblings spread horizontally so they don't overlap. The layout is purely
 * based on parent_id relationships — no dependency on insertion order beyond
 * tie-breaking.
 *
 * Algorithm:
 *   1. Build parent→children adjacency from parent_id.
 *   2. BFS from all roots (parent_id === null) to assign depth (y position).
 *   3. Post-order traversal assigns x positions so that leaves are evenly
 *      spaced and parents are centered over their children.
 *   4. A single node (no children, no parent) lands at origin (0, 0).
 *
 * Spacing: HORIZONTAL_GAP between sibling centres; VERTICAL_GAP between depth
 * levels. At default sizes, ~5-10 nodes are visible in the 800×800 viewport
 * before pan/zoom (issue to be added later) is needed.
 *
 * @param {Array<{ id: string, parent_id?: string|null }>} nodes
 * @returns {Map<string, { x: number, y: number }>}  keyed by node id
 */
export function computeTreeLayout(nodes) {
  if (!nodes || nodes.length === 0) return new Map();

  // Spacing constants — enough room between 200×200 cards
  const HORIZONTAL_GAP = NODE_DEFAULTS.width + 60;  // 260 world units between centers
  const VERTICAL_GAP   = NODE_DEFAULTS.height + 80; // 280 world units between depths

  // Single-node fast path — center at origin
  if (nodes.length === 1) {
    return new Map([[nodes[0].id, { x: 0, y: 0 }]]);
  }

  // Build adjacency: id → [child ids]
  /** @type {Map<string|null, string[]>} */
  const children = new Map();
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    // Treat parent_id as null when the referenced parent isn't in the set
    const pid = node.parent_id != null && nodeIds.has(node.parent_id)
      ? node.parent_id
      : null;
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid).push(node.id);
    // Ensure every node has an entry (even with no children)
    if (!children.has(node.id)) children.set(node.id, []);
  }

  const roots = children.get(null) ?? [];

  // Single cycle-safe DFS assigns BOTH depth and x in post-order. A `visited`
  // set guarantees termination even if parent_id forms a cycle (which a
  // well-formed backend never produces, but a malformed response could):
  // a back-edge to an already-visited node is simply skipped rather than
  // recursed into, so we never stack-overflow and every node still gets a
  // position. Leaves claim sequential x slots; internal nodes center over
  // their (placed) children.
  /** @type {Map<string, number>} */
  const depth = new Map();
  /** @type {Map<string, number>} */
  const xPos = new Map();
  const visited = new Set();
  let leafCounter = 0;

  function place(id, d) {
    if (visited.has(id)) return;
    visited.add(id);
    depth.set(id, d);
    // Skip any child already visited (cycle back-edge) to stay finite.
    const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
    if (kids.length === 0) {
      xPos.set(id, leafCounter * HORIZONTAL_GAP);
      leafCounter++;
    } else {
      for (const kid of kids) place(kid, d + 1);
      const kidXs = kids.map((k) => xPos.get(k));
      xPos.set(id, (Math.min(...kidXs) + Math.max(...kidXs)) / 2);
    }
  }

  for (const root of roots) place(root, 0);
  // Any node not reached from a real root is part of (or hangs off) a cycle.
  // Promote each such node to a root so it is laid out instead of silently
  // collapsing to the origin.
  for (const node of nodes) {
    if (!visited.has(node.id)) place(node.id, 0);
  }

  // Center the whole layout around x=0. xPos is now non-empty for every node,
  // so min/max are finite (no NaN offset).
  const allX = [...xPos.values()];
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const offsetX = (minX + maxX) / 2;

  const result = new Map();
  for (const [id, x] of xPos.entries()) {
    const d = depth.get(id) ?? 0;
    result.set(id, {
      x: x - offsetX,
      y: -d * VERTICAL_GAP, // roots at y=0; children go negative (downward on screen)
    });
  }

  return result;
}

/**
 * Build the orthographic camera frustum bounds needed to frame a set
 * of nodes with a given padding (in world units).
 *
 * Returns the half-extents used by Babylon's ArcRotateCamera /
 * orthographic mode properties: orthoLeft, orthoRight, orthoTop,
 * orthoBottom.
 *
 * @param {Array<{ x?: number, y?: number, width?: number, height?: number }>} nodes
 * @param {{ padding?: number }} [options]
 * @returns {{ left: number, right: number, top: number, bottom: number }}
 */
export function computeOrthoFrustum(nodes, { padding = 100 } = {}) {
  if (nodes.length === 0) {
    return { left: -400, right: 400, top: 400, bottom: -400 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const hw = (n.width ?? NODE_DEFAULTS.width) / 2;
    const hh = (n.height ?? NODE_DEFAULTS.height) / 2;
    const cx = n.x ?? 0;
    const cy = n.y ?? 0;

    minX = Math.min(minX, cx - hw);
    maxX = Math.max(maxX, cx + hw);
    minY = Math.min(minY, cy - hh);
    maxY = Math.max(maxY, cy + hh);
  }

  return {
    left: minX - padding,
    right: maxX + padding,
    top: maxY + padding,
    bottom: minY - padding,
  };
}
