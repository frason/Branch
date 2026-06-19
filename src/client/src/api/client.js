/**
 * client.js
 *
 * Typed (JSDoc) API module wrapping the Branch REST endpoints.
 *
 * Base URL is read from the Vite env variable VITE_API_BASE; if that is
 * absent (e.g. in unit tests) it falls back to http://localhost:3000.
 *
 * All network / JSON logic lives here.  Callers receive plain data objects
 * or a thrown Error with a `.status` property and the server's error message.
 *
 * Pure helpers (buildUrl, extractError) are exported separately so they can
 * be unit-tested without a real fetch or server.
 */

// ---------------------------------------------------------------------------
// Pure helpers — testable without fetch / network
// ---------------------------------------------------------------------------

/**
 * Build a full URL by joining a base URL and a path segment.
 * Handles trailing slashes on base and leading slashes on path.
 *
 * @param {string} base  e.g. "http://localhost:3000"
 * @param {string} path  e.g. "/api/trees"
 * @returns {string}
 */
export function buildUrl(base, path) {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Extract a user-facing error message from a non-2xx response body.
 * The server returns `{ error: "..." }` on failures.
 *
 * @param {number} status    HTTP status code
 * @param {unknown} body     Parsed JSON body (or null if parsing failed)
 * @returns {string}
 */
export function extractError(status, body) {
  if (body && typeof body === "object" && typeof body.error === "string") {
    return body.error;
  }
  return `Request failed with status ${status}`;
}

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------

const API_BASE =
  // Vite replaces import.meta.env at build time; guard for Node test env.
  // Default to a RELATIVE base ("") so requests go to the app's own origin
  // and are forwarded by the Vite dev proxy (see vite.config.js) — no CORS
  // needed. Set VITE_API_BASE to an absolute URL to target a remote backend
  // directly (which then requires CORS on that backend).
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE) ||
  "";

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<unknown>}
 */
async function request(path, init = {}) {
  const url = buildUrl(API_BASE, path);

  let response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...init.headers },
      ...init,
    });
  } catch (networkErr) {
    const err = new Error(`Network error reaching ${url}: ${networkErr.message}`);
    err.status = 0;
    throw err;
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body — extractError will fall back to status text
  }

  if (!response.ok) {
    const msg = extractError(response.status, body);
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }

  return body;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, name: string, created_at: string, updated_at: string,
 *             branches: Branch[], nodes: Node[] }} Tree
 * @typedef {{ id: string, tree_id: string, name: string, aspect_ratio: string,
 *             model_version: string, created_at: string }} Branch
 * @typedef {{ id: string, tree_id: string, branch_id: string,
 *             parent_id: string|null, prompt: string|null, asset_url: string|null,
 *             settings: object|null, status: string, created_at: string }} Node
 */

/**
 * Create a new tree (with a default branch).
 *
 * @param {{ name?: string, aspectRatio?: string, modelVersion?: string }} [opts]
 * @returns {Promise<Tree>}
 */
export async function createTree(
  { name = "My Tree", aspectRatio, modelVersion } = {},
  { signal } = {}
) {
  // Body keys are camelCase to match what the backend routes read.
  const body = { name };
  if (aspectRatio !== undefined) body.aspectRatio = aspectRatio;
  if (modelVersion !== undefined) body.modelVersion = modelVersion;
  return request("/api/trees", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * List all trees (bare — no branches/nodes).
 *
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<Tree[]>}
 */
export async function listTrees({ signal } = {}) {
  return request("/api/trees", { signal });
}

/**
 * Fetch a single tree with its branches and nodes.
 *
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<Tree>}
 */
export async function getTree(id, { signal } = {}) {
  return request(`/api/trees/${encodeURIComponent(id)}`, { signal });
}

/**
 * Create a node under a tree.
 *
 * @param {string} treeId
 * @param {{ branchId: string, parentId?: string|null, prompt?: string,
 *           settings?: object, status?: string }} opts
 * @param {{ signal?: AbortSignal }} [reqOpts]
 * @returns {Promise<Node>}
 */
export async function createNode(
  treeId,
  { branchId, parentId, prompt, settings, status },
  { signal } = {}
) {
  // Body keys are camelCase to match what the backend routes read.
  const body = { branchId };
  if (parentId !== undefined) body.parentId = parentId;
  if (prompt !== undefined) body.prompt = prompt;
  if (settings !== undefined) body.settings = settings;
  if (status !== undefined) body.status = status;
  return request(`/api/trees/${encodeURIComponent(treeId)}/nodes`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Fetch a single node by ID.
 *
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<Node>}
 */
export async function getNode(id, { signal } = {}) {
  return request(`/api/nodes/${encodeURIComponent(id)}`, { signal });
}

/**
 * Trigger generation for a tree node via the mock adapter.
 *
 * On success returns { node, cost: { credits, currency } }.
 * On failure (including 502 from the adapter) the shared request() wrapper
 * throws an Error with .status and the server's error message — callers
 * should catch and display that message.
 *
 * @param {string} treeId
 * @param {{ branchId: string, prompt?: string, parentId?: string|null,
 *           settings?: object }} opts
 * @param {{ signal?: AbortSignal }} [reqOpts]
 * @returns {Promise<{ node: Node, cost: { credits: number, currency: string } }>}
 */
export async function generate(
  treeId,
  { branchId, prompt, parentId, settings },
  { signal } = {}
) {
  const body = { branchId };
  if (prompt !== undefined) body.prompt = prompt;
  if (parentId !== undefined) body.parentId = parentId;
  if (settings !== undefined) body.settings = settings;
  return request(`/api/trees/${encodeURIComponent(treeId)}/generate`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}
