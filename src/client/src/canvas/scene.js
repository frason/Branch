/**
 * scene.js
 *
 * Babylon.js scene bootstrap — engine creation, camera setup, render loop,
 * and the single-node mesh factory.
 *
 * This module is intentionally a plain JS module with NO React imports.
 * The React component (BabylonCanvas.jsx) owns the <canvas> DOM node and
 * calls into here; all Babylon state lives here so it can be disposed
 * cleanly without React needing to know about it.
 *
 * Scaling path:
 *   - `createNodeMesh` will be called once per node; keep it cheap.
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
} from "@babylonjs/core";

import { computeNodeTransform } from "./nodeHelpers.js";

/**
 * Bootstrap a Babylon engine + scene on the given canvas element.
 *
 * Returns a teardown function; call it on React component unmount.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ dispose: () => void }}
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
    1, // radius is irrelevant in ortho mode but must be > 0
    Vector3.Zero(),
    scene
  );

  // Fixed ortho bounds — centred on origin, 800×600 world units visible.
  // These values are intentionally wider than a single node so there is
  // breathing room; later pan/zoom changes these at runtime.
  const VIEW_HALF_W = 400;
  const VIEW_HALF_H = 400;
  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -VIEW_HALF_W;
  camera.orthoRight = VIEW_HALF_W;
  camera.orthoTop = VIEW_HALF_H;
  camera.orthoBottom = -VIEW_HALF_H;

  // Do NOT attach user controls — pan/zoom will be wired explicitly later.

  // ------------------------------------------------------------------
  // Light — a simple ambient so the placeholder colour reads cleanly
  // ------------------------------------------------------------------
  const light = new HemisphericLight("hemi-light", new Vector3(0, 1, 0), scene);
  light.intensity = 1.0;

  // ------------------------------------------------------------------
  // Single static node mesh
  // ------------------------------------------------------------------
  addNodeMesh(scene, { id: "node-0", x: 0, y: 0 });

  // ------------------------------------------------------------------
  // Render loop
  // ------------------------------------------------------------------
  engine.runRenderLoop(() => {
    scene.render();
  });

  // ------------------------------------------------------------------
  // Resize handling — kept here so the component just passes the canvas
  // ------------------------------------------------------------------
  const handleResize = () => engine.resize();
  window.addEventListener("resize", handleResize);

  // ------------------------------------------------------------------
  // Teardown
  // ------------------------------------------------------------------
  return {
    dispose() {
      window.removeEventListener("resize", handleResize);
      engine.stopRenderLoop();
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

  // Placeholder material — mid-grey card with a subtle purple tint.
  // Replace with an image texture (StandardMaterial.diffuseTexture) once
  // the image generation pipeline is wired up.
  const mat = new StandardMaterial(`mat-${nodeData.id}`, scene);
  mat.diffuseColor = new Color3(0.22, 0.18, 0.3); // muted purple-grey
  mat.emissiveColor = new Color3(0.08, 0.06, 0.12); // slight glow so it reads on dark bg
  mat.specularColor = Color3.Black(); // flat, no specular highlights
  mesh.material = mat;

  return mesh;
}
