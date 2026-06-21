/**
 * budgetReducer.js
 *
 * Pure reducer + constants for the budget store.
 * No React imports — unit-testable in a plain Node environment.
 *
 * State shape:
 *   { events: Array<{ts: number, credits: number}> }
 *
 * The configured total budget (TOTAL_BUDGET) and velocity window are imported
 * from velocity.js so there is a single source of truth.
 */

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export const BUDGET_ACTIONS = /** @type {const} */ ({
  RECORD_SPEND: "RECORD_SPEND",
  RESET: "RESET",
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** @type {{ events: Array<{ts: number, credits: number}> }} */
export const BUDGET_INITIAL_STATE = {
  events: [],
};

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

/**
 * @param {{ events: Array<{ts: number, credits: number}> }} state
 * @param {{ type: string, payload?: unknown }} action
 * @returns {{ events: Array<{ts: number, credits: number}> }}
 */
export function budgetReducer(state, action) {
  switch (action.type) {
    case BUDGET_ACTIONS.RECORD_SPEND: {
      // payload: { ts: number, credits: number }
      const event = action.payload;
      return { ...state, events: [...state.events, event] };
    }

    case BUDGET_ACTIONS.RESET:
      return { ...BUDGET_INITIAL_STATE };

    default:
      return state;
  }
}
