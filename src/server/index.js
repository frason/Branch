// Load .env into process.env for local development.
// dotenv/config is silent when .env is absent — safe in all environments.
// This import must live in index.js only; never in app.js or test paths so
// tests are fully isolated from local .env files.
import "dotenv/config";

import { createApp } from "./app.js";

const PORT = process.env.PORT ?? 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Branch server listening at http://localhost:${PORT}`);
});
