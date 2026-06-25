/**
 * App.jsx
 *
 * Root application component.  Wraps the canvas in TreeProvider and
 * BudgetProvider so both stores are available throughout the tree.
 * Triggers loadOrCreateTree() on mount so the canvas renders from backend data
 * on startup.
 *
 * Future additions here:
 *   - Per-node settings panel
 */

import { useEffect } from "react";
import { BabylonCanvas } from "./canvas/BabylonCanvas.jsx";
import { GeneratePanel } from "./ui/GeneratePanel.jsx";
import { BudgetMeter } from "./ui/BudgetMeter.jsx";
import { KeyPanel } from "./ui/KeyPanel.jsx";
import { NodeInfoPanel } from "./ui/NodeInfoPanel.jsx";
import { TreeProvider, useTreeActions } from "./state/treeStore.jsx";
import { BudgetProvider } from "./budget/budgetStore.jsx";

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
      <KeyPanel />
      <GeneratePanel />
      <BudgetMeter />
      <NodeInfoPanel />
    </div>
  );
}

export function App() {
  return (
    <TreeProvider>
      <BudgetProvider>
        <AppInner />
      </BudgetProvider>
    </TreeProvider>
  );
}
