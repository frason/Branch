/**
 * Unit tests for velocity.js — pure budget + velocity math.
 * No React, no DOM, no Date.now() calls inside the functions being tested.
 * All tests pass `now` explicitly.
 */
import { describe, it, expect } from "vitest";
import {
  computeBalance,
  computeVelocity,
  TOTAL_BUDGET,
  DEFAULT_WINDOW_MS,
} from "./velocity.js";

// ---------------------------------------------------------------------------
// computeBalance
// ---------------------------------------------------------------------------

describe("computeBalance", () => {
  it("returns zero spent and full remaining when events is empty", () => {
    const result = computeBalance([], 100);
    expect(result.spent).toBe(0);
    expect(result.remaining).toBe(100);
    expect(result.overBudget).toBe(false);
  });

  it("sums credits from all events", () => {
    const events = [
      { ts: 1000, credits: 3 },
      { ts: 2000, credits: 5 },
      { ts: 3000, credits: 2 },
    ];
    const { spent } = computeBalance(events, 100);
    expect(spent).toBe(10);
  });

  it("calculates remaining as totalBudget - spent", () => {
    const events = [{ ts: 1000, credits: 30 }];
    const { remaining } = computeBalance(events, 100);
    expect(remaining).toBe(70);
  });

  it("clamps remaining to 0 when over-budget (never goes negative)", () => {
    const events = [{ ts: 1000, credits: 120 }];
    const { remaining } = computeBalance(events, 100);
    expect(remaining).toBe(0);
  });

  it("sets overBudget to true when spent exceeds totalBudget", () => {
    const events = [{ ts: 1000, credits: 101 }];
    const { overBudget } = computeBalance(events, 100);
    expect(overBudget).toBe(true);
  });

  it("overBudget is false when spent exactly equals totalBudget", () => {
    const events = [{ ts: 1000, credits: 100 }];
    const { overBudget } = computeBalance(events, 100);
    expect(overBudget).toBe(false);
  });

  it("works with the exported TOTAL_BUDGET constant", () => {
    const events = [{ ts: 0, credits: TOTAL_BUDGET / 2 }];
    const { spent, remaining } = computeBalance(events, TOTAL_BUDGET);
    expect(spent).toBe(TOTAL_BUDGET / 2);
    expect(remaining).toBe(TOTAL_BUDGET / 2);
  });

  it("handles events with missing credits field gracefully (treats as 0)", () => {
    const events = [{ ts: 1000 }, { ts: 2000, credits: 5 }];
    const { spent } = computeBalance(events, 100);
    expect(spent).toBe(5);
  });

  it("handles multiple events summing to exactly the budget", () => {
    const events = [
      { ts: 1, credits: 40 },
      { ts: 2, credits: 35 },
      { ts: 3, credits: 25 },
    ];
    const { spent, remaining, overBudget } = computeBalance(events, 100);
    expect(spent).toBe(100);
    expect(remaining).toBe(0);
    expect(overBudget).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeVelocity
// ---------------------------------------------------------------------------

describe("computeVelocity", () => {
  const NOW = 1_000_000; // arbitrary reference timestamp in ms
  const WINDOW = DEFAULT_WINDOW_MS; // 60 000 ms

  it("returns 0 when events array is empty", () => {
    expect(computeVelocity([], WINDOW, NOW)).toBe(0);
  });

  it("returns 0 when there are no events within the window", () => {
    const events = [{ ts: NOW - WINDOW - 1, credits: 10 }]; // just outside
    expect(computeVelocity(events, WINDOW, NOW)).toBe(0);
  });

  it("includes events at exactly the window cutoff boundary", () => {
    const events = [{ ts: NOW - WINDOW, credits: 6 }]; // exactly at cutoff
    const v = computeVelocity(events, WINDOW, NOW);
    // 6 credits / 1 minute = 6 cr/min
    expect(v).toBe(6);
  });

  it("includes events at the now timestamp boundary", () => {
    const events = [{ ts: NOW, credits: 3 }];
    const v = computeVelocity(events, WINDOW, NOW);
    expect(v).toBe(3); // 3 credits in 1 min window
  });

  it("excludes events strictly older than the window", () => {
    const events = [
      { ts: NOW - WINDOW - 1000, credits: 99 }, // outside
      { ts: NOW - 5000, credits: 2 },            // inside
    ];
    const v = computeVelocity(events, WINDOW, NOW);
    // only 2 credits in the 60-second window → 2 cr/min
    expect(v).toBeCloseTo(2, 5);
  });

  it("converts to credits-per-minute correctly for a 1-minute window", () => {
    // 12 credits in 60 s → 12 cr/min
    const events = [
      { ts: NOW - 10_000, credits: 4 },
      { ts: NOW - 20_000, credits: 8 },
    ];
    const v = computeVelocity(events, WINDOW, NOW);
    expect(v).toBe(12);
  });

  it("scales correctly for a shorter window", () => {
    // 30-second window; 6 credits inside → 6 / 0.5 min = 12 cr/min
    const shortWindow = 30_000;
    const events = [{ ts: NOW - 10_000, credits: 6 }];
    const v = computeVelocity(events, shortWindow, NOW);
    expect(v).toBe(12);
  });

  it("a burst of close events raises velocity significantly", () => {
    const burst = Array.from({ length: 5 }, (_, i) => ({
      ts: NOW - i * 1000, // 5 events fired 1 s apart, all in the last 5 s
      credits: 1,
    }));
    const vBurst = computeVelocity(burst, WINDOW, NOW);

    // Compare to a single event spread over the window
    const sparse = [{ ts: NOW - WINDOW + 1, credits: 5 }];
    const vSparse = computeVelocity(sparse, WINDOW, NOW);

    // Same total credits, same velocity in a 60-s window — both = 5 cr/min
    expect(vBurst).toBeCloseTo(vSparse, 5);

    // But a burst vs 0 baseline — velocity is non-zero and equals 5 cr/min
    expect(vBurst).toBe(5);
  });

  it("does not mutate the events array", () => {
    const events = [{ ts: NOW - 1000, credits: 2 }];
    const copy = [...events];
    computeVelocity(events, WINDOW, NOW);
    expect(events).toEqual(copy);
  });

  it("is deterministic — same inputs produce same output", () => {
    const events = [{ ts: NOW - 5000, credits: 3 }];
    const v1 = computeVelocity(events, WINDOW, NOW);
    const v2 = computeVelocity(events, WINDOW, NOW);
    expect(v1).toBe(v2);
  });

  it("decays to 0 as events age out of the trailing window", () => {
    // A burst of spend, then time advances past the whole window — the meter
    // must return to 0 (the core Doherty 'velocity spikes then decays' behavior).
    const events = [
      { ts: NOW, credits: 5 },
      { ts: NOW + 1000, credits: 5 },
    ];
    // Right after the burst: non-zero.
    expect(computeVelocity(events, WINDOW, NOW + 1000)).toBeGreaterThan(0);
    // Once `now` is past the last event + window: all events excluded → 0.
    expect(computeVelocity(events, WINDOW, NOW + 1000 + WINDOW + 1)).toBe(0);
  });

  it("returns 0 for a non-positive window instead of dividing by zero", () => {
    const events = [{ ts: NOW, credits: 5 }];
    expect(computeVelocity(events, 0, NOW)).toBe(0);
    expect(computeVelocity(events, -1000, NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// budgetReducer (pure state transitions)
// ---------------------------------------------------------------------------

import { budgetReducer, BUDGET_INITIAL_STATE, BUDGET_ACTIONS } from "./budgetReducer.js";

describe("budgetReducer", () => {
  it("starts with an empty events array", () => {
    expect(BUDGET_INITIAL_STATE.events).toEqual([]);
  });

  it("RECORD_SPEND appends the event", () => {
    const event = { ts: 1000, credits: 3 };
    const next = budgetReducer(BUDGET_INITIAL_STATE, {
      type: BUDGET_ACTIONS.RECORD_SPEND,
      payload: event,
    });
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toEqual(event);
  });

  it("RECORD_SPEND does not mutate previous state", () => {
    const prev = { events: [{ ts: 1, credits: 1 }] };
    budgetReducer(prev, {
      type: BUDGET_ACTIONS.RECORD_SPEND,
      payload: { ts: 2, credits: 1 },
    });
    expect(prev.events).toHaveLength(1);
  });

  it("RECORD_SPEND accumulates multiple events", () => {
    let state = BUDGET_INITIAL_STATE;
    for (let i = 0; i < 3; i++) {
      state = budgetReducer(state, {
        type: BUDGET_ACTIONS.RECORD_SPEND,
        payload: { ts: i * 1000, credits: 1 },
      });
    }
    expect(state.events).toHaveLength(3);
  });

  it("RESET returns to initial state", () => {
    const dirty = { events: [{ ts: 1, credits: 5 }] };
    const next = budgetReducer(dirty, { type: BUDGET_ACTIONS.RESET });
    expect(next).toEqual(BUDGET_INITIAL_STATE);
  });

  it("unknown action returns state unchanged (same reference)", () => {
    const state = { events: [] };
    const next = budgetReducer(state, { type: "UNKNOWN" });
    expect(next).toBe(state);
  });
});
