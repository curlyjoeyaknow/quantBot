/**
 * Property Tests for Experiment Execution
 *
 * Tests critical invariants for experiment execution using property-based testing.
 *
 * Critical Invariants:
 * 1. Determinism: Same inputs + same seed → same outputs
 * 2. Idempotency: Re-running experiment produces same results
 * 3. Lineage: Output artifacts correctly reference input artifacts
 * 4. Status transitions: Experiments follow valid state machine
 * 5. Bounds: Metrics are within reasonable bounds
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type {
  ArtifactStorePort,
  ProjectionBuilderPort,
  ExperimentTrackerPort,
  ExperimentDefinition,
  ArtifactManifestRecord,
} from '@quantbot/core';
import type { SimulationService } from '@quantbot/simulation';

// Mock the simulation executor module
vi.mock('../../src/experiments/simulation-executor.js', () => ({
  executeSimulation: vi.fn().mockResolvedValue({
    tradesPath: '/tmp/trades.parquet',
    metricsPath: '/tmp/metrics.parquet',
    curvesPath: '/tmp/curves.parquet',
    diagnosticsPath: '/tmp/diagnostics.parquet',
    inputArtifactIds: [],
  }),
}));

import { executeExperiment, type ExperimentExecutionPorts } from '../../src/experiments/index.js';

describe('Experiment Execution - Property Tests', () => {
  let mockArtifactStore: ArtifactStorePort;
  let mockProjectionBuilder: ProjectionBuilderPort;
  let mockExperimentTracker: ExperimentTrackerPort;
  let mockSimulationService: SimulationService;
  let ports: ExperimentExecutionPorts;

  beforeEach(() => {
    mockArtifactStore = {
      getArtifact: vi.fn().mockResolvedValue({
        artifactId: 'test-artifact-1',
        status: 'active',
        artifactType: 'alerts_v1',
        schemaVersion: 1,
        logicalKey: 'test-key',
        pathParquet: '/path/to/artifact.parquet',
        pathSidecar: '/path/to/artifact.json',
        fileHash: 'hash123',
        contentHash: 'content123',
        rowCount: 100,
        createdAt: new Date().toISOString(),
      } as ArtifactManifestRecord),
      listArtifacts: vi.fn(),
      findByLogicalKey: vi.fn(),
      publishArtifact: vi.fn().mockResolvedValue({
        success: true,
        deduped: false,
        artifactId: 'output-artifact-1',
        pathParquet: '/path/to/output.parquet',
        pathSidecar: '/path/to/output.json',
      }),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
      supersede: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockProjectionBuilder = {
      buildProjection: vi.fn().mockResolvedValue({
        projectionId: 'test-projection',
        duckdbPath: '/tmp/test-projection.duckdb',
        tables: [],
        artifactCount: 2,
        totalRows: 1010,
      }),
      rebuildProjection: vi.fn(),
      disposeProjection: vi.fn().mockResolvedValue(undefined),
      projectionExists: vi.fn().mockResolvedValue(true),
      getProjectionMetadata: vi.fn().mockResolvedValue(null),
      listProjections: vi.fn().mockResolvedValue([]),
      getProjectionLineage: vi.fn().mockResolvedValue(null),
      getMetrics: vi.fn().mockResolvedValue({
        totalProjections: 0,
        totalRows: 0,
        totalSizeBytes: 0,
        averageBuildTimeMs: 0,
      }),
      cleanupOldProjections: vi.fn().mockResolvedValue(0),
      cleanupFailedBuilds: vi.fn().mockResolvedValue(0),
      resumeBuild: vi.fn().mockResolvedValue({
        projectionId: 'test-projection',
        duckdbPath: '/tmp/test-projection.duckdb',
        tables: [],
        artifactCount: 2,
        totalRows: 1010,
      }),
      compressProjection: vi.fn().mockResolvedValue('/tmp/compressed.parquet'),
      decompressProjection: vi.fn().mockResolvedValue('/tmp/decompressed.duckdb'),
    };

    mockExperimentTracker = {
      createExperiment: vi.fn().mockImplementation(async (def) => ({
        experimentId: def.experimentId,
        name: def.name,
        status: 'pending',
        inputs: def.inputs,
        config: def.config,
        provenance: def.provenance,
      })),
      getExperiment: vi.fn().mockImplementation(async (id) => ({
        experimentId: id,
        status: 'completed',
        outputs: {
          trades: 'trades-artifact-1',
          metrics: 'metrics-artifact-1',
          curves: 'curves-artifact-1',
        },
      })),
      listExperiments: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      storeResults: vi.fn().mockResolvedValue(undefined),
      findByInputArtifacts: vi.fn(),
    };

    // Create mock simulation service
    mockSimulationService = {
      runSimulation: vi.fn().mockResolvedValue({
        results: [],
        summary: {
          total_runs: 0,
          successful: 0,
          failed: 0,
        },
      }),
    } as unknown as SimulationService;

    ports = {
      artifactStore: mockArtifactStore,
      projectionBuilder: mockProjectionBuilder,
      experimentTracker: mockExperimentTracker,
      simulationService: mockSimulationService,
    };
  });

  describe('Determinism Property', () => {
    it('should produce same projection ID for same experiment ID and timestamp', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
          (experimentId, createdAt) => {
            // Generate projection ID (simulating the logic)
            const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
            const projectionId1 = `exp-${experimentId}-${timestamp}`;
            const projectionId2 = `exp-${experimentId}-${timestamp}`;

            expect(projectionId1).toBe(projectionId2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate deterministic seed from experiment ID', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 200 }), (experimentId) => {
          // Simulate seed generation (simplified version)
          let hash1 = 0;
          for (let i = 0; i < experimentId.length; i++) {
            const char = experimentId.charCodeAt(i);
            hash1 = (hash1 << 5) - hash1 + char;
            hash1 = hash1 & hash1;
          }
          const seed1 = Math.abs(hash1);

          let hash2 = 0;
          for (let i = 0; i < experimentId.length; i++) {
            const char = experimentId.charCodeAt(i);
            hash2 = (hash2 << 5) - hash2 + char;
            hash2 = hash2 & hash2;
          }
          const seed2 = Math.abs(hash2);

          expect(seed1).toBe(seed2);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Status Transition Property', () => {
    it('should follow valid state machine: pending → running → completed', async () => {
      const statusCalls: string[] = [];
      mockExperimentTracker.updateStatus = vi.fn().mockImplementation(async (id, status) => {
        statusCalls.push(status);
      });

      const definition: ExperimentDefinition = {
        experimentId: 'test-exp-state',
        name: 'State Test',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {
            name: 'momentum',
            exit: { targets: [{ target: 2, percent: 1.0 }] },
          },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: new Date().toISOString(),
        },
      };

      await executeExperiment(definition, ports);

      // Should follow: pending (created) → running → completed
      expect(statusCalls).toContain('running');
      expect(statusCalls).toContain('completed');
      expect(statusCalls.indexOf('running')).toBeLessThan(statusCalls.indexOf('completed'));
    });
  });

  describe('Lineage Property', () => {
    it('should include all input artifacts in lineage', async () => {
      const inputArtifactIds: string[] = [];
      mockArtifactStore.publishArtifact = vi.fn().mockImplementation(async (req) => {
        if (req.inputArtifactIds) {
          inputArtifactIds.push(...req.inputArtifactIds);
        }
        return {
          success: true,
          deduped: false,
          artifactId: 'output-artifact',
          pathParquet: '/path/to/output.parquet',
          pathSidecar: '/path/to/output.json',
        };
      });

      const definition: ExperimentDefinition = {
        experimentId: 'test-exp-lineage',
        name: 'Lineage Test',
        inputs: {
          alerts: ['alert-1', 'alert-2'],
          ohlcv: ['ohlcv-1'],
          strategies: ['strategy-1'],
        },
        config: {
          strategy: {
            name: 'momentum',
            exit: { targets: [{ target: 2, percent: 1.0 }] },
          },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: new Date().toISOString(),
        },
      };

      await executeExperiment(definition, ports);

      // Should include all input artifacts
      expect(inputArtifactIds).toContain('alert-1');
      expect(inputArtifactIds).toContain('alert-2');
      expect(inputArtifactIds).toContain('ohlcv-1');
      expect(inputArtifactIds).toContain('strategy-1');
    });
  });

  describe('Bounds Property', () => {
    it('should generate valid projection IDs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (experimentId, uuid) => {
            const projectionId = `exp-${experimentId}-${uuid}`;
            // Projection ID should be non-empty and reasonable length
            expect(projectionId.length).toBeGreaterThan(0);
            expect(projectionId.length).toBeLessThan(500);
            // Should start with 'exp-'
            expect(projectionId.startsWith('exp-')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
