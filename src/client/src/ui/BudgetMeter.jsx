/**
 * BudgetMeter.jsx
 *
 * DOM overlay (no Babylon imports) that shows:
 *   - Remaining budget vs total (bar + numbers)
 *   - Credits spent
 *   - Current rolling velocity (credits/min) over the trailing 60 s window
 *
 * The velocity is recomputed on a ~250 ms timer (well under the 400 ms
 * Doherty threshold) using the pure computeVelocity() function with Date.now()
 * as the `now` parameter — so it naturally decays as old events slide out of
 * the window, and spikes when several generations fire in quick succession.
 *
 * The timer is cleaned up on unmount to prevent memory leaks.
 *
 * Layout: fixed top-right overlay, sits above the Babylon canvas.
 */

import { useState, useEffect } from "react";
import { useBudgetStore } from "../budget/budgetStore.jsx";
import { computeVelocity, TOTAL_BUDGET, DEFAULT_WINDOW_MS } from "../budget/velocity.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    position: "fixed",
    top: "16px",
    right: "16px",
    background: "rgba(18, 18, 24, 0.88)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px",
    padding: "10px 14px",
    zIndex: 100,
    minWidth: "180px",
    color: "#e2e8f0",
    fontFamily: "inherit",
    fontSize: "12px",
    lineHeight: "1.5",
    userSelect: "none",
  },
  label: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "2px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "8px",
  },
  value: {
    fontWeight: 600,
    fontSize: "13px",
    color: "#f1f5f9",
  },
  valueDanger: {
    fontWeight: 600,
    fontSize: "13px",
    color: "#f87171",
  },
  divider: {
    height: "1px",
    background: "rgba(255,255,255,0.08)",
    margin: "6px 0",
  },
  barTrack: {
    width: "100%",
    height: "4px",
    background: "rgba(255,255,255,0.1)",
    borderRadius: "2px",
    margin: "4px 0 6px",
    overflow: "hidden",
  },
  velocityAccent: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#818cf8",
    marginRight: "5px",
    verticalAlign: "middle",
    transition: "transform 0.25s ease",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @param {{ windowMs?: number }} props
 *   windowMs — trailing window for velocity (default DEFAULT_WINDOW_MS = 60 000 ms)
 */
export function BudgetMeter({ windowMs = DEFAULT_WINDOW_MS }) {
  const { events, spent, remaining, overBudget } = useBudgetStore();

  // Recompute velocity on a ~250 ms tick so it decays in real time.
  const [velocity, setVelocity] = useState(0);

  useEffect(() => {
    function tick() {
      setVelocity(computeVelocity(events, windowMs, Date.now()));
    }
    tick(); // immediate first compute
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [events, windowMs]);

  const pct = Math.min(100, (remaining / TOTAL_BUDGET) * 100);

  // Bar colour: green when healthy, amber below 25%, red when over-budget
  const barColor = overBudget
    ? "#f87171"
    : pct < 25
    ? "#fb923c"
    : "#34d399";

  const valueStyle = overBudget ? styles.valueDanger : styles.value;

  // Pulse the velocity dot when velocity is nonzero
  const dotScale = velocity > 0 ? 1.5 : 1;

  return (
    <aside
      style={styles.container}
      aria-label="Budget meter"
      role="complementary"
    >
      {/* Budget balance */}
      <div style={styles.label}>Budget</div>
      <div style={styles.row}>
        <span style={valueStyle}>{remaining} / {TOTAL_BUDGET}</span>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>
          credits
        </span>
      </div>

      {/* Progress bar */}
      <div style={styles.barTrack} aria-hidden="true">
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: barColor,
            borderRadius: "2px",
            transition: "width 0.25s ease, background 0.25s ease",
          }}
        />
      </div>

      {/* Spent */}
      <div style={styles.row}>
        <span style={styles.label}>Spent</span>
        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
          {spent} cr
        </span>
      </div>

      <div style={styles.divider} />

      {/* Velocity */}
      <div style={styles.label}>Velocity</div>
      <div style={styles.row}>
        <span>
          <span
            style={{
              ...styles.velocityAccent,
              transform: `scale(${dotScale})`,
            }}
            aria-hidden="true"
          />
          <span style={styles.value}>
            {velocity.toFixed(1)}
          </span>
        </span>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>
          cr / min
        </span>
      </div>
    </aside>
  );
}
