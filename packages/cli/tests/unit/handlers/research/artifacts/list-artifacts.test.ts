/**
 * List Artifacts Handler Tests (Research Package)
 *
 * Tests for list-artifacts handler following CLI handler pattern:
 * - Pure function (no side effects)
 * - Depends only on ports
 * - Can be called with plain objects (REPL-friendly)
 * - Propagates errors (no try/catch)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listResearchArtifactsHandler } from '../../../../../src/handlers/research/artifacts/list-artifacts.js';
import type { ArtifactStorePort, ArtifactManifestRecord } from '@quantbot/core';
import type { CommandContext } from '../../../../../src/core/command-context.js';

describe('listResearchArtifactsHandler', () => {
  // Mock artifact records
  const mockArtifacts: ArtifactManifestRecord[] = [
    {
      artifactId: '88f07b79-621c-4d6b-ae39-a2c71c995703',
      artifactType: 'alerts_v1',
      schemaVersion: 1,
      logicalKey: 'day=2025-05-01/chain=solana',
      status: 'active',
      pathParquet: '/path/to/artifact.parquet',
      pathSidecar: '/path/to/artifact.json',
      fileHash: 'abc123',
      contentHash: 'def456',
      rowCount: 40,
      createdAt: '2026-01-27T07:04:10.779624Z',
    },
    {
      artifactId: '7a1c3f29-8d45-4e2b-9f12-b3c4d5e6f789',
      artifactType: 'alerts_v1',
      schemaVersion: 1,
      logicalKey: 'day=2025-05-02/chain=solana',
      status: 'active',
      pathParquet: '/path/to/artifact2.parquet',
      pathSidecar: '/path/to/artifact2.json',
      fileHash: 'ghi789',
      contentHash: 'jkl012',
      rowCount: 35,
      createdAt: '2026-01-28T08:15:20.123456Z',
    },
  ];

  let mockArtifactStore: ArtifactStorePort;
  let mockContext: CommandContext;

  beforeEach(() => {
    // Create mock artifact store
    mockArtifactStore = {
      listArtifacts: vi.fn().mockResolvedValue(mockArtifacts),
      getArtifact: vi.fn(),
      findByLogicalKey: vi.fn(),
      publishArtifact: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
      supersede: vi.fn(),
    };

    // Create mock context
    mockContext = {
      services: {
        artifactStore: () => mockArtifactStore,
      },
    } as unknown as CommandContext;
  });

  it('should list all artifacts with default limit', async () => {
    const result = await listResearchArtifactsHandler({}, mockContext);

    expect(result.artifacts).toEqual(mockArtifacts);
    expect(result.total).toBe(2);
    expect(mockArtifactStore.listArtifacts).toHaveBeenCalledWith({
      artifactType: undefined,
      status: undefined,
      limit: 100,
    });
  });

  it('should filter by artifact type', async () => {
    const result = await listResearchArtifactsHandler({ type: 'alerts_v1' }, mockContext);

    expect(result.artifacts).toEqual(mockArtifacts);
    expect(result.total).toBe(2);
    expect(mockArtifactStore.listArtifacts).toHaveBeenCalledWith({
      artifactType: 'alerts_v1',
      status: undefined,
      limit: 100,
    });
  });

  it('should filter by status', async () => {
    const result = await listResearchArtifactsHandler({ status: 'active' }, mockContext);

    expect(result.artifacts).toEqual(mockArtifacts);
    expect(result.total).toBe(2);
    expect(mockArtifactStore.listArtifacts).toHaveBeenCalledWith({
      artifactType: undefined,
      status: 'active',
      limit: 100,
    });
  });

  it('should respect custom limit', async () => {
    const result = await listResearchArtifactsHandler({ limit: 10 }, mockContext);

    expect(result.artifacts).toEqual(mockArtifacts);
    expect(result.total).toBe(2);
    expect(mockArtifactStore.listArtifacts).toHaveBeenCalledWith({
      artifactType: undefined,
      status: undefined,
      limit: 10,
    });
  });

  it('should handle empty results', async () => {
    vi.mocked(mockArtifactStore.listArtifacts).mockResolvedValue([]);

    const result = await listResearchArtifactsHandler({}, mockContext);

    expect(result.artifacts).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should propagate errors from artifact store', async () => {
    const error = new Error('Database connection failed');
    vi.mocked(mockArtifactStore.listArtifacts).mockRejectedValue(error);

    await expect(listResearchArtifactsHandler({}, mockContext)).rejects.toThrow(
      'Database connection failed'
    );
  });

  // Litmus test: Can be called with plain objects (REPL-friendly)
  it('should be callable with plain objects (isolation test)', async () => {
    const plainContext = {
      services: {
        artifactStore: () => ({
          listArtifacts: async () => mockArtifacts,
        }),
      },
    };

    const result = await listResearchArtifactsHandler({}, plainContext as CommandContext);

    expect(result.artifacts).toEqual(mockArtifacts);
    expect(result.total).toBe(2);
  });

  // Parameter conversion test
  it('should handle all filter combinations', async () => {
    const result = await listResearchArtifactsHandler(
      {
        type: 'ohlcv_slice_v2',
        status: 'superseded',
        limit: 50,
      },
      mockContext
    );

    expect(mockArtifactStore.listArtifacts).toHaveBeenCalledWith({
      artifactType: 'ohlcv_slice_v2',
      status: 'superseded',
      limit: 50,
    });
  });
});
