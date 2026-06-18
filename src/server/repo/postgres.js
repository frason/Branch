/**
 * src/server/repo/postgres.js
 *
 * Postgres-backed repository implementation.
 * Selected automatically when DATABASE_URL is set (via getRepo() in index.js).
 *
 * All queries use parameterized placeholders ($1, $2, …) — no string
 * interpolation of user-supplied values.
 */

import pool from "../db/pool.js";
import { NotFoundError } from "./errors.js";

const VALID_STATUSES = ["pending", "generating", "done", "failed"];

export class PostgresRepo {
  constructor() {
    this._pool = pool;
  }

  // ---------------------------------------------------------------------------
  // Trees
  // ---------------------------------------------------------------------------

  /**
   * @param {{ name: string }} params
   * @returns {Promise<object>}
   */
  async createTree({ name }) {
    const { rows } = await this._pool.query(
      `INSERT INTO trees (name) VALUES ($1) RETURNING *`,
      [name]
    );
    return rows[0];
  }

  /**
   * Returns a tree with branches[] and nodes[] arrays.
   *
   * @param {string|number} id
   * @returns {Promise<object>}
   */
  async getTree(id) {
    const { rows: treeRows } = await this._pool.query(
      `SELECT * FROM trees WHERE id = $1`,
      [id]
    );
    if (treeRows.length === 0) {
      throw new NotFoundError(`Tree ${id} not found`, "tree");
    }
    const tree = treeRows[0];

    const { rows: branches } = await this._pool.query(
      `SELECT * FROM branches WHERE tree_id = $1 ORDER BY id`,
      [id]
    );

    const { rows: nodes } = await this._pool.query(
      `SELECT * FROM nodes WHERE tree_id = $1 ORDER BY id`,
      [id]
    );

    return { ...tree, branches, nodes };
  }

  /**
   * @returns {Promise<object[]>}
   */
  async listTrees() {
    const { rows } = await this._pool.query(
      `SELECT * FROM trees ORDER BY id`
    );
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Branches
  // ---------------------------------------------------------------------------

  /**
   * @param {{ treeId: string|number, name: string, aspectRatio?: string, modelVersion?: string }} params
   * @returns {Promise<object>}
   */
  async createBranch({ treeId, name, aspectRatio = null, modelVersion = null }) {
    // Verify tree exists
    const { rows: treeRows } = await this._pool.query(
      `SELECT id FROM trees WHERE id = $1`,
      [treeId]
    );
    if (treeRows.length === 0) {
      throw new NotFoundError(`Tree ${treeId} not found`, "tree");
    }

    const { rows } = await this._pool.query(
      `INSERT INTO branches (tree_id, name, aspect_ratio, model_version)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [treeId, name, aspectRatio, modelVersion]
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------------

  /**
   * @param {string|number} id
   * @returns {Promise<object>}
   */
  async getNode(id) {
    const { rows } = await this._pool.query(
      `SELECT * FROM nodes WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      throw new NotFoundError(`Node ${id} not found`, "node");
    }
    return rows[0];
  }

  /**
   * @param {{
   *   treeId: string|number,
   *   branchId: string|number,
   *   parentId?: string|number|null,
   *   prompt?: string|null,
   *   assetUrl?: string|null,
   *   settings?: object,
   *   status?: string
   * }} params
   * @returns {Promise<object>}
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
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(
        `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`
      );
    }

    // Verify tree exists
    const { rows: treeRows } = await this._pool.query(
      `SELECT id FROM trees WHERE id = $1`,
      [treeId]
    );
    if (treeRows.length === 0) {
      throw new NotFoundError(`Tree ${treeId} not found`, "tree");
    }

    // Verify branch belongs to tree
    const { rows: branchRows } = await this._pool.query(
      `SELECT id FROM branches WHERE id = $1 AND tree_id = $2`,
      [branchId, treeId]
    );
    if (branchRows.length === 0) {
      throw new NotFoundError(
        `Branch ${branchId} not found on tree ${treeId}`,
        "branch"
      );
    }

    // Verify parent node belongs to same tree (if provided)
    if (parentId != null) {
      const { rows: parentRows } = await this._pool.query(
        `SELECT id FROM nodes WHERE id = $1 AND tree_id = $2`,
        [parentId, treeId]
      );
      if (parentRows.length === 0) {
        throw new NotFoundError(
          `Parent node ${parentId} not found on tree ${treeId}`,
          "parent"
        );
      }
    }

    const { rows } = await this._pool.query(
      `INSERT INTO nodes (tree_id, branch_id, parent_id, prompt, asset_url, settings, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      // Pass the settings object as-is: node-postgres serializes JS objects to
      // JSONB. Pre-stringifying would store a quoted JSON *string*, not an object.
      [treeId, branchId, parentId ?? null, prompt, assetUrl, settings ?? {}, status]
    );
    return rows[0];
  }
}
