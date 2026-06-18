/**
 * src/server/db/pool.js
 *
 * Exports a singleton pg.Pool configured from DATABASE_URL.
 * Import this module anywhere that needs a database connection;
 * never construct a Pool directly in route handlers or services.
 *
 * The pool is lazy: no connection is made until the first query.
 * Call pool.end() during graceful shutdown (src/server/index.js).
 */

import pg from "pg";

const { Pool } = pg;

// Allow the pool to be constructed even when DATABASE_URL is absent
// (e.g. during unit tests that mock or skip DB calls).  A missing URL
// will only surface as a runtime error when an actual query is made.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep the connection count low for a local/dev setup.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export default pool;
