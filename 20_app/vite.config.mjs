import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(currentDir, "src/renderer"),
  base: "./",
  build: {
    outDir: path.resolve(currentDir, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    include: ["**/*.test.{js,jsx}", "../main/**/*.test.js"],
  },
});
