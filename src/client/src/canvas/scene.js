/**
 * scene.js
 *
 * Babylon.js scene bootstrap — engine creation, camera setup, render loop,
 * and the node mesh factory.
 *
 * This module is intentionally a plain JS module with NO React imports.
 * The React component (BabylonCanvas.jsx) owns the <canvas> DOM node and
 * calls into here; all Babylon state lives here so it can be disposed
 * cleanly without React needing to know about it.
 *
 * Scaling path:
 *   - `addNodeMesh` will be called once per node; keep it cheap.
 *   - For 100+ nodes use an InstancedMesh (clone the root mesh).
 *   - Edges can be added as Line systems in a dedicated `edgeLayer.js`.
 *   - Pan/zoom maps to camera.orthoLeft/Right/Top/Bottom updates.
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Texture,
} from "@babylonjs/core";
// Color3 is used for node materials; Color4 used for scene clear and line colors.

import { computeNodeTransform, computeTreeLayout, NODE_DEFAULTS } from "./nodeHelpers.js";

// ---------------------------------------------------------------------------
// Placeholder (fallback) node shown when the API is unreachable
// ---------------------------------------------------------------------------
const FALLBACK_NODE = { id: "node-0", x: 0, y: 0 };

/**
 * Bootstrap a Babylon engine + scene on the given canvas element.
 *
 * Returns:
 *   - dispose()   — call on React component unmount
 *   - setNodes(nodesArray) — replace ALL rendered nodes from backend data.
 *     Pass an empty array (or omit call) to keep the fallback placeholder.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ dispose: () => void, setNodes: (nodes: object[]) => void }}
 */
