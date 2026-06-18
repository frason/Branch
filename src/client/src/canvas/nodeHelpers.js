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
