/**
 * Wiring: instantiate ports/adapters here.
 * Workflows stay pure; caching + catalogue live here.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

import type { SimPresetV1, LabPorts, RunContext } from '@quantbot/workflows';
import type {
  CandleSliceSpec,
  SliceExportResult,
  FeatureComputeResult,
  FeatureSpecV1,
  SimulationResult,
  StrategySpecV1,
  RiskSpecV1,
  CatalogPort,
} from '@quantbot/storage';

import { runLabPreset } from '@quantbot/workflows';

// Adapters - now exported from main package
import {
  CandleSliceExporter,
  FeatureComputer,
  SimulationExecutor,
  DuckDbCatalogAdapter,
  openDuckDb,
  runSqlFile,
  LeaderboardRepository,
  getClickHouseClient,
} from '@quantbot/storage';

// IDs helper
import { tokenSetId, sliceId, featuresId, simId, sha } from '@quantbot/lab';

function codeVersion(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch {
    return 'unknown';
  }
}

function stableCandlesSchemaHashV1(): string {
  // Must match CandleSliceExporter constant. Keep stable.
  return sha({
    kind: 'candles_parquet_v1',
    columns: ['chain', 'token_id', 'ts', 'interval', 'open', 'high', 'low', 'close', 'volume'],
  });
}

/**
 * Decorator: reuse slice export if already exists in catalogue.
 */
class CatalogedCandleSlicePort {
  constructor(
    private readonly inner: LabPorts['slice'],
    private readonly catalog: CatalogPort,
    private readonly schemaHash: string
  ) {}

  async exportSlice(args: {
    run: RunContext;
    spec: CandleSliceSpec;
    artifactDir: string;
  }): Promise<SliceExportResult> {
    // Token set ID must be stable.
    const tsetId = tokenSetId(args.spec.tokenIds);
    const sId = sliceId({
      dataset: args.spec.dataset,
      chain: args.spec.chain,
      interval: args.spec.interval,
      startIso: args.spec.startIso,
      endIso: args.spec.endIso,
      tokenSetId: tsetId,
      schemaHash: this.schemaHash,
    });

    const hit = await this.catalog.findSlice({
      dataset: args.spec.dataset,
      chain: args.spec.chain,
      interval: args.spec.interval,
      startIso: args.spec.startIso,
      endIso: args.spec.endIso,
      tokenSetId: tsetId,
      schemaHash: this.schemaHash,
    });

    if (hit && fs.existsSync(hit.manifestPath)) {
      return {
        manifestPath: hit.manifestPath,
        parquetPaths: [], // manifest will list real paths
        sliceHash: hit.sliceHash,
        schemaHash: hit.schemaHash,
      };
    }

    const res = await this.inner.exportSlice(args);

    // Persist token set + slice index (catalogue is index, manifests are truth)
    await this.catalog.upsertTokenSet({
      tokenSetId: tsetId,
      sourcePath: '(runtime)',
      tokenCount: args.spec.tokenIds.length,
      tokensSha: sha([...args.spec.tokenIds].sort()),
      createdAtIso: args.run.createdAtIso,
    });

    await this.catalog.upsertSlice({
      sliceId: sId,
      dataset: args.spec.dataset,
      chain: args.spec.chain,
      interval: args.spec.interval,
      startIso: args.spec.startIso,
      endIso: args.spec.endIso,
      tokenSetId: tsetId,
      schemaHash: res.schemaHash ?? this.schemaHash,
      sliceHash: res.sliceHash,
      manifestPath: res.manifestPath,
      createdAtIso: args.run.createdAtIso,
    });

    return res;
  }
}

/**
 * Decorator: reuse features parquet if already exists in catalogue.
 */
class CatalogedFeatureComputePort {
  constructor(
    private readonly inner: LabPorts['features'],
    private readonly catalog: CatalogPort
  ) {}

  async compute(args: {
    run: RunContext;
    sliceManifestPath: string;
    sliceHash: string;
    featureSpec: FeatureSpecV1;
    artifactDir: string;
    // Extra for catalogue identity:
    sliceIdentity: {
      dataset: string;
      chain: string;
      interval: string;
      startIso: string;
      endIso: string;
      tokenIds: string[];
      schemaHash: string;
    };
  }): Promise<FeatureComputeResult> {
    const tsetId = tokenSetId(args.sliceIdentity.tokenIds);
    const sId = sliceId({
      dataset: args.sliceIdentity.dataset,
      chain: args.sliceIdentity.chain,
      interval: args.sliceIdentity.interval,
      startIso: args.sliceIdentity.startIso,
      endIso: args.sliceIdentity.endIso,
      tokenSetId: tsetId,
      schemaHash: args.sliceIdentity.schemaHash,
    });

    const fSetId = sha(args.featureSpec);
    const fId = featuresId({ sliceId: sId, featureSetId: fSetId });

    const hit = await this.catalog.findFeatures({ sliceId: sId, featureSetId: fSetId });
    if (hit && fs.existsSync(hit.parquetPath) && fs.existsSync(hit.manifestPath)) {
      return {
        featureSetId: fSetId,
        featuresParquetPath: hit.parquetPath,
        manifestPath: hit.manifestPath,
      };
    }

    const res = await this.inner.compute({
      run: args.run,
      sliceManifestPath: args.sliceManifestPath,
      sliceHash: args.sliceHash,
      featureSpec: args.featureSpec,
      artifactDir: args.artifactDir,
    });

    await this.catalog.upsertFeatureSet({
      featureSetId: fSetId,
      featureSpecHash: fSetId,
      featureSpecJson: JSON.stringify(args.featureSpec),
      createdAtIso: args.run.createdAtIso,
    });

    await this.catalog.upsertFeatures({
      featuresId: fId,
      sliceId: sId,
      featureSetId: fSetId,
      manifestPath: res.manifestPath,
      parquetPath: res.featuresParquetPath,
      createdAtIso: args.run.createdAtIso,
    });

    return { ...res, featureSetId: fSetId };
  }
}

