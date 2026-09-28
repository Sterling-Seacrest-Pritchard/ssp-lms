import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 20000,
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**", ".superpowers/**"],
    // No separate test database - every test file shares the same live dev DB.
    // Most tests are scoped to their own randomUUID-named rows and tolerate
    // parallel files fine, but a handful (org-reporting's global stats) assert
    // on unscoped, whole-table counts and race against any other file's
    // concurrent inserts/deletes. Serializing file execution trades some wall
    // time for correctness across the whole suite.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
