import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE_PATH && process.env.VITE_BASE_PATH.trim() ? process.env.VITE_BASE_PATH : "/",
  plugins: [react()],
  // Eval results exported by benchmark/bootstrapbench/export-site-data.mjs are
  // served as static assets straight from the repo's site-data/ directory.
  publicDir: path.resolve(rootDir, "../site-data"),
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src")
    }
  }
});