/**
 * Decorator: record sim run provenance in catalogue.
 * (We don't reuse sims yet; we just index them.)
 */
class CatalogedSimulationPort {
  constructor(
    private readonly inner: LabPorts['simulation'],
    private readonly catalog: CatalogPort
  ) {}

  async run(args: {
    run: RunContext;
    presetName: string;
    windowId?: string;
    sliceManifestPath: string;
    sliceHash: string;
    features: FeatureComputeResult;
    strategy: StrategySpecV1;
    risk: RiskSpecV1;
    artifactDir: string;

    // identity to derive featuresId/simId:
    sliceIdentity: {
      dataset: string;
      chain: string;
      interval: string;
      startIso: string;
      endIso: string;
      tokenIds: string[];
      schemaHash: string;
    };
  }): Promise<SimulationResult> {
    const strategyHash = sha(args.strategy);
    const riskHash = sha(args.risk);

    const tsetId = tokenSetId(args.sliceIdentity.tokenIds);
    const sId = sliceId({
      dataset: args.sliceIdentity.dataset,
      chain: args.sliceIdentity.chain,
      interval: args.sliceIdentity.interval,
      startIso: args.sliceIdentity.startIso,
      endIso: args.sliceIdentity.endIso,
      tokenSetId: tsetId,
      schemaHash: args.sliceIdentity.schemaHash,
    });

    const fSetId = sha(args.features.featureSetId); // stable-ish
    const fId = featuresId({ sliceId: sId, featureSetId: fSetId });

    const engineVersion = 'sim_engine_v1';
    const sRunId = simId({
      featuresId: fId,
      strategyHash,
      riskHash,
      windowId: args.windowId,
      engineVersion,
    });

    const res = await this.inner.run({
      run: args.run,
      presetName: args.presetName,
      windowId: args.windowId,
      sliceManifestPath: args.sliceManifestPath,
      sliceHash: args.sliceHash,
      features: args.features,
      strategy: args.strategy,
      risk: args.risk,
      artifactDir: args.artifactDir,
    });

    await this.catalog.upsertSimRun({
      simId: sRunId,
      featuresId: fId,
      strategyHash,
      riskHash,
      windowId: args.windowId,
      summaryPath: res.artifacts.summaryJsonPath,
      artifactDir: args.artifactDir,
      codeVersion: codeVersion(),
      createdAtIso: args.run.createdAtIso,
    });

    return res;
  }
}

export async function runSelectedPresets(args: {
  runId: string;
  createdAtIso: string;
  presets: SimPresetV1[];
  tokenSets: Record<string, string[]>;
  artifactRootDir: string;
}) {
  const run: RunContext = { runId: args.runId, createdAtIso: args.createdAtIso };

  // ---- init catalogue (DuckDB)
  const catalogDbPath = `${args.artifactRootDir}/catalog.duckdb`;
  const conn = await openDuckDb(catalogDbPath);
  await runSqlFile(conn, 'packages/lab/src/catalog/schema.sql');
  const catalog = new DuckDbCatalogAdapter(conn);

  // ---- init ClickHouse client
  const ch = getClickHouseClient();

  // ---- base adapters
  const baseSlice = new CandleSliceExporter(ch);
  const baseFeatures = new FeatureComputer(conn);
  const baseSim = new SimulationExecutor();
  const leaderboard = new LeaderboardRepository();

  const schemaHash = stableCandlesSchemaHashV1();

  // ---- cataloged decorators
  const slice = new CatalogedCandleSlicePort(baseSlice, catalog, schemaHash) as LabPorts['slice'];
  const features = new CatalogedFeatureComputePort(baseFeatures, catalog);
  const simulation = new CatalogedSimulationPort(baseSim, catalog);

  const ports: LabPorts = {
    slice,
    features: {
      compute: async (a: any) => {
        // augment with identity for catalogue lookups
        return features.compute({
          ...a,
          sliceIdentity: a.sliceIdentity,
        });
      },
    } as LabPorts['features'],
    simulation: {
      run: async (a: any) => {
        return simulation.run({
          ...a,
          sliceIdentity: a.sliceIdentity,
        });
      },
    } as LabPorts['simulation'],
    leaderboard,
  };

  const results: SimulationResult[] = [];
  for (const preset of args.presets) {
    const tokenIds = args.tokenSets[preset.data.tokens_file] ?? [];

    // identity snapshot for catalogue lookups
    const sliceIdentity = {
      dataset: preset.data.dataset,
      chain: preset.data.chain,
      interval: preset.data.interval,
      startIso: preset.data.time_range.start,
      endIso: preset.data.time_range.end,
      tokenIds,
      schemaHash,
    };

    // We pass identity through by temporarily attaching it onto args objects.
    // This keeps workflows pure and avoids changing workflow signatures.
    const res = await runLabPreset({
      preset,
      tokenIds,
      ports: {
        ...ports,
        slice: ports.slice,
        features: {
          compute: (x: any) => ports.features.compute({ ...x, sliceIdentity }),
        } as LabPorts['features'],
        simulation: {
          run: (x: any) => ports.simulation.run({ ...x, sliceIdentity }),
        } as LabPorts['simulation'],
      },
      run,
      artifactRootDir: args.artifactRootDir,
    });

    results.push(res);
  }

  return results;
}
