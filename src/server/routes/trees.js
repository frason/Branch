/**
 * src/server/routes/trees.js
 *
 * Express router for tree, branch, and node endpoints.
 *
 * Validation lives here; persistence goes through the repo layer.
 * NotFoundError -> 404, validation failures -> 400, unexpected -> next(err) -> 500.
 */

import { Router } from "express";
import { getRepo, NotFoundError } from "../repo/index.js";
import {
  createAdapter,
  GenerationError,
  validateSettings,
} from "../generation/index.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Wrap an async route handler so unhandled errors are forwarded to next().
 *
 * @param {(req, res, next) => Promise<void>} fn
 */
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ---------------------------------------------------------------------------
// POST /api/trees
// Body: { name: string, aspectRatio?: string, modelVersion?: string }
// Optionally creates a default branch when name is provided.
// ---------------------------------------------------------------------------
router.post(
  "/api/trees",
  asyncHandler(async (req, res) => {
    const { name, aspectRatio, modelVersion } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required and must be a non-empty string" });
    }

    const repo = getRepo();
    const tree = await repo.createTree({ name: name.trim() });

    // Create a default branch so every tree has at least one branch to attach nodes to.
    const branch = await repo.createBranch({
      treeId: tree.id,
      name: "main",
      aspectRatio: aspectRatio ?? null,
      modelVersion: modelVersion ?? null,
    });

    return res.status(201).json({ ...tree, branches: [branch], nodes: [] });
  })
);

// ---------------------------------------------------------------------------
// GET /api/trees
// ---------------------------------------------------------------------------
router.get(
  "/api/trees",
  asyncHandler(async (_req, res) => {
    const repo = getRepo();
    const trees = await repo.listTrees();
    return res.status(200).json(trees);
  })
);

