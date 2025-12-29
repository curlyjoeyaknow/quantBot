/**
 * Unit tests for Artifact Storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileArtifactStorage } from '../../../src/research/artifact-storage.js';
import type { RunArtifact } from '../../../src/research/artifacts.js';

describe('FileArtifactStorage', () => {
  let storage: FileArtifactStorage;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-artifacts-${Date.now()}`);
    storage = new FileArtifactStorage(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createMockArtifact(runId: string): RunArtifact {
    return {
      metadata: {
        runId,
        gitSha: 'a'.repeat(40),
        createdAtISO: new Date().toISOString(),
        dataSnapshotHash: 'b'.repeat(64),
        strategyConfigHash: 'c'.repeat(64),
        runConfigHash: 'd'.repeat(64),
        simulationTimeMs: 1000,
        schemaVersion: '1.0.0',
      },
      request: {} as any,
      tradeEvents: [],
      pnlSeries: [],
      metrics: {
        return: { total: 1.0 },
        drawdown: { max: 0 },
        hitRate: { overall: 0 },
        trades: { total: 0, entries: 0, exits: 0 },
        tailLoss: { worstTrade: 0 },
        feeSensitivity: { totalFees: 0, averageFeePerTrade: 0 },
      },
    };
  }

  it('saves and loads artifacts', async () => {
    const artifact = createMockArtifact('run-001');
    await storage.save(artifact);

    const loaded = await storage.load('run-001');
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.runId).toBe('run-001');
  });

  it('returns null for non-existent artifact', async () => {
    const loaded = await storage.load('non-existent');
    expect(loaded).toBeNull();
  });

  it('lists all run IDs', async () => {
    await storage.save(createMockArtifact('run-001'));
    await storage.save(createMockArtifact('run-002'));
    await storage.save(createMockArtifact('run-003'));

    const list = await storage.list();
    expect(list.length).toBe(3);
    expect(list).toContain('run-001');
    expect(list).toContain('run-002');
    expect(list).toContain('run-003');
  });

  it('supports pagination', async () => {
    for (let i = 1; i <= 10; i++) {
      await storage.save(createMockArtifact(`run-${String(i).padStart(3, '0')}`));
    }

    const firstPage = await storage.list({ limit: 5, offset: 0 });
    expect(firstPage.length).toBe(5);

    const secondPage = await storage.list({ limit: 5, offset: 5 });
    expect(secondPage.length).toBe(5);

    expect(firstPage).not.toEqual(secondPage);
  });

  it('deletes artifacts', async () => {
    await storage.save(createMockArtifact('run-001'));
    await storage.save(createMockArtifact('run-002'));

    await storage.delete('run-001');

    const list = await storage.list();
    expect(list).not.toContain('run-001');
    expect(list).toContain('run-002');

    const loaded = await storage.load('run-001');
    expect(loaded).toBeNull();
  });

  it('validates artifacts on save', async () => {
    const invalidArtifact = {
      metadata: {
        runId: 'run-001',
        // Missing required fields
      },
    } as any;

    await expect(storage.save(invalidArtifact)).rejects.toThrow();
  });

  it('validates artifacts on load', async () => {
    // Create a corrupted artifact file at the correct path
    // Storage uses getArtifactPath(runId) which is join(baseDir, `${runId}.json`)
    await fs.mkdir(testDir, { recursive: true });
    const artifactPath = join(testDir, 'run-001.json');
    await fs.writeFile(artifactPath, 'invalid json', 'utf-8');

    // JSON.parse will throw SyntaxError, which should be re-thrown (not ENOENT)
    await expect(storage.load('run-001')).rejects.toThrow();
  });
});
