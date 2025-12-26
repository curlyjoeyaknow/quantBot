/**
 * Tests for runSimPresets workflow
 *
 * CRITICAL: These tests would have caught edge cases:
 * - Empty presets array
 * - Empty token sets
 * - Missing token sets
 * - Adapter failures
 * - Partial failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSimPresets } from './runSimPresets.js';
import type {
  SimPresetV1,
  CandleSliceProvider,
  FeatureComputer,
  Simulator,
  SummaryIngester,
} from './runSimPresets.js';

describe('runSimPresets - Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Empty Inputs', () => {
    it('CRITICAL: Should handle empty presets array', async () => {
      const sliceProvider: CandleSliceProvider = {
        getCandleSlice: vi.fn(),
      };
      const featureComputer: FeatureComputer = {
        computeFeatures: vi.fn(),
      };
      const simulator: Simulator = {
        simulate: vi.fn(),
      };
      const summaryIngester: SummaryIngester = {
        ingest: vi.fn(),
      };

      const result = await runSimPresets({
        presets: [],
        tokenSets: {},
        artifactRootDir: '/artifacts',
        sliceProvider,
        featureComputer,
        simulator,
        summaryIngester,
      });

      expect(result.summaries).toEqual([]);
      expect(result.artifacts).toEqual([]);
      expect(sliceProvider.getCandleSlice).not.toHaveBeenCalled();
    });

    it('CRITICAL: Should skip presets with empty token sets', async () => {
      const preset: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'test',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'empty.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const sliceProvider: CandleSliceProvider = {
        getCandleSlice: vi.fn(),
      };

      const result = await runSimPresets({
        presets: [preset],
        tokenSets: { 'empty.txt': [] }, // Empty token set
        artifactRootDir: '/artifacts',
        sliceProvider,
        featureComputer: { computeFeatures: vi.fn() },
        simulator: { simulate: vi.fn() },
        summaryIngester: { ingest: vi.fn() },
      });

      expect(result.summaries).toEqual([]);
      expect(sliceProvider.getCandleSlice).not.toHaveBeenCalled();
    });

    it('CRITICAL: Should handle missing token sets', async () => {
      const preset: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'test',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'missing.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const sliceProvider: CandleSliceProvider = {
        getCandleSlice: vi.fn(),
      };

      const result = await runSimPresets({
        presets: [preset],
        tokenSets: {}, // Missing token set
        artifactRootDir: '/artifacts',
        sliceProvider,
        featureComputer: { computeFeatures: vi.fn() },
        simulator: { simulate: vi.fn() },
        summaryIngester: { ingest: vi.fn() },
      });

      expect(result.summaries).toEqual([]);
      expect(sliceProvider.getCandleSlice).not.toHaveBeenCalled();
    });
  });

  describe('Adapter Failures', () => {
    it('CRITICAL: Should continue with next preset on slice provider failure', async () => {
      const preset1: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'preset1',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'tokens.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const preset2: SimPresetV1 = {
        ...preset1,
        name: 'preset2',
      };

      const sliceProvider: CandleSliceProvider = {
        getCandleSlice: vi
          .fn()
          .mockRejectedValueOnce(new Error('Slice provider failed'))
          .mockResolvedValueOnce({
            sliceManifestPath: '/manifest.json',
            artifacts: [],
          }),
      };

      const featureComputer: FeatureComputer = {
        computeFeatures: vi.fn().mockResolvedValue({
          featureSetId: 'test',
          featuresParquetPath: '/features.parquet',
          artifacts: [],
        }),
      };

      const simulator: Simulator = {
        simulate: vi.fn().mockResolvedValue({
          summary: {
            runId: 'test',
            preset: 'preset2',
            dataset: 'candles_1m',
            chain: 'sol',
            interval: '1m',
            startIso: '2024-12-01T00:00:00Z',
            endIso: '2024-12-02T00:00:00Z',
            tokens: 1,
            trades: 0,
            pnlQuote: 0,
            maxDrawdownQuote: 0,
            winRate: 0,
            featureSetId: 'test',
            artifactDir: '/artifacts',
          },
          artifacts: [],
        }),
      };

      const result = await runSimPresets({
        presets: [preset1, preset2],
        tokenSets: { 'tokens.txt': ['So11111111111111111111111111111111111111112'] },
        artifactRootDir: '/artifacts',
        sliceProvider,
        featureComputer,
        simulator,
        summaryIngester: { ingest: vi.fn() },
      });

      // Should have one summary (preset2 succeeded)
      expect(result.summaries.length).toBe(1);
      expect(result.summaries[0]?.preset).toBe('preset2');
      expect(sliceProvider.getCandleSlice).toHaveBeenCalledTimes(2);
    });

    it('CRITICAL: Should continue with next preset on feature computer failure', async () => {
      const preset: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'test',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'tokens.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const sliceProvider: CandleSliceProvider = {
        getCandleSlice: vi.fn().mockResolvedValue({
          sliceManifestPath: '/manifest.json',
          artifacts: [],
        }),
      };

      const featureComputer: FeatureComputer = {
        computeFeatures: vi.fn().mockRejectedValue(new Error('Feature computer failed')),
      };

      const result = await runSimPresets({
        presets: [preset],
        tokenSets: { 'tokens.txt': ['So11111111111111111111111111111111111111112'] },
        artifactRootDir: '/artifacts',
        sliceProvider,
        featureComputer,
        simulator: { simulate: vi.fn() },
        summaryIngester: { ingest: vi.fn() },
      });

      expect(result.summaries).toEqual([]);
      expect(featureComputer.computeFeatures).toHaveBeenCalled();
    });

    it('CRITICAL: Should continue with next preset on simulator failure', async () => {
      const preset: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'test',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'tokens.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const sliceProvider: CandleSliceProvider = {
        getCandleSlice: vi.fn().mockResolvedValue({
          sliceManifestPath: '/manifest.json',
          artifacts: [],
        }),
      };

      const featureComputer: FeatureComputer = {
        computeFeatures: vi.fn().mockResolvedValue({
          featureSetId: 'test',
          featuresParquetPath: '/features.parquet',
          artifacts: [],
        }),
      };

      const simulator: Simulator = {
        simulate: vi.fn().mockRejectedValue(new Error('Simulator failed')),
      };

      const result = await runSimPresets({
        presets: [preset],
        tokenSets: { 'tokens.txt': ['So11111111111111111111111111111111111111112'] },
        artifactRootDir: '/artifacts',
        sliceProvider,
        featureComputer,
        simulator,
        summaryIngester: { ingest: vi.fn() },
      });

      expect(result.summaries).toEqual([]);
      expect(simulator.simulate).toHaveBeenCalled();
    });
  });

  describe('Summary Ingestion', () => {
    it('CRITICAL: Should not call ingester when no summaries', async () => {
      const summaryIngester: SummaryIngester = {
        ingest: vi.fn(),
      };

      await runSimPresets({
        presets: [],
        tokenSets: {},
        artifactRootDir: '/artifacts',
        sliceProvider: { getCandleSlice: vi.fn() },
        featureComputer: { computeFeatures: vi.fn() },
        simulator: { simulate: vi.fn() },
        summaryIngester,
      });

      expect(summaryIngester.ingest).not.toHaveBeenCalled();
    });

    it('CRITICAL: Should call ingester with all summaries', async () => {
      const preset: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'test',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'tokens.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const summary = {
        runId: 'test',
        preset: 'test',
        dataset: 'candles_1m',
        chain: 'sol',
        interval: '1m',
        startIso: '2024-12-01T00:00:00Z',
        endIso: '2024-12-02T00:00:00Z',
        tokens: 1,
        trades: 0,
        pnlQuote: 0,
        maxDrawdownQuote: 0,
        winRate: 0,
        featureSetId: 'test',
        artifactDir: '/artifacts',
      };

      const summaryIngester: SummaryIngester = {
        ingest: vi.fn(),
      };

      await runSimPresets({
        presets: [preset],
        tokenSets: { 'tokens.txt': ['So11111111111111111111111111111111111111112'] },
        artifactRootDir: '/artifacts',
        sliceProvider: {
          getCandleSlice: vi.fn().mockResolvedValue({
            sliceManifestPath: '/manifest.json',
            artifacts: [],
          }),
        },
        featureComputer: {
          computeFeatures: vi.fn().mockResolvedValue({
            featureSetId: 'test',
            featuresParquetPath: '/features.parquet',
            artifacts: [],
          }),
        },
        simulator: {
          simulate: vi.fn().mockResolvedValue({
            summary,
            artifacts: [],
          }),
        },
        summaryIngester,
      });

      expect(summaryIngester.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          summaries: [summary],
        })
      );
    });
  });

  describe('Artifact Collection', () => {
    it('CRITICAL: Should collect artifacts from all adapters', async () => {
      const preset: SimPresetV1 = {
        kind: 'sim_preset_v1',
        name: 'test',
        data: {
          dataset: 'candles_1m',
          chain: 'sol',
          interval: '1m',
          time_range: { start: '2024-12-01T00:00:00Z', end: '2024-12-02T00:00:00Z' },
          tokens_file: 'tokens.txt',
        },
        features: { timeframe: '1m', groups: [] },
        strategy: { entries: [], exits: [] },
        risk: {
          position_size: { mode: 'fixed_quote', quote: 1000 },
          stop_loss: { mode: 'fixed_percent', percent: -0.05 },
          take_profit: { mode: 'fixed_percent', percent: 0.1 },
        },
      };

      const sliceArtifacts = [{ kind: 'manifest_json' as const, path: '/manifest.json' }];
      const featureArtifacts = [{ kind: 'parquet' as const, path: '/features.parquet' }];
      const simArtifacts = [{ kind: 'json' as const, path: '/summary.json' }];

      const result = await runSimPresets({
        presets: [preset],
        tokenSets: { 'tokens.txt': ['So11111111111111111111111111111111111111112'] },
        artifactRootDir: '/artifacts',
        sliceProvider: {
          getCandleSlice: vi.fn().mockResolvedValue({
            sliceManifestPath: '/manifest.json',
            artifacts: sliceArtifacts,
          }),
        },
        featureComputer: {
          computeFeatures: vi.fn().mockResolvedValue({
            featureSetId: 'test',
            featuresParquetPath: '/features.parquet',
            artifacts: featureArtifacts,
          }),
        },
        simulator: {
          simulate: vi.fn().mockResolvedValue({
            summary: {
              runId: 'test',
              preset: 'test',
              dataset: 'candles_1m',
              chain: 'sol',
              interval: '1m',
              startIso: '2024-12-01T00:00:00Z',
              endIso: '2024-12-02T00:00:00Z',
              tokens: 1,
              trades: 0,
              pnlQuote: 0,
              maxDrawdownQuote: 0,
              winRate: 0,
              featureSetId: 'test',
              artifactDir: '/artifacts',
            },
            artifacts: simArtifacts,
          }),
        },
        summaryIngester: { ingest: vi.fn() },
      });

      expect(result.artifacts).toEqual([...sliceArtifacts, ...featureArtifacts, ...simArtifacts]);
    });
  });
});