// ---------------------------------------------------------------------------
// GET /api/trees/:id
// ---------------------------------------------------------------------------
router.get(
  "/api/trees/:id",
  asyncHandler(async (req, res, next) => {
    const repo = getRepo();
    try {
      const tree = await repo.getTree(req.params.id);
      return res.status(200).json(tree);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  })
);

// ---------------------------------------------------------------------------
// POST /api/trees/:treeId/nodes
// Body: { branchId, parentId?, prompt?, settings?, status? }
// ---------------------------------------------------------------------------
router.post(
  "/api/trees/:treeId/nodes",
  asyncHandler(async (req, res, next) => {
    const { treeId } = req.params;
    const { branchId, parentId, prompt, settings, status } = req.body ?? {};

    // branchId is required
    if (branchId == null || String(branchId).trim() === "") {
      return res.status(400).json({ error: "branchId is required" });
    }

    // status, if provided, must be a valid value
    const validStatuses = ["pending", "generating", "done", "failed"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const repo = getRepo();
    try {
      const node = await repo.createNode({
        treeId,
        branchId,
        parentId: parentId ?? null,
        prompt: prompt ?? null,
        settings: settings ?? {},
        status: status ?? "pending",
      });
      return res.status(201).json(node);
    } catch (err) {
      if (err instanceof NotFoundError) {
        // The tree is the URL resource -> 404 if it doesn't exist. A bad
        // branchId/parentId in the request body is a client validation
        // error -> 400. Discriminate on err.resource (rename-safe).
        if (err.resource === "tree") {
          return res.status(404).json({ error: err.message });
        }
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  })
);

// ---------------------------------------------------------------------------
// GET /api/nodes/:id
// ---------------------------------------------------------------------------
router.get(
  "/api/nodes/:id",
  asyncHandler(async (req, res, next) => {
    const repo = getRepo();
    try {
      const node = await repo.getNode(req.params.id);
      return res.status(200).json(node);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  })
);

// ---------------------------------------------------------------------------
// POST /api/trees/:treeId/generate
// Body: { branchId (required), prompt?, parentId?, settings? }
//
// BYOK proxy: the provider API key is read from a request header only —
// never from the body, query string, environment, or persistence layer.
//
// Key extraction (in priority order):
//   1. x-provider-key: <key>          (preferred — explicit and unambiguous)
//   2. Authorization: Bearer <key>    (fallback — strips the "Bearer " prefix)
//
// The key is held in memory for this request only and is NEVER:
//   - written to logs (the route never logs req.headers or the key)
//   - persisted to the database (not in the node, not in settings)
//   - included in any response body or error message
//
// Provider selection (in priority order):
//   1. x-provider header (per-request override)
//   2. GENERATION_PROVIDER env var (server default)
//   3. "mock" (hard fallback)
//
// Responses:
//   201 { node, cost }         — generation succeeded; node persisted
//   400 { error }              — validation failure or missing key for key-requiring provider
//   404 { error }              — treeId not found
//   502 { error, cost }        — generation failed (adapter error, auth failure, etc.)
//   500                        — unexpected error via next(err)
// ---------------------------------------------------------------------------
router.post(
  "/api/trees/:treeId/generate",
  asyncHandler(async (req, res, next) => {
    const { treeId } = req.params;
    const { branchId, parentId, prompt, settings } = req.body ?? {};

    // Validate branchId presence before touching the adapter.
    if (branchId == null || String(branchId).trim() === "") {
      return res.status(400).json({ error: "branchId is required" });
    }

    // ---------------------------------------------------------------------------
    // BYOK: extract the provider API key from headers only.
    // Never log, persist, or include the key in responses.
    // ---------------------------------------------------------------------------
    const providerKey = _extractProviderKey(req);

    // Provider: per-request override via x-provider header, or env default.
    // Pass undefined (not the header value) so createAdapter falls back to
    // GENERATION_PROVIDER env var when the header is absent.
    const providerOverride = req.headers["x-provider"] || undefined;

    const repo = getRepo();

    // Validate tree, branchId, and parentId before calling the adapter.
    // The repo exposes getTree which throws NotFoundError(resource='tree')
    // when the tree is missing. We inspect branches/nodes to validate the
    // rest, mirroring what createNode does internally.
    try {
      const tree = await repo.getTree(treeId);

      // branchId must belong to this tree
      const branchExists = tree.branches.some(
        (b) => String(b.id) === String(branchId)
      );
      if (!branchExists) {
        return res
          .status(400)
          .json({ error: `Branch ${branchId} does not belong to tree ${treeId}` });
      }

      // parentId (if given) must exist on this tree
      if (parentId != null) {
        const parentExists = tree.nodes.some(
          (n) => String(n.id) === String(parentId)
        );
        if (!parentExists) {
          return res
            .status(400)
            .json({ error: `Parent node ${parentId} does not exist on tree ${treeId}` });
        }
      }
    } catch (err) {
      if (err instanceof NotFoundError && err.resource === "tree") {
        return res.status(404).json({ error: err.message });
      }
      return next(err);
    }

    // All request validation passed — build the per-request adapter config.
    // apiKey is passed in-memory only; it is never persisted or logged here.
    // model comes from settings (the flux-fal adapter uses it to select the
    // fal endpoint); creditsPerImage stays at the adapter default.
    const adapterConfig = {
      // The per-request header key is primary. FAL_KEY (from .env via dotenv)
      // is a LOCAL-DEV fallback so a developer can test without sending a
      // header. Do NOT set FAL_KEY in production — otherwise the server would
      // pay for requests that didn't supply their own key (defeating BYOK).
      apiKey: providerKey ?? process.env.FAL_KEY,
      ...(settings?.model !== undefined && { model: settings.model }),
    };

    let adapter;
    try {
      adapter = createAdapter(providerOverride, adapterConfig);
    } catch (err) {
      // A bad client-supplied x-provider header is a 400, not a 500. (A bad
      // server-side GENERATION_PROVIDER default is a real misconfig → 500.)
      if (providerOverride) {
        return res
          .status(400)
          .json({ error: `Unknown generation provider: ${providerOverride}` });
      }
      return next(err);
    }

    // Validate and clean settings against this adapter's declared capabilities.
    // Unknown keys are dropped; out-of-range numerics are clamped; defaults
    // are applied for omitted controls. The original caller settings are
    // preserved for cost merging below — we generate with the cleaned copy.
    const rawSettings = settings ?? {};
    const { settings: cleanedSettings } = validateSettings(
      adapter.getCapabilities(),
      rawSettings
    );

    let result;
    try {
      result = await adapter.generate(
        { prompt: prompt ?? null, settings: cleanedSettings },
        { pollIntervalMs: 5 }
      );
    } catch (err) {
      if (err instanceof GenerationError) {
        // MISSING_KEY means the provider requires a key and none was given —
        // this is a client error (400), not a provider fault (502).
        if (err.code === "MISSING_KEY") {
          return res.status(400).json({ error: "API key required" });
        }
        // All other GenerationErrors (TIMEOUT, AUTH, PROVIDER_ERROR, etc.)
        // are surfaced as 502. Auth errors (wrong/expired key) are kept as a
        // generic message — never leak provider internals to the caller.
        console.error("[generate] GenerationError:", err.code, err.message);
        return res
          .status(502)
          .json({ error: "generation failed", cost: { credits: 0 } });
      }
      return next(err);
    }

    // Persist only on a successful terminal result. Any other terminal status
    // (failed / cancelled / unknown) is treated as a failure and NOT persisted.
    if (result.status !== "succeeded") {
      // Static message (consistent with the thrown-error path above) so no
      // provider-internal error strings are echoed to the caller.
      return res.status(502).json({
        error: "generation failed",
        cost: result.cost ?? { credits: 0 },
      });
    }

    // Generation succeeded — persist the node.
    // Merge cost into the original (pre-validation) caller settings so
    // provider-unknown keys like "style" are not silently stripped from the
    // persisted record. The API key is NOT included here.
    const mergedSettings = { ...(rawSettings), cost_credits: result.cost.credits };

    const node = await repo.createNode({
      treeId,
      branchId,
      parentId: parentId ?? null,
      prompt: prompt ?? null,
      assetUrl: result.assetUrl,
      settings: mergedSettings,
      status: "done",
    });

    return res.status(201).json({ node, cost: result.cost });
  })
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the provider API key from request headers.
 *
 * Priority:
 *   1. x-provider-key header           (preferred — explicit, no prefix to strip)
 *   2. Authorization: Bearer <key>     (fallback — strips the "Bearer " prefix)
 *
 * Returns undefined when no key is present (caller decides how to handle this;
 * the mock adapter works fine with no key, flux-fal will throw MISSING_KEY).
 *
 * Security contract:
 *   - The returned value is NEVER logged, persisted, or included in responses.
 *   - This function does not validate or inspect the key contents.
 *
 * @param {import('express').Request} req
 * @returns {string | undefined}
 */
function _extractProviderKey(req) {
  // Primary: x-provider-key header
  const explicit = req.headers["x-provider-key"];
  if (explicit && typeof explicit === "string" && explicit.trim() !== "") {
    return explicit.trim();
  }

  // Fallback: Authorization: Bearer <key>
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    const key = auth.slice("Bearer ".length).trim();
    if (key !== "") return key;
  }

  return undefined;
}

export default router;
