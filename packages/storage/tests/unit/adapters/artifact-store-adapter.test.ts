import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactStoreAdapter } from '../../../src/adapters/artifact-store-adapter.js';
import type { PythonEngine } from '@quantbot/utils';
import { NotFoundError } from '@quantbot/infra/utils';

describe('ArtifactStoreAdapter', () => {
  let mockPythonEngine: PythonEngine;
  let adapter: ArtifactStoreAdapter;

  const manifestDb = '/tmp/test-manifest.sqlite';
  const artifactsRoot = '/tmp/test-artifacts';

  beforeEach(() => {
    mockPythonEngine = {
      runScriptWithStdin: vi.fn(),
    } as unknown as PythonEngine;

    adapter = new ArtifactStoreAdapter(manifestDb, artifactsRoot, mockPythonEngine);
  });

  describe('getArtifact', () => {
    it('should get artifact by ID', async () => {
      const mockArtifact = {
        artifactId: 'test-123',
        artifactType: 'alerts_v1',
        schemaVersion: 1,
        logicalKey: 'day=2025-05-01/chain=solana',
        status: 'active' as const,
        pathParquet: '/path/to/artifact.parquet',
        pathSidecar: '/path/to/artifact.json',
        fileHash: 'abc123',
        contentHash: 'def456',
        rowCount: 100,
        minTs: null,
        maxTs: null,
        createdAt: '2026-01-28T00:00:00Z',
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockArtifact);

      const result = await adapter.getArtifact('test-123');

      expect(result).toEqual(mockArtifact);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('artifact_store_ops.py'),
        expect.objectContaining({
          operation: 'get_artifact',
          manifest_db: manifestDb,
          artifact_id: 'test-123',
        }),
        expect.any(Object)
      );
    });

    it('should throw NotFoundError when artifact not found', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValue(
        new Error('Artifact not found: invalid-id')
      );

      await expect(adapter.getArtifact('invalid-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listArtifacts', () => {
    it('should list artifacts with filters', async () => {
      const mockArtifacts = [
        {
          artifactId: 'test-1',
          artifactType: 'alerts_v1',
          schemaVersion: 1,
          logicalKey: 'day=2025-05-01/chain=solana',
          status: 'active' as const,
          pathParquet: '/path/to/artifact1.parquet',
          pathSidecar: '/path/to/artifact1.json',
          fileHash: 'abc123',
          contentHash: 'def456',
          rowCount: 100,
          minTs: null,
          maxTs: null,
          createdAt: '2026-01-28T00:00:00Z',
        },
        {
          artifactId: 'test-2',
          artifactType: 'alerts_v1',
          schemaVersion: 1,
          logicalKey: 'day=2025-05-02/chain=solana',
          status: 'active' as const,
          pathParquet: '/path/to/artifact2.parquet',
          pathSidecar: '/path/to/artifact2.json',
          fileHash: 'ghi789',
          contentHash: 'jkl012',
          rowCount: 50,
          minTs: null,
          maxTs: null,
          createdAt: '2026-01-28T01:00:00Z',
        },
      ];

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockArtifacts);

      const result = await adapter.listArtifacts({
        artifactType: 'alerts_v1',
        status: 'active',
        limit: 10,
      });

      expect(result).toEqual(mockArtifacts);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('artifact_store_ops.py'),
        expect.objectContaining({
          operation: 'list_artifacts',
          manifest_db: manifestDb,
          filter: {
            artifactType: 'alerts_v1',
            status: 'active',
            limit: 10,
          },
        }),
        expect.any(Object)
      );
    });
  });

  describe('findByLogicalKey', () => {
    it('should find artifacts by logical key', async () => {
      const mockArtifacts = [
        {
          artifactId: 'test-123',
          artifactType: 'alerts_v1',
          schemaVersion: 1,
          logicalKey: 'day=2025-05-01/chain=solana',
          status: 'active' as const,
          pathParquet: '/path/to/artifact.parquet',
          pathSidecar: '/path/to/artifact.json',
          fileHash: 'abc123',
          contentHash: 'def456',
          rowCount: 100,
          minTs: null,
          maxTs: null,
          createdAt: '2026-01-28T00:00:00Z',
        },
      ];

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockArtifacts);

      const result = await adapter.findByLogicalKey('alerts_v1', 'day=2025-05-01/chain=solana');

      expect(result).toEqual(mockArtifacts);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('artifact_store_ops.py'),
        expect.objectContaining({
          operation: 'find_by_logical_key',
          manifest_db: manifestDb,
          artifact_type: 'alerts_v1',
          logical_key: 'day=2025-05-01/chain=solana',
        }),
        expect.any(Object)
      );
    });
  });

  describe('publishArtifact', () => {
    it('should publish new artifact', async () => {
      const mockResult = {
        success: true,
        deduped: false,
        artifactId: 'new-artifact-123',
        pathParquet: '/path/to/new-artifact.parquet',
        pathSidecar: '/path/to/new-artifact.json',
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockResult);

      const result = await adapter.publishArtifact({
        artifactType: 'alerts_v1',
        schemaVersion: 1,
        logicalKey: 'day=2025-05-03/chain=solana',
        dataPath: '/tmp/data.csv',
        writerName: 'test-writer',
        writerVersion: '1.0.0',
        gitCommit: 'abc123',
        gitDirty: false,
      });

      expect(result.success).toBe(true);
      expect(result.deduped).toBe(false);
      expect(result.artifactId).toBe('new-artifact-123');
    });

    it('should detect deduplication', async () => {
      const mockResult = {
        success: true,
        deduped: true,
        mode: 'content_hash' as const,
        existingArtifactId: 'existing-123',
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockResult);

      const result = await adapter.publishArtifact({
        artifactType: 'alerts_v1',
        schemaVersion: 1,
        logicalKey: 'day=2025-05-03/chain=solana',
        dataPath: '/tmp/data.csv',
        writerName: 'test-writer',
        writerVersion: '1.0.0',
        gitCommit: 'abc123',
        gitDirty: false,
      });

      expect(result.success).toBe(true);
      expect(result.deduped).toBe(true);
      expect(result.existingArtifactId).toBe('existing-123');
    });
  });

  describe('getLineage', () => {
    it('should get artifact lineage', async () => {
      const mockLineage = {
        artifactId: 'test-123',
        inputs: [
          {
            artifactId: 'input-1',
            artifactType: 'alerts_v1',
            schemaVersion: 1,
            logicalKey: 'day=2025-05-01/chain=solana',
            status: 'active' as const,
            pathParquet: '/path/to/input1.parquet',
            pathSidecar: '/path/to/input1.json',
            fileHash: 'abc123',
            contentHash: 'def456',
            rowCount: 100,
            minTs: null,
            maxTs: null,
            createdAt: '2026-01-28T00:00:00Z',
          },
        ],
        depth: 1,
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockLineage);

      const result = await adapter.getLineage('test-123');

      expect(result).toEqual(mockLineage);
      expect(result.inputs).toHaveLength(1);
    });
  });

  describe('getDownstream', () => {
    it('should get downstream artifacts', async () => {
      const mockDownstream = [
        {
          artifactId: 'downstream-1',
          artifactType: 'experiment_trades',
          schemaVersion: 1,
          logicalKey: 'experiment=exp-123/trades',
          status: 'active' as const,
          pathParquet: '/path/to/downstream1.parquet',
          pathSidecar: '/path/to/downstream1.json',
          fileHash: 'abc123',
          contentHash: 'def456',
          rowCount: 200,
          minTs: null,
          maxTs: null,
          createdAt: '2026-01-28T02:00:00Z',
        },
      ];

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockDownstream);

      const result = await adapter.getDownstream('test-123');

      expect(result).toEqual(mockDownstream);
      expect(result).toHaveLength(1);
    });
  });

  describe('supersede', () => {
    it('should supersede old artifact', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      await adapter.supersede('new-123', 'old-123');

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('artifact_store_ops.py'),
        expect.objectContaining({
          operation: 'supersede',
          manifest_db: manifestDb,
          new_artifact_id: 'new-123',
          old_artifact_id: 'old-123',
        }),
        expect.any(Object)
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when artifact store is available', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ available: true });

      const result = await adapter.isAvailable();

      expect(result).toBe(true);
    });

    it('should return false when artifact store is not available', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValue(
        new Error('Connection failed')
      );

      const result = await adapter.isAvailable();

      expect(result).toBe(false);
    });
  });
});

