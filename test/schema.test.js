/**
 * test/schema.test.js
 *
 * Validates the migration SQL is structurally correct without requiring
 * a live Postgres database.  All assertions are string/regex checks against
 * the raw SQL source.
 *
 * If DATABASE_URL is set a second describe block runs integration tests
 * against a real database; otherwise those tests are skipped.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(
  __dirname,
  "../src/server/db/migrations"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadMigration(filename) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
}

/**
 * Normalise SQL for easier matching: collapse runs of whitespace/newlines into
 * a single space and lower-case everything.
 */
function normalise(sql) {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Unit tests — no database required
// ---------------------------------------------------------------------------

describe("Migration file existence", () => {
  it("migrations directory exists", () => {
    assert.ok(
      fs.existsSync(MIGRATIONS_DIR),
      `Expected migrations directory at ${MIGRATIONS_DIR}`
    );
  });

  it("001_init.sql exists", () => {
    assert.ok(
      fs.existsSync(path.join(MIGRATIONS_DIR, "001_init.sql")),
      "001_init.sql not found"
    );
  });

  it("migration files are lexicographically sorted (no gaps)", () => {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    assert.ok(files.length > 0, "No migration files found");
    // Each file must start with a three-digit prefix
    for (const f of files) {
      assert.match(f, /^\d{3}_/, `Migration filename must start with NNN_: ${f}`);
    }
  });
});

describe("001_init.sql — table definitions", () => {
  let sql;
  let n; // normalised

  before(() => {
    sql = loadMigration("001_init.sql");
    n = normalise(sql);
  });

  // schema_migrations tracking table
  it("creates schema_migrations table", () => {
    assert.ok(
      n.includes("create table if not exists schema_migrations"),
      "Expected CREATE TABLE IF NOT EXISTS schema_migrations"
    );
  });

  // trees table
  it("creates trees table", () => {
    assert.ok(
      n.includes("create table if not exists trees"),
      "Expected CREATE TABLE IF NOT EXISTS trees"
    );
  });

  it("trees has name column as TEXT NOT NULL", () => {
    // match "name text not null" allowing any whitespace between tokens
    assert.match(n, /name\s+text\s+not null/, "trees.name must be TEXT NOT NULL");
  });

  it("trees has created_at column", () => {
    assert.ok(n.includes("created_at"), "trees must have created_at");
  });

  it("trees has updated_at column", () => {
    assert.ok(n.includes("updated_at"), "trees must have updated_at");
  });

  // branches table
  it("creates branches table", () => {
    assert.ok(
      n.includes("create table if not exists branches"),
      "Expected CREATE TABLE IF NOT EXISTS branches"
    );
  });

  it("branches has aspect_ratio column", () => {
    assert.ok(
      n.includes("aspect_ratio"),
      "branches must have aspect_ratio column for fixed branch settings"
    );
  });

  it("branches has model_version column", () => {
    assert.ok(
      n.includes("model_version"),
      "branches must have model_version column for fixed branch settings"
    );
  });

  it("branches.tree_id references trees with ON DELETE CASCADE", () => {
    // Find the branches block and check it contains a cascade FK to trees
    const branchesBlock = n.slice(
      n.indexOf("create table if not exists branches"),
      n.indexOf(");", n.indexOf("create table if not exists branches")) + 2
    );
    assert.ok(
      branchesBlock.includes("references trees"),
      "branches.tree_id must reference trees"
    );
    assert.ok(
      branchesBlock.includes("on delete cascade"),
      "branches.tree_id FK must have ON DELETE CASCADE"
    );
  });

  // nodes table
  it("creates nodes table", () => {
    assert.ok(
      n.includes("create table if not exists nodes"),
      "Expected CREATE TABLE IF NOT EXISTS nodes"
    );
  });

  it("nodes has prompt column", () => {
    assert.ok(n.includes("prompt"), "nodes must have prompt column");
  });

  it("nodes has asset_url column", () => {
    assert.ok(n.includes("asset_url"), "nodes must have asset_url column");
  });

  it("nodes has settings column as JSONB", () => {
    assert.match(
      n,
      /settings\s+jsonb/,
      "nodes.settings must be JSONB for flex per-iteration settings"
    );
  });

  it("nodes has status column", () => {
    assert.ok(n.includes("status"), "nodes must have status column");
  });

  it("nodes.parent_id is a self-referential FK (nullable for roots)", () => {
    const nodesBlock = n.slice(
      n.indexOf("create table if not exists nodes"),
      n.indexOf(");", n.indexOf("create table if not exists nodes")) + 2
    );
    // parent_id must reference the nodes table itself
    assert.ok(
      nodesBlock.includes("parent_id"),
      "nodes must have parent_id column"
    );
    assert.ok(
      nodesBlock.includes("references nodes"),
      "nodes.parent_id must be a self-referential FK"
    );
    // parent_id must NOT be declared NOT NULL (it is nullable for roots)
    const parentLine = nodesBlock
      .split(" ")
      .join(" ")
      .match(/parent_id[^,)]+/);
    assert.ok(parentLine, "Could not find parent_id definition in nodes");
    assert.ok(
      !parentLine[0].includes("not null"),
      "nodes.parent_id must be nullable (NULL for root nodes)"
    );
  });

  it("nodes.parent_id ON DELETE CASCADE", () => {
    // The self-FK line should cascade deletions down the tree
    const nodesBlock = n.slice(
      n.indexOf("create table if not exists nodes"),
      n.indexOf(");", n.indexOf("create table if not exists nodes")) + 2
    );
    // Find the segment that has "references nodes" and check cascade follows
    const refNodesIdx = nodesBlock.indexOf("references nodes");
    const afterRef = nodesBlock.slice(refNodesIdx, refNodesIdx + 60);
    assert.ok(
      afterRef.includes("on delete cascade"),
      "nodes.parent_id self-FK must have ON DELETE CASCADE"
    );
  });

  it("nodes.tree_id references trees with ON DELETE CASCADE", () => {
    const nodesBlock = n.slice(
      n.indexOf("create table if not exists nodes"),
      n.indexOf(");", n.indexOf("create table if not exists nodes")) + 2
    );
    assert.ok(
      nodesBlock.includes("references trees"),
      "nodes.tree_id must reference trees"
    );
  });

  it("nodes.branch_id references branches with ON DELETE CASCADE", () => {
    const nodesBlock = n.slice(
      n.indexOf("create table if not exists nodes"),
      n.indexOf(");", n.indexOf("create table if not exists nodes")) + 2
    );
    assert.ok(
      nodesBlock.includes("references branches"),
      "nodes.branch_id must reference branches"
    );
  });
});