export function initScene(canvas) {
  // ------------------------------------------------------------------
  // Engine
  // ------------------------------------------------------------------
  const engine = new Engine(canvas, /* antialias */ true, {
    preserveDrawingBuffer: true,
    stencil: true,
    // powerPreference tells the browser to favour the discrete GPU when
    // available — important for a canvas that will render many nodes.
    powerPreference: "high-performance",
  });

  // ------------------------------------------------------------------
  // Scene
  // ------------------------------------------------------------------
  const scene = new Scene(engine);
  // Dark background matching the app's #0d0d0d body colour
  scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);

  // ------------------------------------------------------------------
  // Orthographic camera
  //
  // ArcRotateCamera is used in orthographic mode.  This is a common
  // pattern for 2-D canvas apps: the camera faces the XY plane head-on,
  // and we manipulate orthoLeft/Right/Top/Bottom for pan/zoom later.
  //
  // alpha = -PI/2, beta = PI/2 → camera sits on the -Z axis looking toward
  // +Z, so it sees the full width×height (XY) face of each node card.
  // (beta = 0 would put the camera on +Y looking straight down, rendering
  // the card edge-on as a sliver.)
  // ------------------------------------------------------------------
  const camera = new ArcRotateCamera(
    "ortho-cam",
    -Math.PI / 2,
    Math.PI / 2,
    10, // pulled back so the node sits comfortably inside the near/far planes
    Vector3.Zero(),
    scene
  );

  // In orthographic mode the projection is governed by orthoLeft/Right/Top/
  // Bottom, but the near/far clip planes still apply along the view axis. Use
  // generous bounds so node cards (and future depth/layering) never clip.
  camera.minZ = 0.01;
  camera.maxZ = 1000;

  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;

  // Keep ortho bounds matched to the canvas CSS size so 1 world unit = 1 CSS
  // pixel. Without this, resizing the window stretches/shrinks the projection
  // while node geometry stays fixed in world space — content appears to scale.
  function updateOrthoBounds() {
    const w = canvas.clientWidth  || canvas.width  || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    camera.orthoLeft   = -w / 2;
    camera.orthoRight  =  w / 2;
    camera.orthoTop    =  h / 2;
    camera.orthoBottom = -h / 2;
  }
  updateOrthoBounds();

  // Do NOT attach user controls — pan/zoom will be wired explicitly later.

  // ------------------------------------------------------------------
  // Light — a simple ambient so the placeholder colour reads cleanly
  // ------------------------------------------------------------------
  const light = new HemisphericLight("hemi-light", new Vector3(0, 1, 0), scene);
  light.intensity = 1.0;

  // ------------------------------------------------------------------
  // Node mesh tracking — keep refs so setNodes can clean up.
  // Edge meshes are tracked separately so they can be disposed cleanly
  // without touching node geometry.
  //
  // SCALING NOTE: When node count grows to 100+, convert to instancing:
  //   const rootMesh = addNodeMesh(scene, firstNode);
  //   const instance = rootMesh.createInstance(node.id);
  //   instance.position.set(x, y, 0);
  // That shares one geometry buffer on the GPU instead of N buffers.
  // ------------------------------------------------------------------

  /** @type {Map<string, import("@babylonjs/core").Mesh>} */
  const meshMap = new Map();

  /** @type {import("@babylonjs/core").Mesh[]} */
  let edgeMeshes = [];

  /**
   * Remove all current node meshes from the scene.
   */
  function clearNodeMeshes() {
    for (const mesh of meshMap.values()) {
      mesh.material?.dispose(true, true); // dispose textures too
      mesh.dispose();
    }
    meshMap.clear();
  }

  /**
   * Remove all current edge line meshes from the scene.
   * CreateLines does not create a material, so just dispose the mesh.
   */
  function clearEdgeMeshes() {
    for (const mesh of edgeMeshes) {
      mesh.dispose();
    }
    edgeMeshes = [];
  }

  // ------------------------------------------------------------------
  // Render the fallback placeholder until setNodes is called
  // ------------------------------------------------------------------
  const fallbackMesh = addNodeMesh(scene, FALLBACK_NODE);
  meshMap.set(FALLBACK_NODE.id, fallbackMesh);

  // ------------------------------------------------------------------
  // setNodes — replaces rendered nodes from backend data.
  // If nodes is empty or not provided, re-renders the fallback.
  // ------------------------------------------------------------------

  /**
   * @param {object[]} nodes  array of backend node rows
   */
  function setNodes(nodes) {
    clearNodeMeshes();
    clearEdgeMeshes();

    if (!nodes || nodes.length === 0) {
      // Fall back to the placeholder node
      const mesh = addNodeMesh(scene, FALLBACK_NODE);
      meshMap.set(FALLBACK_NODE.id, mesh);
      return;
    }

    // Compute tree layout — pure function, no Babylon dependency.
    // Each entry in layoutMap is { x, y } in world space.
    const layoutMap = computeTreeLayout(nodes);

    // Render node cards
    for (const node of nodes) {
      const pos = layoutMap.get(node.id) ?? { x: 0, y: 0 };
      const layoutData = { id: node.id, x: pos.x, y: pos.y, asset_url: node.asset_url, status: node.status };
      const mesh = addNodeMesh(scene, layoutData);
      meshMap.set(node.id, mesh);
    }

    // Render edges: one line per child→parent pair.
    // Only nodes with a parent_id that exists in the current set get an edge.
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    for (const node of nodes) {
      if (!node.parent_id || !nodeIdSet.has(node.parent_id)) continue;

      const childPos  = layoutMap.get(node.id);
      const parentPos = layoutMap.get(node.parent_id);
      if (!childPos || !parentPos) continue;

      const edgeMesh = addEdgeMesh(scene, childPos, parentPos, node.id);
      edgeMeshes.push(edgeMesh);
    }
  }

  // ------------------------------------------------------------------
  // Render loop
  // ------------------------------------------------------------------
  engine.runRenderLoop(() => {
    scene.render();
  });

  // ------------------------------------------------------------------
  // Resize handling — kept here so the component just passes the canvas
  // ------------------------------------------------------------------
  const handleResize = () => { engine.resize(); updateOrthoBounds(); };
  window.addEventListener("resize", handleResize);

  // ------------------------------------------------------------------
  // Teardown
  // ------------------------------------------------------------------
  return {
    setNodes,
    dispose() {
      window.removeEventListener("resize", handleResize);
      engine.stopRenderLoop();
      clearNodeMeshes();
      clearEdgeMeshes();
      scene.dispose();
      engine.dispose();
    },
  };
}

