/**
 * KeyPanel.jsx
 *
 * DOM overlay (no Babylon imports) for managing the user's fal.ai API key.
 *
 * Behaviour:
 *   - When no key is stored: shows a password input + Save button, a link to
 *     get a key, and a privacy note.
 *   - When a key is stored: shows a masked indicator ("Key saved: prefix…last4")
 *     and a Clear button so the user can remove it.
 *   - Provides a non-blocking format hint via looksLikeFalKey — warns the user
 *     if the pasted value doesn't look right, but does NOT block saving.
 *
 * Privacy note (always visible): the key stays in this browser and is sent
 * only to Branch's backend proxy to relay to fal.ai — never stored server-side.
 *
 * Layout: fixed top-left overlay, sits above the Babylon canvas (z-index 100).
 */

import { useState, useSyncExternalStore } from "react";
import { getKey, setKey, clearKey, subscribe } from "../byok/keyStore.js";
import { looksLikeFalKey, maskKey } from "../byok/keyHelpers.js";

// ---------------------------------------------------------------------------
// Hook — reactive key from the store
// ---------------------------------------------------------------------------

function useStoredKey() {
  return useSyncExternalStore(subscribe, getKey);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  panel: {
    position: "fixed",
    top: "16px",
    left: "16px",
    background: "rgba(18, 18, 24, 0.92)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px",
    padding: "10px 14px",
    zIndex: 100,
    minWidth: "220px",
    maxWidth: "300px",
    color: "#e2e8f0",
    fontFamily: "inherit",
    fontSize: "12px",
    lineHeight: "1.5",
    userSelect: "none",
    boxSizing: "border-box",
  },
  label: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "4px",
  },
  row: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    width: "100%",
    marginBottom: "6px",
  },
  input: {
    flex: 1,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "6px",
    color: "#fff",
    fontSize: "12px",
    padding: "5px 8px",
    outline: "none",
    fontFamily: "monospace",
    minWidth: 0,
  },
  inputWarn: {
    border: "1px solid rgba(251,146,60,0.7)",
  },
  btnSave: {
    background: "#5b6af0",
    border: "none",
    borderRadius: "6px",
    color: "#fff",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    padding: "5px 10px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  btnClear: {
    background: "rgba(248,113,113,0.15)",
    border: "1px solid rgba(248,113,113,0.35)",
    borderRadius: "6px",
    color: "#f87171",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    padding: "5px 10px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  savedRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "6px",
    marginBottom: "6px",
  },
  savedText: {
    color: "#6ee7b7",
    fontSize: "11px",
    fontFamily: "monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  hint: {
    color: "#fb923c",
    fontSize: "10px",
    marginBottom: "4px",
  },
  privacy: {
    color: "rgba(255,255,255,0.38)",
    fontSize: "10px",
    lineHeight: "1.4",
    marginTop: "4px",
  },
  link: {
    color: "#818cf8",
    textDecoration: "none",
  },
  divider: {
    height: "1px",
    background: "rgba(255,255,255,0.08)",
    margin: "6px 0",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KeyPanel() {
  const savedKey = useStoredKey();
  const hasSavedKey = savedKey.length > 0;

  const [draft, setDraft] = useState("");
  const [showHint, setShowHint] = useState(false);

  function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setKey(trimmed);
    setDraft("");
    setShowHint(false);
  }

  function handleClear() {
    clearKey();
    setDraft("");
    setShowHint(false);
  }

  function handleDraftChange(e) {
    const val = e.target.value;
    setDraft(val);
    // Show the format hint only when the user has typed something and it
    // doesn't look right — non-blocking, never prevents saving.
    setShowHint(val.trim().length > 0 && !looksLikeFalKey(val));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSave();
  }

  return (
    <aside style={styles.panel} aria-label="fal.ai API key panel">
      <div style={styles.label}>fal.ai Key</div>

      {hasSavedKey ? (
        <div style={styles.savedRow}>
          <span style={styles.savedText} title={maskKey(savedKey)}>
            Key saved: {maskKey(savedKey)}
          </span>
          <button
            style={styles.btnClear}
            onClick={handleClear}
            aria-label="Clear saved API key"
          >
            Clear
          </button>
        </div>
      ) : (
        <>
          <div style={styles.row}>
            <input
              style={showHint ? { ...styles.input, ...styles.inputWarn } : styles.input}
              type="password"
              placeholder="Paste your fal.ai key"
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleKeyDown}
              aria-label="fal.ai API key input"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              style={styles.btnSave}
              onClick={handleSave}
              disabled={draft.trim().length === 0}
              aria-label="Save API key"
            >
              Save
            </button>
          </div>
          {showHint && (
            <div style={styles.hint} role="alert">
              This doesn't look like a fal.ai key (expected format: id:secret).
              You can still save it — check{" "}
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                fal.ai/dashboard/keys
              </a>
              .
            </div>
          )}
        </>
      )}

      <div style={styles.divider} />

      <div style={styles.privacy}>
        Your key is stored in this browser and sent only to Branch's backend to
        relay to fal.ai — never stored on our servers.{" "}
        <a
          href="https://fal.ai/dashboard/keys"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          Get a key
        </a>
        .
      </div>
    </aside>
  );
}
