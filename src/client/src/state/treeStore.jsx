/**
 * treeStore.js
 *
 * Lightweight React-context-based state store for the current tree + nodes.
 *
 * Shape:
 *   { tree: Tree|null, nodes: Node[], status: 'idle'|'loading'|'ready'|'error', error: string|null }
 *
 * The REDUCER is a pure function exported for unit tests — it has no React or
 * network dependencies.
 *
 * React bindings (context, provider, hooks) are exported separately.
 * BabylonCanvas reads nodes via useTreeStore(); App wraps the tree with
 * <TreeProvider> and calls loadOrCreateTree() on mount.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from "react";
import { listTrees, getTree, createTree } from "../api/client.js";

// Pure reducer + constants live in treeReducer.js (no React, unit-testable).
// Re-export them here so callers can import from one place.
export { treeReducer, INITIAL_STATE, ACTIONS } from "./treeReducer.js";
import { treeReducer, INITIAL_STATE, ACTIONS } from "./treeReducer.js";

// ---------------------------------------------------------------------------
// React context
// ---------------------------------------------------------------------------

const TreeStateContext = createContext(null);
const TreeDispatchContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wrap the app (or a subtree) with this provider to give descendants access
 * to the tree store via useTreeStore() and useTreeDispatch().
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function TreeProvider({ children }) {
  const [state, dispatch] = useReducer(treeReducer, INITIAL_STATE);

  return (
    <TreeStateContext.Provider value={state}>
      <TreeDispatchContext.Provider value={dispatch}>
        {children}
      </TreeDispatchContext.Provider>
    </TreeStateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Read the current tree store state.
 * @returns {StoreState}
 */
export function useTreeStore() {
  const ctx = useContext(TreeStateContext);
  if (ctx === null) {
    throw new Error("useTreeStore must be used inside <TreeProvider>");
  }
  return ctx;
}

/**
 * Returns the raw dispatch function (useful for advanced callers).
 * Most callers should prefer useTreeActions().
 */
export function useTreeDispatch() {
  const ctx = useContext(TreeDispatchContext);
  if (ctx === null) {
    throw new Error("useTreeDispatch must be used inside <TreeProvider>");
  }
  return ctx;
}

/**
 * Returns stable action creators bound to the store's dispatch.
 *
 * loadOrCreateTree() — on startup:
 *   1. GET /api/trees
 *   2. If any exist, GET /api/trees/:id for the first one (with nodes).
 *   3. Otherwise POST /api/trees to bootstrap one.
 *   Degrades gracefully: on network error the store goes to 'error' status
 *   and the canvas falls back to the placeholder node.
 *
 * addNode(node) — append a node to the local nodes list (used by Generate
 * flow after a successful POST /api/trees/:id/nodes).
 */
export function useTreeActions() {
  const dispatch = useTreeDispatch();

  /**
   * Startup load. Accepts an AbortSignal so the caller (a useEffect) can
   * cancel this specific invocation on cleanup. This is what makes the call
   * safe under React StrictMode's mount→cleanup→remount double-invoke: the
   * first invocation's signal is aborted, so its in-flight fetch is cancelled
   * and its late dispatches are suppressed — the two runs can't race or
   * clobber each other.
   *
   * @param {AbortSignal} [signal]
   */
  const loadOrCreateTree = useCallback(
    async (signal) => {
      dispatch({ type: ACTIONS.LOAD_START });
      try {
        const trees = await listTrees({ signal });
        if (signal?.aborted) return;
        let tree;
        if (trees.length > 0) {
          tree = await getTree(trees[0].id, { signal });
        } else {
          tree = await createTree({ name: "My Tree" }, { signal });
        }
        if (signal?.aborted) return;
        dispatch({ type: ACTIONS.LOAD_SUCCESS, payload: { tree } });
      } catch (err) {
        if (signal?.aborted) return; // aborted invocation — ignore
        dispatch({
          type: ACTIONS.LOAD_ERROR,
          payload: err.message ?? "Failed to load tree",
        });
      }
    },
    [dispatch]
  );

  // addNode is driven by synchronous user actions (the Generate flow), not
  // startup races, so it dispatches directly.
  const addNode = useCallback(
    (node) => {
      dispatch({ type: ACTIONS.ADD_NODE, payload: node });
    },
    [dispatch]
  );

  return { loadOrCreateTree, addNode };
}
