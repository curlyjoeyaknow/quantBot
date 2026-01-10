import { defineConfig } from "vitest/config";
import path from "path";
import type { Plugin } from "vite";

// Plugin to force resolution to source files instead of dist
// This prevents "No exports main defined" errors by intercepting module resolution
const forceSourceResolution = (): Plugin => {
  return {
    name: "force-source-resolution",
    enforce: "pre",
    resolveId(id, importer) {
      // If trying to load a dist file, redirect to source
      if (id.includes("/dist/") && id.includes("@quantbot/")) {
        const distMatch = id.match(/@quantbot\/([^/]+)\/dist\/(.+)$/);
        if (distMatch) {
          const [, packageName, distPath] = distMatch;
          // Convert dist path to source path
          const sourcePath = path.resolve(
            __dirname,
            `../${packageName}/src/${distPath.replace(/\.js$/, ".ts")}`
          );
          try {
            const fs = require("fs");
            if (fs.existsSync(sourcePath)) {
              return sourcePath;
            }
          } catch {
            // Ignore
          }
        }
      }
      // If it's a @quantbot package import, force it to use source
      if (id.startsWith("@quantbot/")) {
        const packageName = id.replace("@quantbot/", "").split("/")[0];
        let subPath = id.replace(`@quantbot/${packageName}`, "") || "";
        if (subPath.startsWith("/")) {
          subPath = subPath.slice(1);
        }
        // Skip if it's already pointing to dist
        if (subPath.includes("/dist/")) {
          subPath = subPath.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
        }
        if (subPath && !subPath.endsWith(".ts") && !subPath.endsWith(".js")) {
          subPath = `${subPath}.ts`;
        }
        if (!subPath) {
          subPath = "index.ts";
        }
        const sourcePath = path.resolve(
          __dirname,
          `../${packageName}/src/${subPath}`
        );
        try {
          const fs = require("fs");
          if (fs.existsSync(sourcePath)) {
            return sourcePath;
          }
        } catch {
          // Ignore
        }
      }
      return null;
    },
  };
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 15_000,
    // Force inline these packages to use source files, not dist
    deps: {
      inline: [
        "@quantbot/core",
        "@quantbot/utils",
        "@quantbot/storage",
        "@quantbot/api-clients",
        "@quantbot/ohlcv",
        "@quantbot/ingestion",
        "@quantbot/backtest",
        "@quantbot/analytics",
        "@quantbot/workflows",
        "@quantbot/jobs",
        "@quantbot/data-observatory",
      ],
    },
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
  },
  resolve: {
    alias: {
      "@quantbot/workflows": path.resolve(__dirname, "./src"),
      "@quantbot/workflows/*": path.resolve(__dirname, "./src/*"),
      // Prevent loading dist files - always use source
      "^@quantbot/workflows/dist/(.*)$": path.resolve(__dirname, "./src/$1"),
      "@quantbot/core": path.resolve(__dirname, "../core/src"),
      "@quantbot/core/*": path.resolve(__dirname, "../core/src/*"),
      "@quantbot/utils": path.resolve(__dirname, "../utils/src"),
      "@quantbot/utils/*": path.resolve(__dirname, "../utils/src/*"),
      "@quantbot/storage": path.resolve(__dirname, "../storage/src"),
      "@quantbot/storage/*": path.resolve(__dirname, "../storage/src/*"),
      "@quantbot/api-clients": path.resolve(__dirname, "../api-clients/src"),
      "@quantbot/api-clients/*": path.resolve(__dirname, "../api-clients/src/*"),
      "@quantbot/ohlcv": path.resolve(__dirname, "../ohlcv/src"),
      "@quantbot/ohlcv/*": path.resolve(__dirname, "../ohlcv/src/*"),
      "@quantbot/ingestion": path.resolve(__dirname, "../ingestion/src"),
      "@quantbot/ingestion/*": path.resolve(__dirname, "../ingestion/src/*"),
      "@quantbot/backtest": path.resolve(__dirname, "../simulation/src"),
      "@quantbot/backtest/*": path.resolve(__dirname, "../simulation/src/*"),
      "@quantbot/analytics": path.resolve(__dirname, "../analytics/src"),
      "@quantbot/analytics/*": path.resolve(__dirname, "../analytics/src/*"),
      "@quantbot/jobs": path.resolve(__dirname, "../jobs/src"),
      "@quantbot/jobs/*": path.resolve(__dirname, "../jobs/src/*"),
      "@quantbot/data-observatory": path.resolve(
        __dirname,
        "../data-observatory/src"
      ),
      "@quantbot/data-observatory/*": path.resolve(
        __dirname,
        "../data-observatory/src/*"
      ),
    },
    // Ensure we don't resolve to dist files - prioritize source
    conditions: ["import", "module", "browser", "default"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  plugins: [forceSourceResolution()],
  esbuild: {
    target: "node18",
  },
});