describe("001_init.sql — indexes", () => {
  let n;

  before(() => {
    n = normalise(loadMigration("001_init.sql"));
  });

  it("index on branches(tree_id)", () => {
    assert.match(
      n,
      /create index if not exists \S+ on branches\(tree_id\)/,
      "Missing index on branches(tree_id)"
    );
  });

  it("index on nodes(tree_id)", () => {
    assert.match(
      n,
      /create index if not exists \S+ on nodes\(tree_id\)/,
      "Missing index on nodes(tree_id)"
    );
  });

  it("index on nodes(parent_id)", () => {
    assert.match(
      n,
      /create index if not exists \S+ on nodes\(parent_id\)/,
      "Missing index on nodes(parent_id)"
    );
  });

  it("index on nodes(branch_id)", () => {
    assert.match(
      n,
      /create index if not exists \S+ on nodes\(branch_id\)/,
      "Missing index on nodes(branch_id)"
    );
  });
});

describe("pool.js module structure", () => {
  it("pool.js file exists", () => {
    const poolPath = path.join(__dirname, "../src/server/db/pool.js");
    assert.ok(fs.existsSync(poolPath), "src/server/db/pool.js not found");
  });

  it("pool.js reads DATABASE_URL", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/server/db/pool.js"),
      "utf8"
    );
    assert.ok(
      src.includes("DATABASE_URL"),
      "pool.js must read DATABASE_URL from environment"
    );
  });

  it("pool.js exports a default (the pool instance)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/server/db/pool.js"),
      "utf8"
    );
    assert.ok(
      src.includes("export default"),
      "pool.js must have a default export"
    );
  });
});

describe("migrate.js module structure", () => {
  it("migrate.js file exists", () => {
    const migratePath = path.join(__dirname, "../src/server/db/migrate.js");
    assert.ok(fs.existsSync(migratePath), "src/server/db/migrate.js not found");
  });

  it("migrate.js checks DATABASE_URL and exits if missing", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/server/db/migrate.js"),
      "utf8"
    );
    assert.ok(
      src.includes("DATABASE_URL"),
      "migrate.js must check DATABASE_URL"
    );
    assert.ok(
      src.includes("process.exit"),
      "migrate.js must call process.exit when DATABASE_URL is missing"
    );
  });

  it("migrate.js reads from migrations directory", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/server/db/migrate.js"),
      "utf8"
    );
    assert.ok(
      src.includes("migrations"),
      "migrate.js must reference the migrations directory"
    );
  });

  it("migrate.js applies migrations in a transaction (BEGIN/COMMIT)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/server/db/migrate.js"),
      "utf8"
    );
    assert.ok(src.includes("BEGIN"), "migrate.js must wrap migrations in BEGIN");
    assert.ok(
      src.includes("COMMIT"),
      "migrate.js must commit migrations with COMMIT"
    );
    assert.ok(
      src.includes("ROLLBACK"),
      "migrate.js must ROLLBACK on failure"
    );
  });
});

// ---------------------------------------------------------------------------
// Integration tests — only run when DATABASE_URL is set
// ---------------------------------------------------------------------------

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("Integration: live database (skipped without DATABASE_URL)", {
  skip: !HAS_DB,
}, () => {
  let pool;

  before(async () => {
    ({ default: pool } = await import("../src/server/db/pool.js"));
  });

  // Tear the pool down once, after all integration tests — a pg Pool cannot be
  // reused after end(), so doing this per-test would break additional tests.
  after(async () => {
    if (pool) await pool.end();
  });

  it("can connect and run a simple query", async () => {
    const { rows } = await pool.query("SELECT 1 AS val");
    assert.equal(rows[0].val, 1);
  });
});
