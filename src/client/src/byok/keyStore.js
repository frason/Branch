/**
 * keyStore.js
 *
 * Tiny observable store for the user's fal.ai API key.
 *
 * The key is persisted in localStorage under STORAGE_KEY so it survives page
 * refreshes.  It is NEVER sent to any third party — only forwarded to
 * Branch's own backend proxy as the `x-provider-key` request header.
 *
 * API
 * ---
 *   getKey()              — returns the stored key string, or "" if none
 *   setKey(key)           — persist key to localStorage + notify subscribers
 *   clearKey()            — remove key from localStorage + notify subscribers
 *   subscribe(listener)   — register a callback; returns an unsubscribe fn
 *
 * React integration
 * -----------------
 * Use with useSyncExternalStore (React 18+):
 *
 *   import { useSyncExternalStore } from "react";
 *   import { getKey, subscribe } from "./keyStore.js";
 *
 *   function useApiKey() {
 *     return useSyncExternalStore(subscribe, getKey);
 *   }
 *
 * The store is a plain module singleton — no React context needed, which keeps
 * it testable in Node without any DOM or React setup.
 */

export const STORAGE_KEY = "branch.falKey";

// In-memory listeners set for the useSyncExternalStore subscribe contract.
/** @type {Set<() => void>} */
const listeners = new Set();

// ---------------------------------------------------------------------------
// Internal helpers — injectable for testing
// ---------------------------------------------------------------------------

/**
 * The storage backend.  Defaults to window.localStorage in the browser.
 * Tests can call _setStorage(fakeStorage) to inject a stub without touching
 * a real DOM.
 *
 * @type {{ getItem(k:string): string|null, setItem(k:string,v:string): void, removeItem(k:string): void }}
 */
let _storage =
  typeof window !== "undefined" && window.localStorage
    ? window.localStorage
    : _makeMemoryStorage();

/** @private — for unit tests only */
export function _setStorage(storage) {
  _storage = storage;
}

/** Fallback no-op memory storage for SSR / test environments without a DOM. */
function _makeMemoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the currently stored key, or "" if none is set.
 * @returns {string}
 */
export function getKey() {
  return _storage.getItem(STORAGE_KEY) ?? "";
}

/**
 * Persist a key to storage and notify all subscribers.
 * Passing an empty string is equivalent to clearKey().
 *
 * @param {string} key
 */
export function setKey(key) {
  if (!key || key.trim().length === 0) {
    clearKey();
    return;
  }
  _storage.setItem(STORAGE_KEY, key.trim());
  _notify();
}

/**
 * Remove the stored key and notify all subscribers.
 */
export function clearKey() {
  _storage.removeItem(STORAGE_KEY);
  _notify();
}

/**
 * Subscribe to store changes.  The listener is called synchronously whenever
 * the key is set or cleared.  Returns an unsubscribe function.
 *
 * This signature is compatible with React 18's useSyncExternalStore.
 *
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _notify() {
  for (const listener of listeners) {
    listener();
  }
}
