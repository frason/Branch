/**
 * treeReducer.js
 *
 * Pure reducer + constants for the tree store.
 * No React imports — unit-testable in a plain Node environment.
 */

// ---------------------------------------------------------------------------
// State shape + initial value
// ---------------------------------------------------------------------------

/**
 * @typedef {'idle'|'loading'|'ready'|'error'} StoreStatus
 * @typedef {{ tree: object|null, nodes: object[], status: StoreStatus, error: string|null }} StoreState
 */

/** @type {StoreState} */
export const INITIAL_STATE = {
  tree: null,
  nodes: [],
  status: "idle",
  error: null,
};

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export const ACTIONS = /** @type {const} */ ({
  LOAD_START: "LOAD_START",
  LOAD_SUCCESS: "LOAD_SUCCESS",
  LOAD_ERROR: "LOAD_ERROR",
  ADD_NODE: "ADD_NODE",
  RESET: "RESET",
});

// ---------------------------------------------------------------------------
// Pure reducer — no React, no network; unit-testable in Node
// ---------------------------------------------------------------------------

/**
 * @param {StoreState} state
 * @param {{ type: string, payload?: unknown }} action
 * @returns {StoreState}
 */
export function treeReducer(state, action) {
  switch (action.type) {
    case ACTIONS.LOAD_START:
      return { ...state, status: "loading", error: null };

    case ACTIONS.LOAD_SUCCESS: {
      const { tree } = action.payload;
      const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
      return { ...state, status: "ready", tree, nodes, error: null };
    }

    case ACTIONS.LOAD_ERROR:
      return { ...state, status: "error", error: action.payload ?? "Unknown error" };

    case ACTIONS.ADD_NODE:
      return { ...state, nodes: [...state.nodes, action.payload] };

    case ACTIONS.RESET:
      return { ...INITIAL_STATE };

    default:
      return state;
  }
}
