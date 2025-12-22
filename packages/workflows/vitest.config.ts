import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/index.ts" // index files are mostly re-exports; don't let them inflate coverage
      ],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
        statements: 85
      }
    }
  }
});
