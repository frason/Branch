/**
 * BabylonCanvas.jsx
 *
 * React component that owns the <canvas> DOM element and delegates all
 * Babylon.js state to scene.js.  React is only responsible for:
 *   - Mounting/unmounting the canvas
 *   - Triggering scene init after the canvas is in the DOM
 *   - Calling dispose() on unmount
 *
 * Nothing Babylon-specific leaks into React state — future node data
 * will be passed as props and translated into scene mutations in scene.js.
 */

import { useEffect, useRef } from "react";
import { initScene } from "./scene.js";

const styles = {
  canvas: {
    display: "block",
    width: "100%",
    height: "100%",
    touchAction: "none", // prevents mobile scroll while interacting with canvas
  },
};

/**
 * @param {object}  props
 * @param {string}  [props.className]  optional extra CSS class on the canvas
 */
export function BabylonCanvas({ className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { dispose } = initScene(canvas);

    return () => {
      dispose();
    };
  }, []); // empty deps — init once on mount, dispose on unmount

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={styles.canvas}
    />
  );
}
