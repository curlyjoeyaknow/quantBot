/**
 * ClickHouse -> Parquet exporter adapter (impure).
 *
 * This file is intentionally a skeleton:
 * - it shows the boundary and the deterministic outputs
 * - your actual ClickHouse client + parquet writer is implementation detail
 */

import type { SliceExporter } from "@quantbot/workflows";
import type { ParquetLayoutSpec, RunContext, SliceManifestV1, SliceSpec } from "@quantbot/workflows";

export interface ClickHouseClient {
  // Define the minimal client surface you need.
  // Example: queryStream(sql, params) -> AsyncIterable<Row> or query(sql) -> Row[]
  query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

export interface FileWriter {
  // Minimal filesystem abstraction (or S3 writer)
  writeJson(path: string, value: unknown): Promise<void>;
  // writeParquet would go here in reality
}

export class ClickHouseSliceExporterAdapter implements SliceExporter {
  constructor(
    private readonly deps: {
      ch: ClickHouseClient;
      writer: FileWriter;
      nowIso: () => string; // inject clock for determinism in tests
      /**
       * Deterministic id/hash generator.
       * Provide your own stable hash (e.g., xxhash/sha256).
       */
      hash: (input: string) => string;
      /**
       * Template expander for subdirTemplate.
       */
      expandTemplate: (tpl: string, vars: Record<string, string>) => string;
    }
  ) {}

  async exportSlice(args: { run: RunContext; spec: SliceSpec; layout: ParquetLayoutSpec }): Promise<SliceManifestV1> {
    const { run, spec, layout } = args;

    // 1) Build deterministic output directory from template
    const day = spec.timeRange.startIso.slice(0, 10); // naive; adapter can do better
    const vars: Record<string, string> = {
      dataset: spec.dataset,
      chain: spec.chain,
      runId: run.runId,
      strategyId: run.strategyId ?? "none",
      yyyy: day.slice(0, 4),
      mm: day.slice(5, 7),
      dd: day.slice(8, 10),
    };

    const subdir = this.deps.expandTemplate(layout.subdirTemplate, vars);
    const base = layout.baseUri.replace(/\/+$/, "");
    const outDir = `${base}/${subdir}`.replace(/\/+/g, "/");

    // 2) Export logic (placeholder)
    // In reality, you would:
    // - generate SQL from spec (dataset mapping + filters)
    // - stream results to parquet file(s)
    // - compute row counts + byte sizes
    //
    // For now we create a manifest that points to where files *would* be.
    const parquetPath = `${outDir}/part-000.parquet`;

    const createdAtIso = this.deps.nowIso();
    const specHash = this.deps.hash(JSON.stringify({ run, spec, layout }));

    const manifest: SliceManifestV1 = {
      version: 1,
      manifestId: this.deps.hash(`manifest:${specHash}:${createdAtIso}`),
      createdAtIso,
      run,
      spec,
      layout,
      parquetFiles: [{ path: parquetPath }],
      summary: { totalFiles: 1 },
      integrity: { specHash },
    };

    // 3) Write manifest (optional but recommended)
    const manifestPath = `${outDir}/slice.manifest.json`;
    await this.deps.writer.writeJson(manifestPath, manifest);

    return manifest;
  }
}

