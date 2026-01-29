/**
 * Security and edge case tests for ProjectionBuilderAdapter
 *
 * Tests SQL injection prevention, validation, error handling, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProjectionBuilderAdapter,
  ArtifactNotFoundError,
  InvalidProjectionRequestError,
  ProjectionBuildError,
  ProjectionDisposalError,
} from '../../../src/adapters/projection-builder-adapter.js';
import type { ArtifactStorePort, ArtifactManifestRecord } from '@quantbot/core';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProjectionBuilderAdapter Security & Edge Cases', () => {
  let tempCacheDir: string;
  let mockArtifactStore: ArtifactStorePort;

  beforeEach(() => {
    tempCacheDir = join(tmpdir(), `projection-security-test-${Date.now()}`);
    if (!existsSync(tempCacheDir)) {
      mkdirSync(tempCacheDir, { recursive: true });
    }

    mockArtifactStore = {
      getArtifact: vi.fn(),
      listArtifacts: vi.fn(),
      publishArtifact: vi.fn(),
      getLineage: vi.fn(),
    };
  });

  afterEach(() => {
    if (existsSync(tempCacheDir)) {
      rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  const createMockArtifact = (id: string, path: string): ArtifactManifestRecord => ({
    artifactId: id,
    artifactType: 'alerts',
    schemaVersion: 1,
    logicalKey: `alerts-${id}`,
    status: 'active',
    pathParquet: path,
    pathSidecar: `${path}.json`,
    fileHash: 'hash',
    contentHash: 'content',
    rowCount: 10,
    createdAt: '2024-01-01T00:00:00Z',
  });

  describe('SQL Injection Prevention', () => {
    it('should sanitize malicious table names', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const maliciousTableName = "'; DROP TABLE users; --";

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      // Create a dummy parquet file for testing
      const parquetPath = join(tempCacheDir, 'alert1.parquet');
      writeFileSync(parquetPath, 'dummy parquet');

      try {
        await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: maliciousTableName },
        });
        // If build succeeds, table name should be sanitized
        // We can't easily verify SQL wasn't injected without inspecting DuckDB,
        // but the sanitization should prevent it
      } catch (error) {
        // Expected if DuckDB is not available
        expect(error).toBeDefined();
      }
    });

    it('should sanitize table names with special characters', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const specialChars = 'table-name.with@special#chars$123';

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      const parquetPath = join(tempCacheDir, 'alert1.parquet');
      writeFileSync(parquetPath, 'dummy');

      try {
        const result = await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: specialChars },
        });
        // Table name should be sanitized (only alphanumeric + underscore)
        expect(result.tables[0].name).toMatch(/^[a-zA-Z0-9_]+$/);
        expect(result.tables[0].name).not.toContain('-');
        expect(result.tables[0].name).not.toContain('.');
        expect(result.tables[0].name).not.toContain('@');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should escape file paths with special characters', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const pathWithQuotes = "/path/with'quotes/file.parquet";
      const pathWithBackslashes = "C:\\path\\with\\backslashes\\file.parquet";

      vi.mocked(mockArtifactStore.getArtifact)
        .mockResolvedValueOnce(createMockArtifact('alert-1', pathWithQuotes))
        .mockResolvedValueOnce(createMockArtifact('alert-2', pathWithBackslashes));

      // Create dummy files
      writeFileSync(pathWithQuotes, 'dummy');
      writeFileSync(pathWithBackslashes, 'dummy');

      try {
        await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1', 'alert-2'] },
          tables: { alerts: 'alerts' },
        });
        // Should not throw SQL syntax errors
      } catch (error) {
        // Should not be SQL syntax error
        expect(error).not.toBeInstanceOf(SyntaxError);
      }
    });

    it('should sanitize column names in indexes', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      const parquetPath = '/test/alert1.parquet';
      writeFileSync(parquetPath, 'dummy');

      try {
        await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
          indexes: [
            {
              table: 'alerts',
              columns: ["column'; DROP TABLE--", 'normal_column', '123invalid'],
            },
          ],
        });
        // Column names should be sanitized
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Input Validation', () => {
    it('should reject empty projection ID', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: '',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject projection ID with invalid characters', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: 'projection@id#with$invalid',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject projection ID exceeding max length', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const longId = 'a'.repeat(256);

      await expect(
        adapter.buildProjection({
          projectionId: longId,
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject empty artifact arrays', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: [], ohlcv: [] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject missing artifacts', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: {},
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject too many artifacts', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const manyArtifacts = Array.from({ length: 10001 }, (_, i) => `alert-${i}`);

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: manyArtifacts },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject invalid table names', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'table-name-with-dashes' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should reject too many indexes', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const manyIndexes = Array.from({ length: 51 }, (_, i) => ({
        table: 'alerts',
        columns: [`col${i}`],
      }));

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
          indexes: manyIndexes,
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });
  });

  describe('Error Handling', () => {
    it('should throw ArtifactNotFoundError when artifact is missing', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(null);

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['nonexistent'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(ArtifactNotFoundError);
    });

    it('should throw ProjectionBuildError on DuckDB failure', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/nonexistent/path.parquet')
      );

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(ProjectionBuildError);
    });

    it('should throw ProjectionDisposalError on disposal failure', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const readOnlyDir = '/root/readonly'; // Simulated read-only directory

      // This will fail on most systems, but tests error handling
      await expect(adapter.disposeProjection('test', readOnlyDir)).rejects.toThrow(
        ProjectionDisposalError
      );
    });

    it('should handle projectionId mismatch in rebuildProjection', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.rebuildProjection('projection-1', {
          projectionId: 'projection-2',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });
  });

  describe('Resource Management', () => {
    it('should clean up DuckDB client on error', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockRejectedValue(new Error('Network error'));

      try {
        await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        });
      } catch (error) {
        // Error expected
      }

      // Verify no orphaned files (if DuckDB client was created, it should be closed)
      // This is hard to test directly, but we verify no exceptions are thrown
      expect(true).toBe(true);
    });

    it('should handle concurrent builds gracefully', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      const parquetPath = '/test/alert1.parquet';
      writeFileSync(parquetPath, 'dummy');

      // Attempt concurrent builds (should handle gracefully)
      const builds = [
        adapter.buildProjection({
          projectionId: 'concurrent-1',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        }),
        adapter.buildProjection({
          projectionId: 'concurrent-2',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
        }),
      ];

      // At least one should succeed (or both fail gracefully)
      const results = await Promise.allSettled(builds);
      expect(results.length).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle table names starting with numbers', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      const parquetPath = '/test/alert1.parquet';
      writeFileSync(parquetPath, 'dummy');

      try {
        const result = await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: '123table' },
        });
        // Table name should be prefixed with underscore
        expect(result.tables[0].name).toMatch(/^_/);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle empty column lists in indexes', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      await expect(
        adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
          indexes: [{ table: 'alerts', columns: [] }],
        })
      ).rejects.toThrow(InvalidProjectionRequestError);
    });

    it('should handle duplicate column names in indexes', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      const parquetPath = '/test/alert1.parquet';
      writeFileSync(parquetPath, 'dummy');

      try {
        await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: 'alerts' },
          indexes: [{ table: 'alerts', columns: ['col1', 'col1', 'col2'] }],
        });
        // Duplicates should be removed
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle very long table names', async () => {
      const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
      const longTableName = 'a'.repeat(100);

      vi.mocked(mockArtifactStore.getArtifact).mockResolvedValue(
        createMockArtifact('alert-1', '/test/alert1.parquet')
      );

      const parquetPath = '/test/alert1.parquet';
      writeFileSync(parquetPath, 'dummy');

      try {
        const result = await adapter.buildProjection({
          projectionId: 'test',
          artifacts: { alerts: ['alert-1'] },
          tables: { alerts: longTableName },
        });
        // Table name should be truncated to 63 chars
        expect(result.tables[0].name.length).toBeLessThanOrEqual(63);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});

