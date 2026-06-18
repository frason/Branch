import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API + health calls to the backend so the browser talks to the
    // dev server's own origin (no CORS needed). The API client defaults to a
    // relative base, so requests like `/api/trees` are forwarded here.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/health": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    // Vitest config — run tests in a Node environment (no browser/GPU needed)
    environment: "node",
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
  },
  build: {
    // Babylon.js tree-shakes well; sourcemaps aid future debugging
    sourcemap: false,
    target: "esnext",
  },
});
