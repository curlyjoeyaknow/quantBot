import type {
  CatalogPort,
  TokenSetRecord,
  SliceRecord,
  FeatureSetRecord,
  FeaturesRecord,
  SimRunRecord,
} from '../../ports/CatalogPort.js';
import type { DuckDbConnection } from './duckdbClient.js';

export class DuckDbCatalogAdapter implements CatalogPort {
  constructor(private readonly db: DuckDbConnection) {}

  // Token sets
  async upsertTokenSet(r: TokenSetRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO token_sets(token_set_id, source_path, token_count, tokens_sha, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token_set_id) DO UPDATE SET
         source_path=excluded.source_path,
         token_count=excluded.token_count,
         tokens_sha=excluded.tokens_sha,
         created_at=excluded.created_at`,
      [r.tokenSetId, r.sourcePath, r.tokenCount, r.tokensSha, r.createdAtIso]
    );
  }

  async getTokenSet(tokenSetId: string): Promise<TokenSetRecord | null> {
    const rows = await this.db.all<any>(`SELECT * FROM token_sets WHERE token_set_id = ? LIMIT 1`, [
      tokenSetId,
    ]);
    if (rows.length === 0) return null;
    const x = rows[0];
    return {
      tokenSetId: x.token_set_id,
      sourcePath: x.source_path,
      tokenCount: Number(x.token_count),
      tokensSha: x.tokens_sha,
      createdAtIso: new Date(x.created_at).toISOString(),
    };
  }

  // Slices
  async upsertSlice(r: SliceRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO slices(slice_id, dataset, chain, interval, start_iso, end_iso, token_set_id, schema_hash, slice_hash, manifest_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slice_id) DO UPDATE SET
         dataset=excluded.dataset,
         chain=excluded.chain,
         interval=excluded.interval,
         start_iso=excluded.start_iso,
         end_iso=excluded.end_iso,
         token_set_id=excluded.token_set_id,
         schema_hash=excluded.schema_hash,
         slice_hash=excluded.slice_hash,
         manifest_path=excluded.manifest_path,
         created_at=excluded.created_at`,
      [
        r.sliceId,
        r.dataset,
        r.chain,
        r.interval,
        r.startIso,
        r.endIso,
        r.tokenSetId,
        r.schemaHash,
        r.sliceHash,
        r.manifestPath,
        r.createdAtIso,
      ]
    );
  }

  async findSlice(args: {
    dataset: string;
    chain: string;
    interval: string;
    startIso: string;
    endIso: string;
    tokenSetId: string;
    schemaHash: string;
  }): Promise<SliceRecord | null> {
    const rows = await this.db.all<any>(
      `SELECT * FROM slices
       WHERE dataset=? AND chain=? AND interval=? AND start_iso=? AND end_iso=? AND token_set_id=? AND schema_hash=?
       LIMIT 1`,
      [
        args.dataset,
        args.chain,
        args.interval,
        args.startIso,
        args.endIso,
        args.tokenSetId,
        args.schemaHash,
      ]
    );
    if (rows.length === 0) return null;
    const x = rows[0];
    return {
      sliceId: x.slice_id,
      dataset: x.dataset,
      chain: x.chain,
      interval: x.interval,
      startIso: x.start_iso,
      endIso: x.end_iso,
      tokenSetId: x.token_set_id,
      schemaHash: x.schema_hash,
      sliceHash: x.slice_hash,
      manifestPath: x.manifest_path,
      createdAtIso: new Date(x.created_at).toISOString(),
    };
  }

  // Feature sets
  async upsertFeatureSet(r: FeatureSetRecord): Promise<void> {
    const featureSetVersion = r.featureSetVersion || '1.0.0';
    const featureSpecVersion = r.featureSpecVersion || '1.0.0';
    const computedAtIso = r.computedAtIso || r.createdAtIso;
    await this.db.run(
      `INSERT INTO feature_sets(feature_set_id, feature_spec_hash, feature_spec_json, feature_set_version, feature_spec_version, computed_at, computed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature_set_id) DO UPDATE SET
         feature_spec_hash=excluded.feature_spec_hash,
         feature_spec_json=excluded.feature_spec_json,
         feature_set_version=excluded.feature_set_version,
         feature_spec_version=excluded.feature_spec_version,
         computed_at=excluded.computed_at,
         computed_by=excluded.computed_by,
         created_at=excluded.created_at`,
      [
        r.featureSetId,
        r.featureSpecHash,
        r.featureSpecJson,
        featureSetVersion,
        featureSpecVersion,
        computedAtIso,
        r.computedBy || null,
        r.createdAtIso,
      ]
    );
  }

  async getFeatureSet(featureSetId: string): Promise<FeatureSetRecord | null> {
    const rows = await this.db.all<any>(
      `SELECT * FROM feature_sets WHERE feature_set_id = ? LIMIT 1`,
      [featureSetId]
    );
    if (rows.length === 0) return null;
    const x = rows[0];
    return {
      featureSetId: x.feature_set_id,
      featureSpecHash: x.feature_spec_hash,
      featureSpecJson: x.feature_spec_json,
      featureSetVersion: x.feature_set_version || '1.0.0',
      featureSpecVersion: x.feature_spec_version || '1.0.0',
      computedAtIso: x.computed_at ? new Date(x.computed_at).toISOString() : new Date(x.created_at).toISOString(),
      computedBy: x.computed_by || undefined,
      createdAtIso: new Date(x.created_at).toISOString(),
    };
  }

  // Features (slice + feature set)
  async upsertFeatures(r: FeaturesRecord): Promise<void> {
    const featureSetVersion = r.featureSetVersion || '1.0.0';
    const computedAtIso = r.computedAtIso || r.createdAtIso;
    await this.db.run(
      `INSERT INTO features(features_id, slice_id, feature_set_id, manifest_path, parquet_path, feature_set_version, computed_at, computed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(features_id) DO UPDATE SET
         slice_id=excluded.slice_id,
         feature_set_id=excluded.feature_set_id,
         manifest_path=excluded.manifest_path,
         parquet_path=excluded.parquet_path,
         feature_set_version=excluded.feature_set_version,
         computed_at=excluded.computed_at,
         computed_by=excluded.computed_by,
         created_at=excluded.created_at`,
      [
        r.featuresId,
        r.sliceId,
        r.featureSetId,
        r.manifestPath,
        r.parquetPath,
        featureSetVersion,
        computedAtIso,
        r.computedBy || null,
        r.createdAtIso,
      ]
    );
  }

  async findFeatures(args: {
    sliceId: string;
    featureSetId: string;
  }): Promise<FeaturesRecord | null> {
    const rows = await this.db.all<any>(
      `SELECT * FROM features WHERE slice_id=? AND feature_set_id=? LIMIT 1`,
      [args.sliceId, args.featureSetId]
    );
    if (rows.length === 0) return null;
    const x = rows[0];
    return {
      featuresId: x.features_id,
      sliceId: x.slice_id,
      featureSetId: x.feature_set_id,
      manifestPath: x.manifest_path,
      parquetPath: x.parquet_path,
      featureSetVersion: x.feature_set_version || '1.0.0',
      computedAtIso: x.computed_at ? new Date(x.computed_at).toISOString() : new Date(x.created_at).toISOString(),
      computedBy: x.computed_by || undefined,
      createdAtIso: new Date(x.created_at).toISOString(),
    };
  }

  // Sim runs
  async upsertSimRun(r: SimRunRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO sim_runs(sim_id, features_id, strategy_hash, risk_hash, window_id, summary_path, artifact_dir, code_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sim_id) DO UPDATE SET
         features_id=excluded.features_id,
         strategy_hash=excluded.strategy_hash,
         risk_hash=excluded.risk_hash,
         window_id=excluded.window_id,
         summary_path=excluded.summary_path,
         artifact_dir=excluded.artifact_dir,
         code_version=excluded.code_version,
         created_at=excluded.created_at`,
      [
        r.simId,
        r.featuresId,
        r.strategyHash,
        r.riskHash,
        r.windowId ?? null,
        r.summaryPath,
        r.artifactDir,
        r.codeVersion,
        r.createdAtIso,
      ]
    );
  }
}
