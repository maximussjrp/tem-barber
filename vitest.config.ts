import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/__tests__/mocks/server-only.js"),
    },
  },
});
