/**
 * Parquet -> DuckDB analyzer adapter (impure).
 *
 * Skeleton showing boundary: it takes a SliceManifest and runs analysis,
 * producing a compact result + optional derived artifacts.
 */

import type { SliceAnalyzer } from '@quantbot/workflows';
import type {
  AnalysisResult,
  AnalysisSpec,
  RunContext,
  SliceManifestV1,
} from '@quantbot/workflows';

export interface DuckDbClient {
  /**
   * Minimal surface:
   * - open database (file or in-memory)
   * - execute SQL
   */
  exec(sql: string): Promise<void>;
  query<T = unknown>(sql: string): Promise<T[]>;
}

export class DuckDbSliceAnalyzerAdapter implements SliceAnalyzer {
  constructor(
    private readonly deps: {
      db: DuckDbClient;
      /**
       * Optional: write derived outputs somewhere.
       */
      writeText?: (path: string, content: string) => Promise<void>;
      hash: (input: string) => string;
    }
  ) {}

  async analyze(args: {
    run: RunContext;
    manifest: SliceManifestV1;
    analysis: AnalysisSpec;
  }): Promise<AnalysisResult> {
    const { manifest, analysis } = args;

    // 1) Register parquet files as a view/table (simple approach)
    // DuckDB can query parquet directly, e.g.:
    // CREATE VIEW slice AS SELECT * FROM read_parquet('file1.parquet', 'file2.parquet');
    const filesList = manifest.parquetFiles.map((f) => `'${f.path}'`).join(', ');
    await this.deps.db.exec(
      `CREATE OR REPLACE VIEW slice AS SELECT * FROM read_parquet([${filesList}]);`
    );

    // 2) Run analysis
    if (analysis.kind === 'sql') {
      const rows = await this.deps.db.query<Record<string, unknown>>(analysis.sql);

      // 3) Return compact summary by default
      // (You can standardize this later: e.g., expect one-row output for dashboards.)
      const summary: Record<string, string | number | boolean | null> = {
        rows: rows.length,
      };

      return { status: 'ok', summary };
    }

    // Named plan support (you can wire a plan registry later)
    return {
      status: 'skipped',
      warnings: [`No plan registry wired for planId=${analysis.planId}`],
    };
  }
}
