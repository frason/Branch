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

export default router;
