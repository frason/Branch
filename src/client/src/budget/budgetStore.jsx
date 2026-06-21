/**
 * budgetStore.jsx
 *
 * React context + provider for the client-side credit budget.
 *
 * Exposes:
 *   useBudgetStore()   — { events, spent, remaining, overBudget }
 *   useBudgetActions() — { recordSpend(credits) }
 *
 * Spend is accumulated locally in the browser session (page-refresh resets it).
 * Structure note: the pure math (computeBalance, computeVelocity) and the
 * reducer (budgetReducer) are imported from sibling modules so they can be
 * unit-tested without React.  A backend-authoritative ledger could replace the
 * reducer + recordSpend with server-fetched events while keeping the same hook
 * API — BudgetMeter.jsx would not need to change.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
} from "react";
import {
  budgetReducer,
  BUDGET_INITIAL_STATE,
  BUDGET_ACTIONS,
} from "./budgetReducer.js";
import { computeBalance, TOTAL_BUDGET } from "./velocity.js";

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const BudgetStateContext = createContext(null);
const BudgetDispatchContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wrap the app (or a subtree) with this provider.
 * @param {{ children: import('react').ReactNode }} props
 */
export function BudgetProvider({ children }) {
  const [state, dispatch] = useReducer(budgetReducer, BUDGET_INITIAL_STATE);

  // Derive balance synchronously so consumers don't have to recompute.
  const derived = useMemo(
    () => computeBalance(state.events, TOTAL_BUDGET),
    [state.events]
  );

  const value = useMemo(
    () => ({ events: state.events, ...derived }),
    [state.events, derived]
  );

  return (
    <BudgetStateContext.Provider value={value}>
      <BudgetDispatchContext.Provider value={dispatch}>
        {children}
      </BudgetDispatchContext.Provider>
    </BudgetStateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Read budget state.
 * @returns {{ events: Array<{ts:number,credits:number}>, spent: number, remaining: number, overBudget: boolean }}
 */
export function useBudgetStore() {
  const ctx = useContext(BudgetStateContext);
  if (ctx === null) {
    throw new Error("useBudgetStore must be used inside <BudgetProvider>");
  }
  return ctx;
}

function useBudgetDispatch() {
  const ctx = useContext(BudgetDispatchContext);
  if (ctx === null) {
    throw new Error("useBudgetDispatch must be used inside <BudgetProvider>");
  }
  return ctx;
}

/**
 * Returns stable action creators bound to the budget store's dispatch.
 *
 * recordSpend(credits) — stamps the event with Date.now() and appends it.
 *   Called from GeneratePanel after a successful generation.
 *   Failed generations (cost 0) should NOT be recorded (or caller passes 0,
 *   which is recorded but has no effect on balance — both approaches are fine;
 *   the current wiring skips the call entirely on failure).
 */
export function useBudgetActions() {
  const dispatch = useBudgetDispatch();

  const recordSpend = useCallback(
    (credits) => {
      // Guard against undefined/NaN reaching the store: a non-finite credit
      // would poison computeVelocity (NaN) on every later tick. Drop it.
      if (!Number.isFinite(credits) || credits <= 0) return;
      dispatch({
        type: BUDGET_ACTIONS.RECORD_SPEND,
        payload: { ts: Date.now(), credits },
      });
    },
    [dispatch]
  );

  return { recordSpend };
}
