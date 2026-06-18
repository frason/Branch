/**
 * App.jsx
 *
 * Root application component.  Currently just mounts the full-screen
 * canvas.  Future additions here:
 *   - Prompt input overlay
 *   - Per-node settings panel
 *   - Budget / velocity meter
 */

import { BabylonCanvas } from "./canvas/BabylonCanvas.jsx";

const styles = {
  app: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
};

export function App() {
  return (
    <div style={styles.app}>
      <BabylonCanvas />
    </div>
  );
}
