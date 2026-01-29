/**
 * Unit tests for alert quarantine
 */

import { describe, it, expect, vi } from 'vitest';
import { quarantineAlerts } from '../../../src/alerts/quarantine.js';
import type { InvalidAlert } from '../../../src/alerts/validate.js';
import type { CanonicalAlert } from '../../../src/alerts/normalize.js';
import type { ArtifactStorePort } from '@quantbot/core';

describe('quarantineAlerts', () => {
  const createInvalidAlert = (): InvalidAlert => ({
    alert: {
      alert_ts_utc: '2024-01-01T00:00:00.000Z',
      chain: 'solana',
      mint: 'So11111111111111111111111111111111111111112',
      alert_chat_id: 12345,
      alert_message_id: 67890,
      alert_id: 'test_alert_123',
      caller_name_norm: 'brook',
      caller_id: 'brook',
      mint_source: 'text',
      bot_name: 'phanes',
      run_id: 'test_run_123',
    },
    reason: 'Test validation error',
    code: 'invalid_mint_address',
  });

  it('should return empty result for no invalid alerts', async () => {
    const mockArtifactStore = {} as ArtifactStorePort;

    const result = await quarantineAlerts([], mockArtifactStore, '2024-01-01', 'solana', 'run_123');

    expect(result.count).toBe(0);
    expect(result.artifactId).toBeUndefined();
  });

  it('should publish quarantine artifact', async () => {
    const mockArtifactStore: ArtifactStorePort = {
      publishArtifact: vi.fn().mockResolvedValue({
        artifactId: 'quarantine_artifact_123',
        deduped: false,
      }),
      listArtifacts: vi.fn(),
      getArtifact: vi.fn(),
      findArtifacts: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
    };

    const invalid = [createInvalidAlert()];

    const result = await quarantineAlerts(
      invalid,
      mockArtifactStore,
      '2024-01-01',
      'solana',
      'run_123'
    );

    expect(result.count).toBe(1);
    expect(result.artifactId).toBe('quarantine_artifact_123');
    expect(mockArtifactStore.publishArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: 'alerts_quarantine',
        schemaVersion: 1,
        logicalKey: 'day=2024-01-01/chain=solana/reason=validation_failed',
        tags: expect.objectContaining({
          quarantine_reason: 'validation_failed',
          date: '2024-01-01',
          chain: 'solana',
          run_id: 'run_123',
        }),
      })
    );
  });

  it('should handle deduplication', async () => {
    const mockArtifactStore: ArtifactStorePort = {
      publishArtifact: vi.fn().mockResolvedValue({
        artifactId: 'quarantine_artifact_123',
        deduped: true,
      }),
      listArtifacts: vi.fn(),
      getArtifact: vi.fn(),
      findArtifacts: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
    };

    const invalid = [createInvalidAlert()];

    const result = await quarantineAlerts(
      invalid,
      mockArtifactStore,
      '2024-01-01',
      'solana',
      'run_123'
    );

    expect(result.count).toBe(1);
    expect(result.artifactId).toBe('quarantine_artifact_123');
  });

  it('should handle publish errors', async () => {
    const mockArtifactStore: ArtifactStorePort = {
      publishArtifact: vi.fn().mockRejectedValue(new Error('Publish failed')),
      listArtifacts: vi.fn(),
      getArtifact: vi.fn(),
      findArtifacts: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
    };

    const invalid = [createInvalidAlert()];

    const result = await quarantineAlerts(
      invalid,
      mockArtifactStore,
      '2024-01-01',
      'solana',
      'run_123'
    );

    expect(result.count).toBe(1);
    expect(result.error).toBe('Publish failed');
    expect(result.artifactId).toBeUndefined();
  });

  it('should quarantine multiple invalid alerts', async () => {
    const mockArtifactStore: ArtifactStorePort = {
      publishArtifact: vi.fn().mockResolvedValue({
        artifactId: 'quarantine_artifact_123',
        deduped: false,
      }),
      listArtifacts: vi.fn(),
      getArtifact: vi.fn(),
      findArtifacts: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
    };

    const invalid = [createInvalidAlert(), createInvalidAlert(), createInvalidAlert()];

    const result = await quarantineAlerts(
      invalid,
      mockArtifactStore,
      '2024-01-01',
      'solana',
      'run_123'
    );

    expect(result.count).toBe(3);
    expect(result.artifactId).toBe('quarantine_artifact_123');
  });
});

