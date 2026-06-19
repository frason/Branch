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
import { createAdapter, GenerationError } from "../generation/index.js";

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
// Validates the request (tree exists, branchId present + belongs to tree,
// parentId exists if provided), calls the generation adapter, and on success
// persists a node with status='done', assetUrl, and cost merged into settings.
//
// Responses:
//   201 { node, cost }         — generation succeeded; node persisted
//   400 { error }              — validation failure (missing/bad branchId, parentId)
//   404 { error }              — treeId not found
//   502 { error, cost }        — generation failed (adapter returned status:'failed')
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

    const repo = getRepo();

    // Run a dry-run createNode to validate treeId, branchId, and parentId.
    // We piggy-back on the existing repo validation rather than duplicating it.
    // We'll do this by attempting a real createNode later on success, so for
    // now validate via getTree / branch membership up front.
    //
    // The simplest approach: attempt the real createNode at the end (on success)
    // and let repo validation errors surface naturally.  For the failure path we
    // still need to validate BEFORE calling the adapter so validation errors
    // take precedence.  We'll do a lightweight probe: call createNode with a
    // sentinel, catch validation errors, then roll it back... but MemoryRepo has
    // no transactions.
    //
    // Better: the repo exposes getTree which throws NotFoundError(resource='tree')
    // when the tree is missing.  Then we inspect the tree's branches to validate
    // branchId, and nodes to validate parentId.  This mirrors what createNode
    // does internally and avoids touching the adapter for invalid input.

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

    // All validation passed — call the adapter.
    const adapter = createAdapter();
    let result;
    try {
      result = await adapter.generate(
        { prompt: prompt ?? null, settings: settings ?? {} },
        { pollIntervalMs: 5 }
      );
    } catch (err) {
      // The adapter can THROW (e.g. GenerationError on timeout) rather than
      // returning a 'failed' result. Surface that as a 502 generation failure,
      // not an unhandled 500. Unexpected non-adapter errors still bubble to 500.
      if (err instanceof GenerationError) {
        return res
          .status(502)
          .json({ error: err.message ?? "generation failed", cost: { credits: 0 } });
      }
      return next(err);
    }

    // Persist only on a successful terminal result. Any other terminal status
    // (failed / cancelled / unknown) is treated as a failure and NOT persisted.
    if (result.status !== "succeeded") {
      return res.status(502).json({
        error: result.error?.message ?? `generation ${result.status}`,
        cost: result.cost ?? { credits: 0 },
      });
    }

    // Generation succeeded — persist the node.
    const mergedSettings = { ...(settings ?? {}), cost_credits: result.cost.credits };

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

export default router;
