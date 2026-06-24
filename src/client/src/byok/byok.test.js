/**
 * byok.test.js
 *
 * Headless unit tests for BYOK pure helpers and keyStore logic.
 * No DOM, no browser, no real localStorage, no network, no real key.
 *
 * Covers:
 *   - maskKey (correct masking, edge cases)
 *   - looksLikeFalKey (accepts plausible keys, rejects bad ones)
 *   - buildProviderKeyHeaders (sets x-provider-key when present, omits when absent)
 *   - keyStore get/set/clear/subscribe (via injected stub storage)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { maskKey, looksLikeFalKey, buildProviderKeyHeaders } from "./keyHelpers.js";
import {
  getKey,
  setKey,
  clearKey,
  subscribe,
  _setStorage,
  STORAGE_KEY,
} from "./keyStore.js";

// ---------------------------------------------------------------------------
// maskKey
// ---------------------------------------------------------------------------

describe("maskKey", () => {
  it("masks a typical fal.ai key_id:key_secret format", () => {
    const result = maskKey("myKeyId:secretValueHere");
    // prefix = "myKeyId", last 4 chars of "secretValueHere" = "Here"
    expect(result).toBe("myKeyId…Here");
  });

  it("shows the id segment before the colon as the prefix", () => {
    const result = maskKey("abc123:xyz9876");
    expect(result).toBe("abc123…9876");
  });

  it("uses last 4 characters as the suffix", () => {
    const result = maskKey("prefix:abcdefgh1234");
    expect(result).toBe("prefix…1234");
  });

  it("falls back gracefully for a key with no colon", () => {
    const result = maskKey("abcdefgh1234");
    // Should show a short prefix + ellipsis + last 4
    expect(result).toMatch(/^.{2,4}….{4}$/);
    expect(result).toContain("1234");
  });

  it("returns empty string for empty input", () => {
    expect(maskKey("")).toBe("");
  });

  it("returns empty string for null input", () => {
    expect(maskKey(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(maskKey(undefined)).toBe("");
  });

  it("trims whitespace before masking", () => {
    // trim → "myId:secretVal", prefix = "myId", last4 of "secretVal" = "tVal"
    expect(maskKey("  myId:secretVal  ")).toBe("myId…tVal");
  });

  it("handles a very short key gracefully (no colon, too short for last4)", () => {
    // 3-char key: fallback prefix can't be 4, last4 would overlap
    const result = maskKey("abc");
    expect(typeof result).toBe("string");
    // Should not throw and should contain something
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// looksLikeFalKey
// ---------------------------------------------------------------------------

describe("looksLikeFalKey", () => {
  it("accepts a plausible fal.ai key (id:secret format, >= 10 chars)", () => {
    expect(looksLikeFalKey("abc123def:ghijklmnop")).toBe(true);
  });

  it("accepts a minimal-length key with colon", () => {
    // exactly 10 chars with a colon
    expect(looksLikeFalKey("abc:defghi")).toBe(true);
  });

  it("accepts a realistic long fal.ai key", () => {
    expect(
      looksLikeFalKey("a1b2c3d4-e5f6:g7h8i9j0k1l2m3n4o5p6q7r8s9t0")
    ).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(looksLikeFalKey("")).toBe(false);
  });

  it("rejects null", () => {
    expect(looksLikeFalKey(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(looksLikeFalKey(undefined)).toBe(false);
  });

  it("rejects a key that is too short (< 10 chars) even with a colon", () => {
    expect(looksLikeFalKey("ab:cd")).toBe(false);
  });

  it("rejects a key with no colon", () => {
    expect(looksLikeFalKey("abcdefghijklmnop")).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(looksLikeFalKey(12345)).toBe(false);
    expect(looksLikeFalKey({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildProviderKeyHeaders
// ---------------------------------------------------------------------------

describe("buildProviderKeyHeaders", () => {
  it("sets x-provider-key when apiKey is a non-empty string", () => {
    const headers = buildProviderKeyHeaders("myid:mysecret");
    expect(headers).toEqual({ "x-provider-key": "myid:mysecret" });
  });

  it("trims whitespace from the key", () => {
    const headers = buildProviderKeyHeaders("  myid:mysecret  ");
    expect(headers).toEqual({ "x-provider-key": "myid:mysecret" });
  });

  it("returns an empty object when apiKey is undefined", () => {
    expect(buildProviderKeyHeaders(undefined)).toEqual({});
  });

  it("returns an empty object when apiKey is null", () => {
    expect(buildProviderKeyHeaders(null)).toEqual({});
  });

  it("returns an empty object when apiKey is an empty string", () => {
    expect(buildProviderKeyHeaders("")).toEqual({});
  });

  it("returns an empty object when apiKey is only whitespace", () => {
    expect(buildProviderKeyHeaders("   ")).toEqual({});
  });

  it("returns an empty object when apiKey is a non-string (number)", () => {
    expect(buildProviderKeyHeaders(12345)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// keyStore — injected stub storage (no real browser/DOM)
// ---------------------------------------------------------------------------

/**
 * Build a minimal in-memory storage stub that satisfies the keyStore contract.
 * This is a fresh Map per test so tests don't share state.
 */
function makeStubStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    // Expose map for assertions
    _map: map,
  };
}

describe("keyStore", () => {
  let storage;

  beforeEach(() => {
    // Inject a fresh stub storage before each test so tests are isolated.
    storage = makeStubStorage();
    _setStorage(storage);
    // Also clear any stored key from a previous test run.
    storage.removeItem(STORAGE_KEY);
  });

  it("getKey() returns empty string when no key is stored", () => {
    expect(getKey()).toBe("");
  });

  it("setKey() persists the key to storage", () => {
    setKey("myid:mysecret");
    expect(storage._map.get(STORAGE_KEY)).toBe("myid:mysecret");
  });

  it("getKey() returns the stored key after setKey()", () => {
    setKey("myid:mysecret");
    expect(getKey()).toBe("myid:mysecret");
  });

  it("setKey() trims whitespace before storing", () => {
    setKey("  myid:mysecret  ");
    expect(getKey()).toBe("myid:mysecret");
  });

  it("setKey() with an empty string calls clearKey() — removes the entry", () => {
    setKey("myid:mysecret");
    setKey("");
    expect(getKey()).toBe("");
    expect(storage._map.has(STORAGE_KEY)).toBe(false);
  });

  it("clearKey() removes the stored key", () => {
    setKey("myid:mysecret");
    clearKey();
    expect(getKey()).toBe("");
    expect(storage._map.has(STORAGE_KEY)).toBe(false);
  });

  it("subscribe() listener is called when setKey() fires", () => {
    let calls = 0;
    const unsub = subscribe(() => { calls++; });
    setKey("myid:mysecret");
    expect(calls).toBe(1);
    unsub();
  });

  it("subscribe() listener is called when clearKey() fires", () => {
    let calls = 0;
    setKey("myid:mysecret");
    const unsub = subscribe(() => { calls++; });
    clearKey();
    expect(calls).toBe(1);
    unsub();
  });

  it("unsubscribe() stops further notifications", () => {
    let calls = 0;
    const unsub = subscribe(() => { calls++; });
    setKey("myid:mysecret");
    unsub();
    clearKey();
    // Only the first setKey should have incremented calls.
    expect(calls).toBe(1);
  });

  it("multiple subscribers are all notified", () => {
    let a = 0, b = 0;
    const unsubA = subscribe(() => { a++; });
    const unsubB = subscribe(() => { b++; });
    setKey("myid:mysecret");
    expect(a).toBe(1);
    expect(b).toBe(1);
    unsubA();
    unsubB();
  });

  it("can overwrite an existing key with a new one", () => {
    setKey("first:key1234");
    setKey("second:key5678");
    expect(getKey()).toBe("second:key5678");
  });
});
