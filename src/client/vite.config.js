import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
