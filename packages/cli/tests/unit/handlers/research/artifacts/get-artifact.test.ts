/**
 * Get Artifact Handler Tests (Research Package)
 *
 * Tests for get-artifact handler following CLI handler pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResearchArtifactHandler } from '../../../../../src/handlers/research/artifacts/get-artifact.js';
import type { ArtifactStorePort, ArtifactManifestRecord } from '@quantbot/core';
import type { CommandContext } from '../../../../../src/core/command-context.js';

describe('getResearchArtifactHandler', () => {
  const mockArtifact: ArtifactManifestRecord = {
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
  };

  let mockArtifactStore: ArtifactStorePort;
  let mockContext: CommandContext;

  beforeEach(() => {
    mockArtifactStore = {
      getArtifact: vi.fn().mockResolvedValue(mockArtifact),
      listArtifacts: vi.fn(),
      findByLogicalKey: vi.fn(),
      publishArtifact: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
      supersede: vi.fn(),
    };

    mockContext = {
      services: {
        artifactStore: () => mockArtifactStore,
      },
    } as unknown as CommandContext;
  });

  it('should get artifact by ID', async () => {
    const result = await getResearchArtifactHandler(
      { artifactId: '88f07b79-621c-4d6b-ae39-a2c71c995703' },
      mockContext
    );

    expect(result.found).toBe(true);
    expect(result.artifact).toEqual(mockArtifact);
    expect(mockArtifactStore.getArtifact).toHaveBeenCalledWith(
      '88f07b79-621c-4d6b-ae39-a2c71c995703'
    );
  });

  it('should return null when artifact not found', async () => {
    const error = new Error('Artifact not found');
    vi.mocked(mockArtifactStore.getArtifact).mockRejectedValue(error);

    const result = await getResearchArtifactHandler({ artifactId: 'nonexistent-id' }, mockContext);

    expect(result.found).toBe(false);
    expect(result.artifact).toBeNull();
  });

  it('should propagate non-NotFound errors', async () => {
    const error = new Error('Database connection failed');
    vi.mocked(mockArtifactStore.getArtifact).mockRejectedValue(error);

    await expect(
      getResearchArtifactHandler({ artifactId: 'some-id' }, mockContext)
    ).rejects.toThrow('Database connection failed');
  });

  // Isolation test
  it('should be callable with plain objects', async () => {
    const plainContext = {
      services: {
        artifactStore: () => ({
          getArtifact: async () => mockArtifact,
        }),
      },
    };

    const result = await getResearchArtifactHandler(
      { artifactId: '88f07b79-621c-4d6b-ae39-a2c71c995703' },
      plainContext as CommandContext
    );

    expect(result.found).toBe(true);
    expect(result.artifact).toEqual(mockArtifact);
  });
});
