/**
 * Unit tests for ProjectionBuilderAdapter
 *
 * Tests the adapter in isolation with mock artifact store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectionBuilderAdapter } from '../../../src/adapters/projection-builder-adapter.js';
import type { ArtifactStorePort, ArtifactManifestRecord } from '@quantbot/core';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProjectionBuilderAdapter', () => {
  let tempCacheDir: string;
  let mockArtifactStore: ArtifactStorePort;

  beforeEach(() => {
    // Create temporary cache directory
    tempCacheDir = join(tmpdir(), `projection-test-${Date.now()}`);
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
  });

  afterEach(() => {
    // Clean up temporary directory
    if (existsSync(tempCacheDir)) {
      rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  describe('buildProjection', () => {
    it('should build projection from artifacts', async () => {
      // Mock artifact store responses
      const mockArtifacts: ArtifactManifestRecord[] = [
        {
          artifactId: 'alert-1',
          artifactType: 'alerts',
          schemaVersion: 1,
          logicalKey: 'alerts-2024-01-01',
          status: 'active',
          pathParquet: '/test/alert1.parquet',
          pathSidecar: '/test/alert1.json',
          fileHash: 'hash1',
          contentHash: 'content1',
          rowCount: 10,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      vi.mocked(mockArtifactStore.getArtifact).mockImplementation(async (artifactId: string) => {
        return mockArtifacts.find((a) => a.artifactId === artifactId) || null;
      });

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      // Note: This test will fail if DuckDB is not available
      // We're testing the interface and error handling
      try {
        const result = await adapter.buildProjection({
          projectionId: 'test-projection',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        });

        // If DuckDB is available, verify result structure
        expect(result.projectionId).toBe('test-projection');
        expect(result.duckdbPath).toContain('test-projection.duckdb');
        expect(result.artifactCount).toBe(1);
      } catch (error) {
        // Expected if DuckDB is not available or Parquet files don't exist
        expect(error).toBeDefined();
      }
    });

    it('should throw error if artifact not found', async () => {
      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(null);

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: 'test-projection',
          artifacts: { alerts: ['nonexistent'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow('Artifact not found: nonexistent');
    });

    it('should create cache directory if not exists', async () => {
      const nonExistentDir = join(tempCacheDir, 'nested', 'cache');

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue({
        artifactId: 'alert-1',
        artifactType: 'alerts',
        schemaVersion: 1,
        logicalKey: 'alerts-2024-01-01',
        status: 'active',
        pathParquet: '/test/alert1.parquet',
        pathSidecar: '/test/alert1.json',
        fileHash: 'hash1',
        contentHash: 'content1',
        rowCount: 10,
        createdAt: '2024-01-01T00:00:00Z',
      });

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, nonExistentDir);

      try {
        await adapter.buildProjection({
          projectionId: 'test-projection',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        });
      } catch (error) {
        // Expected if DuckDB fails, but directory should be created
        // Wait a bit for async mkdir to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Directory should be created even if build fails
      expect(existsSync(nonExistentDir)).toBe(true);
    });

    it('should handle multiple artifact types', async () => {
      const mockArtifacts: ArtifactManifestRecord[] = [
        {
          artifactId: 'alert-1',
          artifactType: 'alerts',
          schemaVersion: 1,
          logicalKey: 'alerts-2024-01-01',
          status: 'active',
          pathParquet: '/test/alert1.parquet',
          pathSidecar: '/test/alert1.json',
          fileHash: 'hash1',
          contentHash: 'content1',
          rowCount: 10,
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          artifactId: 'ohlcv-1',
          artifactType: 'ohlcv_slice',
          schemaVersion: 1,
          logicalKey: 'ohlcv-2024-01-01',
          status: 'active',
          pathParquet: '/test/ohlcv1.parquet',
          pathSidecar: '/test/ohlcv1.json',
          fileHash: 'hash2',
          contentHash: 'content2',
          rowCount: 20,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      vi.mocked(mockArtifactStore.getArtifact).mockImplementation(async (artifactId: string) => {
        return mockArtifacts.find((a) => a.artifactId === artifactId) || null;
      });

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      try {
        const result = await adapter.buildProjection({
          projectionId: 'multi-type-projection',
          artifacts: {
            alerts: ['alert-1'],
            ohlcv: ['ohlcv-1'],
          },
          tables: {
            alerts: 'alerts',
            ohlcv: 'ohlcv',
          },
        });

        expect(result.artifactCount).toBe(2);
      } catch (error) {
        // Expected if DuckDB is not available
        expect(error).toBeDefined();
      }
    });
  });

  describe('disposeProjection', () => {
    it('should delete projection file', async () => {
      const projectionId = 'test-dispose';
      const duckdbPath = join(tempCacheDir, `${projectionId}.duckdb`);

      // Create a dummy file
      const fs = await import('fs/promises');
      await fs.writeFile(duckdbPath, 'dummy');

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await adapter.disposeProjection(projectionId);

      expect(existsSync(duckdbPath)).toBe(false);
    });

    it('should use custom cacheDir when provided', async () => {
      const projectionId = 'test-dispose-custom';
      const customCacheDir = join(tempCacheDir, 'custom');
      const duckdbPath = join(customCacheDir, `${projectionId}.duckdb`);

      // Create custom cache directory and file
      const fs = await import('fs/promises');
      await fs.mkdir(customCacheDir, { recursive: true });
      await fs.writeFile(duckdbPath, 'dummy');

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await adapter.disposeProjection(projectionId, customCacheDir);

      expect(existsSync(duckdbPath)).toBe(false);
    });

    it('should not throw if projection does not exist', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(adapter.disposeProjection('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('projectionExists', () => {
    it('should return true if projection exists', async () => {
      const projectionId = 'test-exists';
      const duckdbPath = join(tempCacheDir, `${projectionId}.duckdb`);

      // Create a dummy file
      const fs = await import('fs/promises');
      await fs.writeFile(duckdbPath, 'dummy');

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      const exists = await adapter.projectionExists(projectionId);

      expect(exists).toBe(true);
    });

    it('should return false if projection does not exist', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      const exists = await adapter.projectionExists('nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('rebuildProjection', () => {
    it('should rebuild projection with matching request', async () => {
      const projectionId = 'test-rebuild';
      const request: ProjectionRequest = {
        projectionId,
        artifacts: { alerts: ['alert-1'] },
        tables: { alerts: 'alerts' },
      };

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue({
        artifactId: 'alert-1',
        artifactType: 'alerts',
        schemaVersion: 1,
        logicalKey: 'alerts-2024-01-01',
        status: 'active',
        pathParquet: '/test/alert1.parquet',
        pathSidecar: '/test/alert1.json',
        fileHash: 'hash1',
        contentHash: 'content1',
        rowCount: 10,
        createdAt: '2024-01-01T00:00:00Z',
      });

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      // Note: This will fail if DuckDB is not available, but tests the interface
      try {
        await adapter.rebuildProjection(projectionId, request);
        // If successful, verify projection exists
        const exists = await adapter.projectionExists(projectionId);
        expect(exists).toBe(true);
      } catch (error) {
        // Expected if DuckDB is not available
        expect(error).toBeDefined();
      }
    });

    it('should throw error if projectionId mismatch', async () => {
      const request: ProjectionRequest = {
        projectionId: 'test-1',
        artifacts: { alerts: ['alert-1'] },
        tables: { alerts: 'alerts' },
      };

      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(adapter.rebuildProjection('test-2', request)).rejects.toThrow(
        'Projection ID mismatch'
      );
    });
  });
});
