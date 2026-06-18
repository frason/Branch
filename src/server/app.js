import express from "express";

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());

  // Routes
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // 404 handler — must come after all routes
  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  // Error handler — must be declared with four parameters so Express recognises it
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Internal Server Error" });
  });

  return app;
}
