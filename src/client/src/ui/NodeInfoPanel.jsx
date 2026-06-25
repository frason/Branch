/**
 * NodeInfoPanel.jsx
 *
 * Fixed-position DOM overlay that displays the selected node's prompt.
 * Appears bottom-left when a node is selected; hidden otherwise.
 *
 * Reads selectedNodeId and nodes from the tree store.
 * Supports a 2-line truncated preview with a "View more" toggle.
 */

import { useState } from "react";
import { useTreeStore, useTreeActions } from "../state/treeStore.jsx";

const PANEL_STYLE = {
  position: "fixed",
  bottom: "24px",
  left: "24px",
  width: "280px",
  maxWidth: "calc(100vw - 48px)",
  background: "rgba(18,18,24,0.88)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  padding: "14px 16px",
  zIndex: 20,
  boxSizing: "border-box",
  color: "rgba(255,255,255,0.9)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const HEADER_STYLE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "8px",
};

const LABEL_STYLE = {
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.45)",
};

const CLOSE_BUTTON_STYLE = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.45)",
  cursor: "pointer",
  fontSize: "16px",
  lineHeight: 1,
  padding: "0 0 0 8px",
  display: "flex",
  alignItems: "center",
};

const PROMPT_TRUNCATED_STYLE = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "rgba(255,255,255,0.85)",
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  wordBreak: "break-word",
};

const PROMPT_EXPANDED_STYLE = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "rgba(255,255,255,0.85)",
  wordBreak: "break-word",
};

const TOGGLE_BUTTON_STYLE = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.45)",
  cursor: "pointer",
  fontSize: "11px",
  padding: "4px 0 0 0",
  display: "block",
};

export function NodeInfoPanel() {
  const { selectedNodeId, nodes } = useTreeStore();
  const { selectNode } = useTreeActions();
  const [expanded, setExpanded] = useState(false);

  if (!selectedNodeId) return null;

  const node = nodes.find((n) => n.id === selectedNodeId);
  const prompt = node?.prompt ?? null;

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <span style={LABEL_STYLE}>Node prompt</span>
        <button
          style={CLOSE_BUTTON_STYLE}
          onClick={() => {
            selectNode(null);
            setExpanded(false);
          }}
          aria-label="Deselect node"
        >
          ×
        </button>
      </div>

      {prompt ? (
        <>
          <p
            style={expanded ? PROMPT_EXPANDED_STYLE : PROMPT_TRUNCATED_STYLE}
          >
            {prompt}
          </p>
          <button
            style={TOGGLE_BUTTON_STYLE}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▼ View less" : "▲ View more"}
          </button>
        </>
      ) : (
        <p style={{ ...PROMPT_TRUNCATED_STYLE, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
          No prompt available
        </p>
      )}
    </div>
  );
}