/**
 * Create and add a node card mesh to the scene.
 *
 * A node is rendered as a thin box (plane-like slab) so it has a
 * physical presence in the scene.  Using MeshBuilder.CreateBox rather
 * than CreatePlane makes it straightforward to add drop-shadow planes
 * or bevel effects later without changing the geometry type.
 *
 * For future scaling: when node count grows, convert the first node into
 * a root mesh and use `rootMesh.createInstance(id)` for all subsequent
 * nodes to share the same geometry buffer on the GPU.
 *
 * @param {Scene} scene
 * @param {{ id: string, x?: number, y?: number, width?: number, height?: number }} nodeData
 * @returns {import("@babylonjs/core").Mesh}
 */
export function addNodeMesh(scene, nodeData) {
  const t = computeNodeTransform(nodeData);

  // Thin slab — depth=1 is imperceptible in ortho view but avoids the
  // z-fighting artefacts that a zero-depth plane can produce.
  const mesh = MeshBuilder.CreateBox(
    nodeData.id,
    { width: t.width, height: t.height, depth: t.depth },
    scene
  );

  mesh.position.set(t.x, t.y, t.z);

  // Material — rendered UNLIT (emissive fill/texture + disableLighting) so
  // node cards read consistently regardless of light angle: a 2D card's
  // camera-facing normal is perpendicular to any overhead light, which would
  // otherwise leave it nearly black.
  const mat = new StandardMaterial(`mat-${nodeData.id}`, scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black(); // flat, no specular highlights
  mat.disableLighting = true; // unlit — color/texture comes purely from emissive

  if (nodeData.asset_url && nodeData.status === "done") {
    // Generated image available — load it as an unlit emissive texture.
    // fal.ai CDN supplies permissive CORS headers so no special handling needed.
    // If the texture fails (e.g. mock URL 404s), fall back to the purple placeholder.
    const tex = new Texture(nodeData.asset_url, scene, undefined, undefined, undefined, null,
      () => { mat.emissiveTexture = null; mat.emissiveColor = new Color3(0.42, 0.36, 0.55); }
    );
    mat.emissiveTexture = tex;
    mat.emissiveColor = Color3.Black(); // emissiveTexture takes precedence when it loads
  } else if (nodeData.status === "failed") {
    // Generation failed — muted red-grey to signal failure state.
    mat.emissiveColor = new Color3(0.55, 0.18, 0.18);
  } else {
    // Pending / generating / no asset_url — flat purple-grey placeholder.
    mat.emissiveColor = new Color3(0.42, 0.36, 0.55);
  }

  mesh.material = mat;

  return mesh;
}

/**
 * Draw a line edge connecting two node centers (child → parent).
 *
 * Uses MeshBuilder.CreateLines which produces a LinesMesh — no material
 * is created, so disposal is simply mesh.dispose() with no material leak.
 *
 * The line is rendered at z = -0.5 (slightly in front of node cards at z=0
 * in the camera's -Z view direction) so it doesn't z-fight the card faces.
 *
 * Color: mid-grey (0.45, 0.45, 0.45) — subtle so nodes remain the focus.
 *
 * @param {Scene} scene
 * @param {{ x: number, y: number }} childPos   world position of the child node
 * @param {{ x: number, y: number }} parentPos  world position of the parent node
 * @param {string} childId  used to name the mesh (must be unique per edge)
 * @returns {import("@babylonjs/core").LinesMesh}
 */
export function addEdgeMesh(scene, childPos, parentPos, childId) {
  const EDGE_Z = -0.5; // in front of cards so it's never occluded

  const points = [
    new Vector3(childPos.x,  childPos.y,  EDGE_Z),
    new Vector3(parentPos.x, parentPos.y, EDGE_Z),
  ];

  const lineMesh = MeshBuilder.CreateLines(
    `edge-${childId}`,
    {
      points,
      updatable: false,
      colors: [
        new Color4(0.45, 0.45, 0.45, 1),
        new Color4(0.45, 0.45, 0.45, 1),
      ],
    },
    scene
  );

  return lineMesh;
}
