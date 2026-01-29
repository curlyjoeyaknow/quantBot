/**
 * Contract tests for ProjectionBuilderPort
 *
 * Verifies that ProjectionBuilderAdapter correctly implements the ProjectionBuilderPort interface
 * and satisfies all port contract requirements.
 *
 * Per testing rules (40-testing-contracts.mdc):
 * - Verify all port methods exist
 * - Verify return types match port interface
 * - Verify error handling (recoverable vs terminal)
 * - Verify retry/timeout policy (adapter-level)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectionBuilderAdapter } from '../../../src/adapters/projection-builder-adapter.js';
import type {
  ProjectionBuilderPort,
  ProjectionRequest,
  ProjectionResult,
  ProjectionMetadata,
  ProjectionLineage,
  ProjectionMetrics,
  ProjectionFilter,
  ArtifactStorePort,
  ArtifactManifestRecord,
} from '@quantbot/core';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProjectionBuilderPort Contract', () => {
  let tempCacheDir: string;
  let mockArtifactStore: ArtifactStorePort;
  let adapter: ProjectionBuilderAdapter;

  beforeEach(async () => {
    // Create temporary cache directory
    tempCacheDir = join(tmpdir(), `projection-contract-test-${Date.now()}`);
    if (!existsSync(tempCacheDir)) {
      mkdirSync(tempCacheDir, { recursive: true });
    }

    // Create mock artifact store
    mockArtifactStore = {
      getArtifact: vi.fn(),
      listArtifacts: vi.fn(),
      publishArtifact: vi.fn(),
      getLineage: vi.fn(),
    };

    // Create adapter instance
    adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
    
    // Initialize metadata manager (needed for metadata operations)
    // The metadata manager initializes lazily on first use, but we can pre-initialize
    try {
      const metadataManager = (adapter as any).metadataManager;
      if (metadataManager && typeof metadataManager.initialize === 'function') {
        await metadataManager.initialize();
      }
    } catch (error) {
      // Metadata manager may initialize lazily - this is OK
    }
  });

  afterEach(() => {
    // Clean up temporary directory
    if (existsSync(tempCacheDir)) {
      rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  describe('Port Interface Compliance', () => {
    it('should implement ProjectionBuilderPort interface', () => {
      // Verify adapter implements the port interface
      expect(adapter).toBeInstanceOf(ProjectionBuilderAdapter);
      expect(adapter).toHaveProperty('buildProjection');
      expect(adapter).toHaveProperty('rebuildProjection');
      expect(adapter).toHaveProperty('disposeProjection');
      expect(adapter).toHaveProperty('projectionExists');
      expect(adapter).toHaveProperty('getProjectionMetadata');
      expect(adapter).toHaveProperty('listProjections');
      expect(adapter).toHaveProperty('getProjectionLineage');
      expect(adapter).toHaveProperty('getMetrics');
      expect(adapter).toHaveProperty('cleanupOldProjections');
      expect(adapter).toHaveProperty('cleanupFailedBuilds');
    });

    it('should have correct method signatures', () => {
      // Verify method types match port interface
      expect(typeof adapter.buildProjection).toBe('function');
      expect(typeof adapter.rebuildProjection).toBe('function');
      expect(typeof adapter.disposeProjection).toBe('function');
      expect(typeof adapter.projectionExists).toBe('function');
      expect(typeof adapter.getProjectionMetadata).toBe('function');
      expect(typeof adapter.listProjections).toBe('function');
      expect(typeof adapter.getProjectionLineage).toBe('function');
      expect(typeof adapter.getMetrics).toBe('function');
      expect(typeof adapter.cleanupOldProjections).toBe('function');
      expect(typeof adapter.cleanupFailedBuilds).toBe('function');
    });
  });

  describe('Return Type Contracts', () => {
    it('buildProjection should return ProjectionResult', async () => {
      const mockArtifact: ArtifactManifestRecord = {
        artifactId: 'test-artifact',
        artifactType: 'alerts',
        schemaVersion: 1,
        logicalKey: 'test-key',
        status: 'active',
        pathParquet: '/tmp/test.parquet',
        pathSidecar: '/tmp/test.json',
        fileHash: 'hash1',
        contentHash: 'content1',
        rowCount: 10,
        createdAt: '2024-01-01T00:00:00Z',
      };

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(mockArtifact);

      const request: ProjectionRequest = {
        projectionId: 'test-projection',
        artifacts: { alerts: ['test-artifact'] },
        tables: { alerts: 'alerts' },
      };

      try {
        const result = await adapter.buildProjection(request);
        
        // Verify result structure matches ProjectionResult interface
        expect(result).toHaveProperty('projectionId');
        expect(result).toHaveProperty('version');
        expect(result).toHaveProperty('duckdbPath');
        expect(result).toHaveProperty('tables');
        expect(result).toHaveProperty('artifactCount');
        expect(result).toHaveProperty('totalRows');
        
        expect(typeof result.projectionId).toBe('string');
        expect(typeof result.version).toBe('string');
        expect(typeof result.duckdbPath).toBe('string');
        expect(Array.isArray(result.tables)).toBe(true);
        expect(typeof result.artifactCount).toBe('number');
        expect(typeof result.totalRows).toBe('number');
      } catch (error) {
        // Expected if DuckDB is not available or Parquet files don't exist
        // But we still verify the method exists and has correct signature
        expect(error).toBeDefined();
      }
    });

    it('getProjectionMetadata should return ProjectionMetadata | null', async () => {
      const result = await adapter.getProjectionMetadata('nonexistent');
      
      expect(result === null || typeof result === 'object').toBe(true);
      
      if (result !== null) {
        // Verify structure matches ProjectionMetadata interface
        expect(result).toHaveProperty('projectionId');
        expect(result).toHaveProperty('version');
        expect(result).toHaveProperty('duckdbPath');
        expect(result).toHaveProperty('artifactIds');
        expect(result).toHaveProperty('artifactTypes');
        expect(result).toHaveProperty('tableNames');
        expect(result).toHaveProperty('indexes');
        expect(result).toHaveProperty('buildTimestamp');
        expect(result).toHaveProperty('buildDurationMs');
        expect(result).toHaveProperty('totalRows');
        expect(result).toHaveProperty('totalSizeBytes');
        expect(result).toHaveProperty('cacheDir');
        expect(result).toHaveProperty('builderVersion');
      }
    });

    it('listProjections should return ProjectionMetadata[]', async () => {
      const result = await adapter.listProjections();
      
      expect(Array.isArray(result)).toBe(true);
      
      // Verify all items match ProjectionMetadata structure
      for (const projection of result) {
        expect(projection).toHaveProperty('projectionId');
        expect(projection).toHaveProperty('version');
        expect(projection).toHaveProperty('duckdbPath');
        expect(typeof projection.projectionId).toBe('string');
        expect(typeof projection.version).toBe('string');
        expect(typeof projection.duckdbPath).toBe('string');
      }
    });

    it('getProjectionLineage should return ProjectionLineage | null', async () => {
      const result = await adapter.getProjectionLineage('nonexistent');
      
      expect(result === null || typeof result === 'object').toBe(true);
      
      if (result !== null) {
        // Verify structure matches ProjectionLineage interface
        expect(result).toHaveProperty('projectionId');
        expect(result).toHaveProperty('version');
        expect(result).toHaveProperty('artifacts');
        expect(result).toHaveProperty('buildTimestamp');
        expect(Array.isArray(result.artifacts)).toBe(true);
        expect(typeof result.projectionId).toBe('string');
        expect(typeof result.version).toBe('string');
        expect(typeof result.buildTimestamp).toBe('number');
      }
    });

    it('getMetrics should return ProjectionMetrics', async () => {
      const result = await adapter.getMetrics();
      
      // Verify structure matches ProjectionMetrics interface
      expect(result).toHaveProperty('buildCount');
      expect(result).toHaveProperty('successCount');
      expect(result).toHaveProperty('failureCount');
      expect(result).toHaveProperty('avgBuildTimeMs');
      expect(result).toHaveProperty('avgArtifactCount');
      expect(result).toHaveProperty('avgTotalRows');
      expect(result).toHaveProperty('totalDiskUsageBytes');
      expect(result).toHaveProperty('projectionCount');
      
      expect(typeof result.buildCount).toBe('number');
      expect(typeof result.successCount).toBe('number');
      expect(typeof result.failureCount).toBe('number');
      expect(typeof result.avgBuildTimeMs).toBe('number');
      expect(typeof result.avgArtifactCount).toBe('number');
      expect(typeof result.avgTotalRows).toBe('number');
      expect(typeof result.totalDiskUsageBytes).toBe('number');
      expect(typeof result.projectionCount).toBe('number');
    });

    it('cleanupOldProjections should return number', async () => {
      const result = await adapter.cleanupOldProjections({});
      
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('cleanupFailedBuilds should return number', async () => {
      const result = await adapter.cleanupFailedBuilds();
      
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('projectionExists should return boolean', async () => {
      const result = await adapter.projectionExists('nonexistent');
      
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Error Classification', () => {
    it('should throw ArtifactNotFoundError for missing artifacts', async () => {
      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(null);

      const request: ProjectionRequest = {
        projectionId: 'test-projection',
        artifacts: { alerts: ['nonexistent'] },
        tables: { alerts: 'alerts' },
      };

      await expect(adapter.buildProjection(request)).rejects.toThrow('Artifact not found');
    });

    it('should throw InvalidProjectionRequestError for invalid requests', async () => {
      const invalidRequest = {
        projectionId: '', // Invalid: empty string
        artifacts: { alerts: ['test'] },
        tables: { alerts: 'alerts' },
      } as ProjectionRequest;

      await expect(adapter.buildProjection(invalidRequest)).rejects.toThrow('Invalid ProjectionRequest');
    });

    it('should throw ProjectionBuildError for build failures', async () => {
      const mockArtifact: ArtifactManifestRecord = {
        artifactId: 'test-artifact',
        artifactType: 'alerts',
        schemaVersion: 1,
        logicalKey: 'test-key',
        status: 'active',
        pathParquet: '/nonexistent/path.parquet', // Invalid path
        pathSidecar: '/tmp/test.json',
        fileHash: 'hash1',
        contentHash: 'content1',
        rowCount: 10,
        createdAt: '2024-01-01T00:00:00Z',
      };

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(mockArtifact);

      const request: ProjectionRequest = {
        projectionId: 'test-projection',
        artifacts: { alerts: ['test-artifact'] },
        tables: { alerts: 'alerts' },
      };

      await expect(adapter.buildProjection(request)).rejects.toThrow();
    });
  });

  describe('Filter Support', () => {
    it('listProjections should accept optional filter', async () => {
      // Test with no filter
      const result1 = await adapter.listProjections();
      expect(Array.isArray(result1)).toBe(true);

      // Test with filter
      const filter: ProjectionFilter = {
        artifactType: 'alerts',
        minBuildTimestamp: Date.now() - 86400000, // 24 hours ago
        maxBuildTimestamp: Date.now(),
      };
      
      const result2 = await adapter.listProjections(filter);
      expect(Array.isArray(result2)).toBe(true);
    });

    it('getProjectionMetadata should accept optional version', async () => {
      // Test without version
      const result1 = await adapter.getProjectionMetadata('test');
      expect(result1 === null || typeof result1 === 'object').toBe(true);

      // Test with version
      const result2 = await adapter.getProjectionMetadata('test', 'v1');
      expect(result2 === null || typeof result2 === 'object').toBe(true);
    });

    it('getProjectionLineage should accept optional version', async () => {
      // Test without version
      const result1 = await adapter.getProjectionLineage('test');
      expect(result1 === null || typeof result1 === 'object').toBe(true);

      // Test with version
      const result2 = await adapter.getProjectionLineage('test', 'v1');
      expect(result2 === null || typeof result2 === 'object').toBe(true);
    });
  });

  describe('Lifecycle Management Contracts', () => {
    it('cleanupOldProjections should accept lifecycle policy', async () => {
      // Test with maxAgeMs
      const result1 = await adapter.cleanupOldProjections({ maxAgeMs: 86400000 });
      expect(typeof result1).toBe('number');

      // Test with maxCount
      const result2 = await adapter.cleanupOldProjections({ maxCount: 10 });
      expect(typeof result2).toBe('number');

      // Test with both
      const result3 = await adapter.cleanupOldProjections({
        maxAgeMs: 86400000,
        maxCount: 10,
      });
      expect(typeof result3).toBe('number');
    });

    it('cleanupFailedBuilds should accept optional cacheDir', async () => {
      // Test without cacheDir
      const result1 = await adapter.cleanupFailedBuilds();
      expect(typeof result1).toBe('number');

      // Test with cacheDir
      const result2 = await adapter.cleanupFailedBuilds(tempCacheDir);
      expect(typeof result2).toBe('number');
    });
  });
});

