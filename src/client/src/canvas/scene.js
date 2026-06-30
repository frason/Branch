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
  ActionManager,
  ExecuteCodeAction,
} from "@babylonjs/core";
// Color3 is used for node materials; Color4 used for scene clear and line colors.

import { computeNodeTransform, computeTreeLayout, computeOrthoFrustum, NODE_DEFAULTS } from "./nodeHelpers.js";

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
export function initScene(canvas, { onSelect } = {}) {
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

  // Do NOT attach user controls — pan/zoom is handled via explicit pointer/wheel events below.

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

  // ------------------------------------------------------------------
  // Camera movement API — pan, zoom, autoFrame
  //
  // All three mutate orthoLeft/Right/Top/Bottom directly. Exposing them
  // as named functions lets BabylonCanvas wire them to pointer/wheel events
  // AND lets future keyboard-shortcut code (#58) call the same functions
  // without duplicating the math.
  //
  // Zoom limits (in world units visible across the width):
  //   MIN_VIEW_WIDTH = 200  → maximum zoom-in  (~2× a single node)
  //   MAX_VIEW_WIDTH = 8000 → maximum zoom-out (very wide tree)
  // ------------------------------------------------------------------
  const MIN_VIEW_WIDTH = 200;
  const MAX_VIEW_WIDTH = 8000;

  // Tracks layout nodes so autoFrame can use current positions.
  let currentLayoutNodes = [];

  /**
   * Pan the camera by (dx, dy) screen pixels.
   * Converts pixel delta to world-space delta using current frustum size.
   *
   * @param {number} dx  positive = pan right
   * @param {number} dy  positive = pan up (screen y-down → world y-up inversion)
   */
  function pan(dx, dy) {
    const w = canvas.clientWidth  || 1;
    const h = canvas.clientHeight || 1;
    const scaleX = (camera.orthoRight - camera.orthoLeft) / w;
    const scaleY = (camera.orthoTop   - camera.orthoBottom) / h;
    camera.orthoLeft   -= dx * scaleX;
    camera.orthoRight  -= dx * scaleX;
    // Screen y is flipped relative to world y
    camera.orthoTop    += dy * scaleY;
    camera.orthoBottom += dy * scaleY;
  }

  /**
   * Zoom by a scale factor around a screen-space pivot point.
   * factor > 1 zooms out, factor < 1 zooms in.
   *
   * @param {number} factor    multiplier for the current view size
   * @param {number} pivotX    canvas-relative X pixel (default: canvas center)
   * @param {number} pivotY    canvas-relative Y pixel (default: canvas center)
   */
  function zoom(factor, pivotX, pivotY) {
    const w = canvas.clientWidth  || 1;
    const h = canvas.clientHeight || 1;
    const cx = pivotX ?? w / 2;
    const cy = pivotY ?? h / 2;

    // Convert pivot from screen space to world space
    const worldCX = camera.orthoLeft + (cx / w) * (camera.orthoRight - camera.orthoLeft);
    const worldCY = camera.orthoTop  - (cy / h) * (camera.orthoTop   - camera.orthoBottom);

    // Clamp so we don't zoom past the limits
    const currentWidth = camera.orthoRight - camera.orthoLeft;
    const clampedFactor = Math.min(
      Math.max(factor, MIN_VIEW_WIDTH / currentWidth),
      MAX_VIEW_WIDTH / currentWidth
    );

    camera.orthoLeft   = worldCX + (camera.orthoLeft   - worldCX) * clampedFactor;
    camera.orthoRight  = worldCX + (camera.orthoRight  - worldCX) * clampedFactor;
    camera.orthoTop    = worldCY + (camera.orthoTop    - worldCY) * clampedFactor;
    camera.orthoBottom = worldCY + (camera.orthoBottom - worldCY) * clampedFactor;
  }

  /**
   * Fit all current nodes into view with padding.
   * Falls back to the default view when no nodes are loaded.
   */
  function autoFrame() {
    const bounds = computeOrthoFrustum(currentLayoutNodes);
    camera.orthoLeft   = bounds.left;
    camera.orthoRight  = bounds.right;
    camera.orthoTop    = bounds.top;
    camera.orthoBottom = bounds.bottom;
  }

  // ------------------------------------------------------------------
  // Pointer events for pan (drag) + wheel for zoom
  // ------------------------------------------------------------------
  let isPanning = false;
  let lastPX = 0;
  let lastPY = 0;

  function onPointerDown(e) {
    // Only pan on primary button; leave right-click / middle-click alone
    if (e.button !== 0) return;
    isPanning = true;
    lastPX = e.clientX;
    lastPY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!isPanning) return;
    pan(e.clientX - lastPX, e.clientY - lastPY);
    lastPX = e.clientX;
    lastPY = e.clientY;
  }

  function onPointerUp(e) {
    if (!isPanning) return;
    isPanning = false;
    canvas.releasePointerCapture(e.pointerId);
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;
    // ctrlKey = trackpad pinch on macOS (reported as ctrl+wheel)
    // Regular scroll: deltaY ~100 per notch; pinch: smaller deltas
    const SENSITIVITY = 0.001;
    const rawDelta = e.ctrlKey ? e.deltaY * 3 : e.deltaY;
    const factor = 1 + rawDelta * SENSITIVITY;
    zoom(factor, pivotX, pivotY);
  }

  canvas.addEventListener("pointerdown",  onPointerDown);
  canvas.addEventListener("pointermove",  onPointerMove);
  canvas.addEventListener("pointerup",    onPointerUp);
  canvas.addEventListener("pointercancel",onPointerUp);
  // passive: false so we can call preventDefault() and stop page scroll
  canvas.addEventListener("wheel", onWheel, { passive: false });

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
  const fallbackMesh = addNodeMesh(scene, FALLBACK_NODE, { onSelect });
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
      const mesh = addNodeMesh(scene, FALLBACK_NODE, { onSelect });
      meshMap.set(FALLBACK_NODE.id, mesh);
      return;
    }

    // Compute tree layout — pure function, no Babylon dependency.
    // Each entry in layoutMap is { x, y } in world space.
    const layoutMap = computeTreeLayout(nodes);

    // Keep a flat list of positioned nodes so autoFrame always has current positions.
    currentLayoutNodes = nodes.map((n) => {
      const pos = layoutMap.get(n.id) ?? { x: 0, y: 0 };
      return { ...n, x: pos.x, y: pos.y };
    });

    // Render node cards
    for (const node of nodes) {
      const pos = layoutMap.get(node.id) ?? { x: 0, y: 0 };
      const layoutData = { id: node.id, x: pos.x, y: pos.y, asset_url: node.asset_url, status: node.status };
      const mesh = addNodeMesh(scene, layoutData, { onSelect });
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
    pan,
    zoom,
    autoFrame,
    dispose() {
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("pointerdown",   onPointerDown);
      canvas.removeEventListener("pointermove",   onPointerMove);
      canvas.removeEventListener("pointerup",     onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel",         onWheel);
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
 * @param {{ onSelect?: (id: string) => void }} [options={}]
 * @returns {import("@babylonjs/core").Mesh}
 */
export function addNodeMesh(scene, nodeData, options = {}) {
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
    mat.emissiveTexture = new Texture(nodeData.asset_url, scene);
    mat.emissiveColor = Color3.Black(); // emissiveTexture takes precedence
  } else if (nodeData.status === "failed") {
    // Generation failed — muted red-grey to signal failure state.
    mat.emissiveColor = new Color3(0.55, 0.18, 0.18);
  } else {
    // Pending / generating / no asset_url — flat purple-grey placeholder.
    mat.emissiveColor = new Color3(0.42, 0.36, 0.55);
  }

  mesh.material = mat;

  // Wire up click selection if a callback was provided.
  if (options?.onSelect) {
    mesh.actionManager = new ActionManager(scene);
    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        options.onSelect(nodeData.id);
      })
    );
  }

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
