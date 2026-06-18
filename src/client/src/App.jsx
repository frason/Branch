/**
 * App.jsx
 *
 * Root application component.  Wraps the canvas in TreeProvider so the
 * store is available throughout the tree, and triggers loadOrCreateTree()
 * on mount so the canvas renders from backend data on startup.
 *
 * Future additions here:
 *   - Prompt input overlay
 *   - Per-node settings panel
 *   - Budget / velocity meter
 */

import { useEffect } from "react";
import { BabylonCanvas } from "./canvas/BabylonCanvas.jsx";
import { TreeProvider, useTreeActions } from "./state/treeStore.jsx";

const styles = {
  app: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
};

/**
 * Inner component so it can call useTreeActions() inside the provider.
 */
function AppInner() {
  const { loadOrCreateTree } = useTreeActions();

  useEffect(() => {
    // Per-invocation AbortController so StrictMode's double-invoke (and any
    // remount) cancels the prior in-flight load instead of racing it.
    const controller = new AbortController();
    loadOrCreateTree(controller.signal);
    return () => controller.abort();
  }, [loadOrCreateTree]);

  return (
    <div style={styles.app}>
      <BabylonCanvas />
    </div>
  );
}

export function App() {
  return (
    <TreeProvider>
      <AppInner />
    </TreeProvider>
  );
}
