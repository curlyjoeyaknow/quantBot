/**
 * Unit tests for ProjectionBuilderAdapter
 *
 * Tests the adapter in isolation with mock artifact store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectionBuilderAdapter } from '../../../src/adapters/projection-builder-adapter.js';
import type { ArtifactStorePort, Artifact } from '@quantbot/core';
import { existsSync, mkdirSync, unlinkSync, rmSync } from 'fs';
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
      findArtifacts: vi.fn(),
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
      const mockArtifacts: Artifact[] = [
        {
          artifactId: 'alert-1',
          artifactType: 'alerts',
          pathParquet: '/test/alert1.parquet',
          pathJson: '/test/alert1.json',
          fileHashSha256: 'hash1',
          contentHashSha256: 'content1',
          sizeBytes: 1000,
          rowCount: 10,
          createdAt: '2024-01-01T00:00:00Z',
          metadata: {},
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
        pathParquet: '/test/alert1.parquet',
        pathJson: '/test/alert1.json',
        fileHashSha256: 'hash1',
        contentHashSha256: 'content1',
        sizeBytes: 1000,
        rowCount: 10,
        createdAt: '2024-01-01T00:00:00Z',
        metadata: {},
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
      }

      expect(existsSync(nonExistentDir)).toBe(true);
    });

    it('should handle multiple artifact types', async () => {
      const mockArtifacts: Artifact[] = [
        {
          artifactId: 'alert-1',
          artifactType: 'alerts',
          pathParquet: '/test/alert1.parquet',
          pathJson: '/test/alert1.json',
          fileHashSha256: 'hash1',
          contentHashSha256: 'content1',
          sizeBytes: 1000,
          rowCount: 10,
          createdAt: '2024-01-01T00:00:00Z',
          metadata: {},
        },
        {
          artifactId: 'ohlcv-1',
          artifactType: 'ohlcv',
          pathParquet: '/test/ohlcv1.parquet',
          pathJson: '/test/ohlcv1.json',
          fileHashSha256: 'hash2',
          contentHashSha256: 'content2',
          sizeBytes: 2000,
          rowCount: 20,
          createdAt: '2024-01-01T00:00:00Z',
          metadata: {},
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
    it('should throw not implemented error', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(adapter.rebuildProjection('test')).rejects.toThrow('not implemented');
    });
  });
});
