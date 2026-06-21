/**
 * GeneratePanel.jsx
 *
 * DOM overlay (plain React, no Babylon) that lets the user type a prompt and
 * trigger generation via POST /api/trees/:treeId/generate.
 *
 * On success the returned node is appended to the store via addNode() so the
 * canvas picks it up through its existing useEffect(nodes) subscription.
 *
 * In-flight state is kept local (useState) to avoid polluting the reducer with
 * transient UI state.
 *
 * Layout: fixed bottom-centre overlay so it sits above the Babylon canvas.
 */

import { useState } from "react";
import { generate } from "../api/client.js";
import { useTreeStore, useTreeActions } from "../state/treeStore.jsx";
import { useBudgetActions } from "../budget/budgetStore.jsx";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  panel: {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    background: "rgba(18, 18, 24, 0.88)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "12px",
    padding: "12px 16px",
    zIndex: 100,
    minWidth: "340px",
    maxWidth: "520px",
    width: "calc(100vw - 48px)",
    boxSizing: "border-box",
  },
  row: {
    display: "flex",
    gap: "8px",
    width: "100%",
  },
  input: {
    flex: 1,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "14px",
    padding: "8px 12px",
    outline: "none",
    fontFamily: "inherit",
  },
  button: {
    background: "#5b6af0",
    border: "none",
    borderRadius: "8px",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
    padding: "8px 16px",
    whiteSpace: "nowrap",
    transition: "opacity 0.15s",
  },
  buttonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  statusLine: {
    fontSize: "12px",
    width: "100%",
    textAlign: "left",
  },
  statusPending: {
    color: "#aaa",
  },
  statusError: {
    color: "#f87171",
  },
  statusSuccess: {
    color: "#6ee7b7",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GeneratePanel() {
  const { tree, status: storeStatus } = useTreeStore();
  const { addNode } = useTreeActions();
  const { recordSpend } = useBudgetActions();

  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMsg, setStatusMsg] = useState(/** @type {null|{kind:'success'|'error'|'pending', text:string}} */ null);

  const treeReady = storeStatus === "ready" && tree != null;
  const canSubmit = treeReady && prompt.trim().length > 0 && !pending;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    const treeId = tree.id;
    // The backend always creates a 'main' branch as branches[0].
    const branchId = tree.branches?.[0]?.id;
    if (!branchId) {
      setStatusMsg({ kind: "error", text: "No branch found on tree — reload the page." });
      return;
    }

    const trimmedPrompt = prompt.trim();
    setPending(true);
    setStatusMsg({ kind: "pending", text: "Generating…" });

    try {
      const result = await generate(treeId, { branchId, prompt: trimmedPrompt });
      addNode(result.node);
      // Record spend from the generation cost; failed generations are caught
      // below and never reach this line, so we only record on success.
      const spentCredits = result.cost?.credits ?? result.node?.settings?.cost_credits ?? 0;
      if (spentCredits > 0) {
        recordSpend(spentCredits);
      }
      setPrompt("");
      const credits = result.cost?.credits ?? result.node?.settings?.cost_credits ?? null;
      setStatusMsg({
        kind: "success",
        text: credits != null ? `Done — spent ${credits} credits` : "Node generated",
      });
    } catch (err) {
      setStatusMsg({ kind: "error", text: err.message ?? "Generation failed" });
    } finally {
      setPending(false);
    }
  }

  const buttonStyle = canSubmit
    ? styles.button
    : { ...styles.button, ...styles.buttonDisabled };

  let statusStyle = styles.statusLine;
  if (statusMsg?.kind === "pending") statusStyle = { ...statusStyle, ...styles.statusPending };
  else if (statusMsg?.kind === "error") statusStyle = { ...statusStyle, ...styles.statusError };
  else if (statusMsg?.kind === "success") statusStyle = { ...statusStyle, ...styles.statusSuccess };

  return (
    <div style={styles.panel} aria-label="Generate panel">
      <form style={styles.row} onSubmit={handleSubmit}>
        <input
          style={styles.input}
          type="text"
          placeholder={treeReady ? "Enter a prompt…" : "Loading tree…"}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            // Clear old status on new input so the user gets fresh feedback
            if (statusMsg?.kind !== "pending") setStatusMsg(null);
          }}
          disabled={!treeReady || pending}
          aria-label="Prompt"
        />
        <button
          type="submit"
          style={buttonStyle}
          disabled={!canSubmit}
          aria-label="Generate"
        >
          {pending ? "Generating…" : "Generate"}
        </button>
      </form>
      {statusMsg && (
        <div style={statusStyle} role={statusMsg.kind === "error" ? "alert" : "status"}>
          {statusMsg.text}
        </div>
      )}
    </div>
  );
}
