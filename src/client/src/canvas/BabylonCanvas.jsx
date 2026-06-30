/**
 * BabylonCanvas.jsx
 *
 * React component that owns the <canvas> DOM element and delegates all
 * Babylon.js state to scene.js.  React is only responsible for:
 *   - Mounting/unmounting the canvas
 *   - Triggering scene init after the canvas is in the DOM
 *   - Calling dispose() on unmount
 *   - Subscribing to the tree store and forwarding nodes to the scene
 *
 * Nothing Babylon-specific leaks into React state.
 * BabylonCanvas talks only to the store (useTreeStore) and the handle
 * returned by initScene — it does not import Babylon directly.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { initScene } from "./scene.js";
import { useTreeStore, useTreeActions } from "../state/treeStore.jsx";

const styles = {
  wrapper: {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  canvas: {
    display: "block",
    width: "100%",
    height: "100%",
    touchAction: "none", // prevents mobile scroll while interacting with canvas
  },
  overlay: {
    position: "absolute",
    top: "12px",
    left: "12px",
    padding: "6px 12px",
    borderRadius: "4px",
    fontSize: "12px",
    fontFamily: "monospace",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 10,
  },
  overlayLoading: {
    background: "rgba(0,0,0,0.55)",
    color: "#aaa",
  },
  overlayError: {
    background: "rgba(180,30,30,0.75)",
    color: "#fff",
  },
  autoFrameBtn: {
    position: "absolute",
    bottom: "16px",
    right: "16px",
    padding: "6px 12px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "4px",
    color: "#ccc",
    fontSize: "12px",
    fontFamily: "monospace",
    cursor: "pointer",
    userSelect: "none",
    zIndex: 10,
  },
};

/**
 * @param {object}  props
 * @param {string}  [props.className]  optional extra CSS class on the canvas
 */
export function BabylonCanvas({ className }) {
  const canvasRef = useRef(null);
  // sceneHandle holds { dispose, setNodes } returned by initScene
  const sceneRef = useRef(null);

  const { nodes, status, error } = useTreeStore();
  const { selectNode } = useTreeActions();

  const onSelect = useCallback(
    (nodeId) => {
      selectNode(nodeId);
    },
    [selectNode]
  );

  const handleAutoFrame = useCallback(() => {
    sceneRef.current?.autoFrame();
  }, []);

  // `f` key triggers auto-frame when canvas is focused
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "f" || e.key === "F") handleAutoFrame();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAutoFrame]);

  // Init scene once on mount, dispose on unmount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handle = initScene(canvas, { onSelect });
    sceneRef.current = handle;

    return () => {
      handle.dispose();
      sceneRef.current = null;
    };
  }, []); // empty deps — init once on mount, dispose on unmount

  // Forward nodes to the scene whenever they change.
  // If the API is in error state we leave the scene in its fallback state
  // (the placeholder node rendered by initScene).
  useEffect(() => {
    if (!sceneRef.current) return;
    if (status === "ready") {
      sceneRef.current.setNodes(nodes);
    }
    // For 'idle', 'loading', 'error': do nothing — fallback placeholder stays.
  }, [nodes, status]);

  const showLoading = status === "loading";
  const showError = status === "error";

  return (
    <div style={styles.wrapper}>
      <canvas
        ref={canvasRef}
        className={className}
        style={styles.canvas}
      />
      {showLoading && (
        <div style={{ ...styles.overlay, ...styles.overlayLoading }}>
          Connecting to API…
        </div>
      )}
      {showError && (
        <div
          role="alert"
          style={{ ...styles.overlay, ...styles.overlayError }}
        >
          API unreachable — showing placeholder
          {error ? `: ${error}` : ""}
        </div>
      )}
      <button
        style={styles.autoFrameBtn}
        onClick={handleAutoFrame}
        title="Fit all nodes (F)"
      >
        ⊡ fit
      </button>
    </div>
  );
}
