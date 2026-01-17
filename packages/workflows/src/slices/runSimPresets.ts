/**
 * Lab Sim Presets Workflow
 *
 * Pure workflow that orchestrates:
 * - Candle slice export (ClickHouse -> Parquet)
 * - Feature computation (optional, DuckDB)
 * - Simulation (TypeScript simulator)
 * - Summary aggregation
 *
 * This is a pure handler - all I/O happens through adapters.
 */

import type { Candle } from '@quantbot/core';
import type { SliceManifestV1 } from '@quantbot/core';
import { logger } from '@quantbot/infra/utils';

export type SimPresetV1 = {
  kind: 'sim_preset_v1';
  name: string;
  description?: string;
  data: {
    dataset: 'candles_1m' | 'candles_5m';
    chain: 'sol' | 'eth' | 'base' | 'bsc';
    interval: '1m' | '5m' | '1h' | '1d';
    time_range: { start: string; end: string };
    tokens_file: string;
  };
  features: {
    timeframe: '1m' | '5m' | '1h' | '1d';
    groups: Array<{ name: string; indicators: Array<Record<string, any>> }>;
  };
  strategy: {
    entries: Array<{ name: string; when: any }>;
    exits: Array<{ name: string; when: any }>;
  };
  risk: {
    position_size: { mode: 'fixed_quote'; quote: number };
    stop_loss:
      | { mode: 'atr_multiple'; atr: string; multiple: number }
      | { mode: 'trailing_percent'; percent: number }
      | { mode: 'fixed_percent'; percent: number };
    take_profit:
      | { mode: 'rr_multiple'; rr: number }
      | { mode: 'fixed_percent'; percent: number }
      | { mode: 'none' };
    max_hold_minutes?: number;
    allow_reentry?: boolean;
  };
};

export type LabArtifactRef = {
  kind: 'manifest_json' | 'parquet' | 'json' | 'csv' | 'log';
  path: string;
  description?: string;
};

export type SimSummary = {
  runId: string;
  preset: string;
  dataset: string;
  chain: string;
  interval: string;
  startIso: string;
  endIso: string;
  tokens: number;
  trades: number;
  pnlQuote: number;
  maxDrawdownQuote: number;
  winRate: number;
  featureSetId: string;
  artifactDir: string;
};

export type CandleSliceProvider = {
  getCandleSlice(args: {
    run: { runId: string; createdAtIso: string; note?: string };
    preset: SimPresetV1;
    tokenIds: string[];
    artifactDir: string;
  }): Promise<{
    sliceManifestPath: string;
    artifacts: LabArtifactRef[];
  }>;
};

export type FeatureComputer = {
  computeFeatures(args: {
    run: { runId: string; createdAtIso: string; note?: string };
    preset: SimPresetV1;
    sliceManifestPath: string;
    artifactDir: string;
  }): Promise<{
    featureSetId: string;
    featuresParquetPath: string;
    artifacts: LabArtifactRef[];
  }>;
};

export type Simulator = {
  simulate(args: {
    run: { runId: string; createdAtIso: string; note?: string };
    preset: SimPresetV1;
    tokenIds: string[];
    sliceManifestPath: string;
    featuresParquetPath: string;
    featureSetId: string;
    artifactDir: string;
  }): Promise<{ summary: SimSummary; artifacts: LabArtifactRef[] }>;
};

export type SummaryIngester = {
  ingest(args: {
    run: { runId: string; createdAtIso: string; note?: string };
    summaries: SimSummary[];
  }): Promise<void>;
};

export type RunSimPresetsSpec = {
  presets: SimPresetV1[];
  tokenSets: Record<string, string[]>;
  artifactRootDir: string;
  sliceProvider: CandleSliceProvider;
  featureComputer: FeatureComputer;
  simulator: Simulator;
  summaryIngester: SummaryIngester;
  runNote?: string;
  clock?: { nowISO: () => string }; // Optional clock for deterministic timestamps
};

export type RunSimPresetsResult = {
  summaries: SimSummary[];
  artifacts: LabArtifactRef[];
};

/**
 * Run multiple simulation presets
 *
 * Pure workflow handler - all I/O through adapters
 */
export async function runSimPresets(spec: RunSimPresetsSpec): Promise<RunSimPresetsResult> {
  const {
    presets,
    tokenSets,
    artifactRootDir,
    sliceProvider,
    featureComputer,
    simulator,
    summaryIngester,
    runNote,
  } = spec;

  // Use provided clock or fall back to DateTime (for backward compatibility)
  // Note: For determinism, always provide a clock in production code
  const createdAtIso = spec.clock
    ? spec.clock.nowISO()
    : (await import('luxon')).DateTime.utc().toISO()!;
  const summaries: SimSummary[] = [];
  const allArtifacts: LabArtifactRef[] = [];

  for (const preset of presets) {
    const tokenIds = tokenSets[preset.data.tokens_file] || [];
    if (tokenIds.length === 0) {
      logger.warn(`Skipping preset ${preset.name}: no tokens in ${preset.data.tokens_file}`);
      continue;
    }

    const presetRunId = `${spec.runNote || 'lab_sim'}_${preset.name}_${createdAtIso.slice(0, 10)}`;
    const artifactDir = `${artifactRootDir}/preset=${preset.name}/run_id=${presetRunId}`;

    const run = {
      runId: presetRunId,
      createdAtIso,
      note: runNote,
    };

    try {
      // 1. Export candle slice
      logger.info(`Exporting candle slice for preset ${preset.name}`, { tokens: tokenIds.length });
      const sliceResult = await sliceProvider.getCandleSlice({
        run,
        preset,
        tokenIds,
        artifactDir,
      });
      allArtifacts.push(...sliceResult.artifacts);

      // 2. Compute features (optional)
      logger.info(`Computing features for preset ${preset.name}`);
      const featureResult = await featureComputer.computeFeatures({
        run,
        preset,
        sliceManifestPath: sliceResult.sliceManifestPath,
        artifactDir,
      });
      allArtifacts.push(...featureResult.artifacts);

      // 3. Run simulation
      logger.info(`Running simulation for preset ${preset.name}`);
      const simResult = await simulator.simulate({
        run,
        preset,
        tokenIds,
        sliceManifestPath: sliceResult.sliceManifestPath,
        featuresParquetPath: featureResult.featuresParquetPath,
        featureSetId: featureResult.featureSetId,
        artifactDir,
      });
      summaries.push(simResult.summary);
      allArtifacts.push(...simResult.artifacts);
    } catch (error) {
      logger.error(`Failed to run preset ${preset.name}`, error as Error);
      // Continue with next preset
    }
  }

  // 4. Ingest summaries (optional)
  if (summaries.length > 0) {
    await summaryIngester.ingest({
      run: { runId: spec.runNote || 'lab_sim', createdAtIso },
      summaries,
    });
  }

  return {
    summaries,
    artifacts: allArtifacts,
  };
}
