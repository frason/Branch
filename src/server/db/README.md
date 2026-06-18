# Database setup

## Prerequisites

- PostgreSQL 14+ (Homebrew: `brew install postgresql@16 && brew services start postgresql@16`)
- `createdb` and `psql` on your PATH

## Create the database

```bash
createdb branch_dev
export DATABASE_URL="postgres://localhost/branch_dev"
```

For a user/password setup:

```bash
psql -c "CREATE USER branch WITH PASSWORD 'branch';"
psql -c "CREATE DATABASE branch_dev OWNER branch;"
export DATABASE_URL="postgres://branch:branch@localhost/branch_dev"
```

## Run migrations

```bash
npm run migrate
```

The runner applies every `src/server/db/migrations/*.sql` file in lexicographic
order.  Already-applied files are skipped (tracked in the `schema_migrations`
table).  Each migration runs inside a transaction, so a failure rolls back
cleanly.

## Schema overview

### `trees`
Top-level container for an exploration session.

| column       | type         | notes                  |
|--------------|--------------|------------------------|
| id           | bigserial PK |                        |
| name         | text NOT NULL|                        |
| created_at   | timestamptz  |                        |
| updated_at   | timestamptz  |                        |

### `branches`
Holds **fixed-per-branch** settings: aspect ratio and model version.
Choosing a branch locks the generation parameters for the entire lineage.

| column        | type         | notes                            |
|---------------|--------------|----------------------------------|
| id            | bigserial PK |                                  |
| tree_id       | bigint FK    | → trees(id) ON DELETE CASCADE    |
| name          | text NOT NULL|                                  |
| aspect_ratio  | text         | e.g. "16:9", "1:1"              |
| model_version | text         | e.g. "sd-xl-1.0", "flux-dev"    |
| created_at    | timestamptz  |                                  |

### `nodes`
Generated images.  Edges encode branch lineage via `parent_id`.

| column     | type         | notes                                           |
|------------|--------------|-------------------------------------------------|
| id         | bigserial PK |                                                 |
| tree_id    | bigint FK    | → trees(id) ON DELETE CASCADE                   |
| branch_id  | bigint FK    | → branches(id) ON DELETE CASCADE                |
| parent_id  | bigint FK    | → nodes(id) ON DELETE CASCADE, NULL for roots   |
| prompt     | text         |                                                 |
| asset_url  | text         |                                                 |
| settings   | jsonb        | **flex per-iteration** settings: lens, style, f-stop, etc. |
| status     | text         | pending / generating / done / failed            |
| created_at | timestamptz  |                                                 |

## FK / cascade behaviour

| relationship           | ON DELETE behaviour                              |
|------------------------|--------------------------------------------------|
| branches → trees       | CASCADE — deleting a tree removes its branches   |
| nodes → trees          | CASCADE — deleting a tree removes its nodes      |
| nodes → branches       | CASCADE — deleting a branch removes its nodes    |
| nodes → nodes (parent) | CASCADE — deleting a parent removes its children |

Deleting a `tree` row will therefore cascade and remove all associated
`branches` and `nodes` in one operation.

## PK strategy

All primary keys use **`bigserial`** (auto-incrementing 64-bit integer).

- No extension dependency (avoids requiring `pgcrypto`/`uuid-ossp`).
- IDs are sortable by insertion order, useful for pagination.
- Sufficient for a single-tenant canvas tool.
- If distributed/multi-tenant requirements arise, migrate to UUID v7
  (sortable, no clock collision risk) without changing FK column types —
  widen columns to `uuid` and update the default expression.

## Environment variables

| variable       | required | description                              |
|----------------|----------|------------------------------------------|
| `DATABASE_URL` | yes      | Standard libpq connection string, e.g.  |
|                |          | `postgres://user:pass@host:5432/dbname`  |
