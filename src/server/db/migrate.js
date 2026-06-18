#!/usr/bin/env node
/**
 * src/server/db/migrate.js
 *
 * Minimal migration runner.  Applies SQL files from
 * src/server/db/migrations/ in lexicographic order.
 *
 * Tracks applied versions in the `schema_migrations` table (created
 * automatically on first run).  Each migration is applied inside its
 * own transaction so a failure leaves the database in a clean state.
 *
 * Usage:
 *   npm run migrate
 *   DATABASE_URL=postgres://... node src/server/db/migrate.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Ensure the tracking table exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT        PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Load already-applied versions.
    const { rows } = await client.query(
      "SELECT version FROM schema_migrations"
    );
    const applied = new Set(rows.map((r) => r.version));

    // Discover migration files sorted lexicographically.
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`  apply ${file}`);
        ran++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (ran === 0) {
      console.log("Nothing to migrate — database is up to date.");
    } else {
      console.log(`Done. Applied ${ran} migration(s).`);
    }
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
