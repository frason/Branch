/**
 * src/server/repo/memory.js
 *
 * In-memory repository implementation.
 * Used for local development and tests — no database required.
 *
 * All IDs are incrementing integers (as strings) to match the bigserial
 * style used by the Postgres schema.
 */

import { NotFoundError } from "./errors.js";

export class MemoryRepo {
  constructor() {
    /** @type {Map<string, object>} */
    this._trees = new Map();
    /** @type {Map<string, object>} */
    this._branches = new Map();
    /** @type {Map<string, object>} */
    this._nodes = new Map();
    this._nextId = 1;
  }

  _id() {
    return String(this._nextId++);
  }

  // ---------------------------------------------------------------------------
  // Trees
  // ---------------------------------------------------------------------------

  /**
   * Create a new tree.
   *
   * @param {{ name: string }} params
   * @returns {Promise<object>} tree row
   */
  async createTree({ name }) {
    const now = new Date().toISOString();
    const tree = {
      id: this._id(),
      name,
      created_at: now,
      updated_at: now,
    };
    this._trees.set(tree.id, tree);
    return { ...tree };
  }

  /**
   * Get a tree with its branches and nodes.
   *
   * @param {string|number} id
   * @returns {Promise<object>} tree with branches[] and nodes[]
   */
  async getTree(id) {
    const key = String(id);
    const tree = this._trees.get(key);
    if (!tree) {
      throw new NotFoundError(`Tree ${id} not found`, "tree");
    }

    const branches = [...this._branches.values()].filter(
      (b) => b.tree_id === key
    );
    const nodes = [...this._nodes.values()].filter((n) => n.tree_id === key);

    return { ...tree, branches, nodes };
  }

  /**
   * List all trees (without branches/nodes).
   *
   * @returns {Promise<object[]>}
   */
  async listTrees() {
    return [...this._trees.values()].map((t) => ({ ...t }));
  }

  // ---------------------------------------------------------------------------
  // Branches
  // ---------------------------------------------------------------------------

  /**
   * Create a branch belonging to a tree.
   *
   * @param {{ treeId: string|number, name: string, aspectRatio?: string, modelVersion?: string }} params
   * @returns {Promise<object>} branch row
   */
  async createBranch({ treeId, name, aspectRatio = null, modelVersion = null }) {
    const key = String(treeId);
    if (!this._trees.has(key)) {
      throw new NotFoundError(`Tree ${treeId} not found`, "tree");
    }

    const branch = {
      id: this._id(),
      tree_id: key,
      name,
      aspect_ratio: aspectRatio,
      model_version: modelVersion,
      created_at: new Date().toISOString(),
    };
    this._branches.set(branch.id, branch);
    return { ...branch };
  }

  // ---------------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------------

  /**
   * Get a single node by id.
   *
   * @param {string|number} id
   * @returns {Promise<object>} node row
   */
  async getNode(id) {
    const node = this._nodes.get(String(id));
    if (!node) {
      throw new NotFoundError(`Node ${id} not found`, "node");
    }
    return { ...node };
  }

  /**
   * Create a node.
   *
   * @param {{
   *   treeId: string|number,
   *   branchId: string|number,
   *   parentId?: string|number|null,
   *   prompt?: string|null,
   *   assetUrl?: string|null,
   *   settings?: object,
   *   status?: string
   * }} params
   * @returns {Promise<object>} node row
   */
  async createNode({
    treeId,
    branchId,
    parentId = null,
    prompt = null,
    assetUrl = null,
    settings = {},
    status = "pending",
  }) {
    const treeKey = String(treeId);
    const branchKey = String(branchId);

    if (!this._trees.has(treeKey)) {
      throw new NotFoundError(`Tree ${treeId} not found`, "tree");
    }

    const branch = this._branches.get(branchKey);
    if (!branch || branch.tree_id !== treeKey) {
      throw new NotFoundError(
        `Branch ${branchId} not found on tree ${treeId}`,
        "branch"
      );
    }

    if (parentId != null) {
      const parent = this._nodes.get(String(parentId));
      if (!parent || parent.tree_id !== treeKey) {
        throw new NotFoundError(
          `Parent node ${parentId} not found on tree ${treeId}`,
          "parent"
        );
      }
    }

    const validStatuses = ["pending", "generating", "done", "failed"];
    if (!validStatuses.includes(status)) {
      throw new Error(
        `Invalid status "${status}". Must be one of: ${validStatuses.join(", ")}`
      );
    }

    const node = {
      id: this._id(),
      tree_id: treeKey,
      branch_id: branchKey,
      parent_id: parentId != null ? String(parentId) : null,
      prompt,
      asset_url: assetUrl,
      settings,
      status,
      created_at: new Date().toISOString(),
    };
    this._nodes.set(node.id, node);
    return { ...node };
  }
}
