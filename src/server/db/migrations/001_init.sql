-- Migration 001: initial schema for Branch
--
-- PK strategy: bigserial (auto-incrementing 64-bit integer).
-- Rationale: avoids the pgcrypto extension requirement that gen_random_uuid()
-- carries, keeps IDs sortable by insertion time, and is sufficient for a
-- single-tenant canvas tool. If multi-tenant or distributed requirements
-- emerge, swap to UUID v7 (sortable) without changing FK column types —
-- just widen to uuid and update the default.

-- Track applied migrations. The migrate.js runner owns this table and creates
-- it before applying any migration; it is repeated here (idempotent via
-- IF NOT EXISTS) only so this file is also self-contained if applied manually.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- trees
-- Top-level container for an exploration session.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trees (
  id          BIGSERIAL    PRIMARY KEY,
  name        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- branches
-- Holds FIXED-per-branch settings: aspect_ratio and model_version.
-- Deleting a tree cascades to all its branches.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id             BIGSERIAL    PRIMARY KEY,
  tree_id        BIGINT       NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,
  aspect_ratio   TEXT,
  model_version  TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branches_tree_id ON branches(tree_id);

-- ------------------------------------------------------------------
-- nodes
-- Generated images. Edges encode branch lineage via parent_id.
-- parent_id is NULL for root nodes (first image in a branch).
-- Deleting a parent cascades to its children; deleting a tree
-- cascades through tree_id.
--
-- FLEX per-iteration settings (lens, style, f-stop, etc.) are stored
-- in the `settings` JSONB column so non-image artifact types can reuse
-- this schema without schema migrations.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  id          BIGSERIAL    PRIMARY KEY,
  tree_id     BIGINT       NOT NULL REFERENCES trees(id)    ON DELETE CASCADE,
  branch_id   BIGINT       NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  parent_id   BIGINT                REFERENCES nodes(id)    ON DELETE CASCADE,
  prompt      TEXT,
  asset_url   TEXT,
  settings    JSONB        NOT NULL DEFAULT '{}',
  status      TEXT         NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'generating', 'done', 'failed')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nodes_tree_id   ON nodes(tree_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_branch_id ON nodes(branch_id);
