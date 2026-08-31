import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 20000,
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**", ".superpowers/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
