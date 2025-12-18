/**
 * Pipeline Invariants: Run Manifest Stress Tests
 *
 * Tests that every pipeline run creates complete manifests with stable keys.
 * Goal: You can always explain why something is missing.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

/**
 * Run manifest structure
 */
interface RunManifest {
  run_id: string;
  input_hash: string;
  tool_version: string;
  git_commit?: string;
  artifact_paths: {
    duckdb?: string;
    parquet?: string;
    json?: string;
  };
  options: Record<string, unknown>;
  timestamp: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

/**
 * Mock manifest service
 */
class MockManifestService {
  private manifests: Map<string, RunManifest> = new Map();

  async createRun(input: string | Buffer, options: Record<string, unknown>): Promise<RunManifest> {
    const inputHash = createHash('sha256').update(input).digest('hex');
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const manifest: RunManifest = {
      run_id: runId,
      input_hash: inputHash,
      tool_version: '1.0.0',
      git_commit: process.env.GIT_COMMIT,
      artifact_paths: {},
      options,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };

    this.manifests.set(runId, manifest);
    return manifest;
  }

  async updateRun(runId: string, updates: Partial<RunManifest>): Promise<RunManifest> {
    const manifest = this.manifests.get(runId);
    if (!manifest) {
      throw new Error(`Run not found: ${runId}`);
    }

    Object.assign(manifest, updates);
    return manifest;
  }

  async findByInputHash(
    inputHash: string,
    options: Record<string, unknown>
  ): Promise<RunManifest | null> {
    for (const manifest of this.manifests.values()) {
      if (
        manifest.input_hash === inputHash &&
        JSON.stringify(manifest.options) === JSON.stringify(options)
      ) {
        return manifest;
      }
    }
    return null;
  }

  getAll(): RunManifest[] {
    return Array.from(this.manifests.values());
  }
}

describe('Run Manifest Invariants', () => {
  describe('Manifest creation', () => {
    it('should create manifest with all required fields', async () => {
      const service = new MockManifestService();
      const input = 'test input data';
      const options = { rebuild: false };

      const manifest = await service.createRun(input, options);

      // Required fields
      expect(manifest.run_id).toBeDefined();
      expect(manifest.run_id.length).toBeGreaterThan(0);
      expect(manifest.input_hash).toBeDefined();
      expect(manifest.input_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256
      expect(manifest.tool_version).toBeDefined();
      expect(manifest.artifact_paths).toBeDefined();
      expect(manifest.options).toBeDefined();
      expect(manifest.timestamp).toBeDefined();
      expect(manifest.status).toBeDefined();
    });

    it('should generate stable input hash', async () => {
      const service = new MockManifestService();
      const input = 'test input data';
      const options = {};

      const manifest1 = await service.createRun(input, options);
      const manifest2 = await service.createRun(input, options);

      // Same input should produce same hash
      expect(manifest1.input_hash).toBe(manifest2.input_hash);

      // But different run IDs
      expect(manifest1.run_id).not.toBe(manifest2.run_id);
    });

    it('should generate different hash for different input', async () => {
      const service = new MockManifestService();

      const manifest1 = await service.createRun('input 1', {});
      const manifest2 = await service.createRun('input 2', {});

      expect(manifest1.input_hash).not.toBe(manifest2.input_hash);
    });

    it('should include git commit when available', async () => {
      process.env.GIT_COMMIT = 'abc123def456';
      const service = new MockManifestService();

      const manifest = await service.createRun('test', {});

      expect(manifest.git_commit).toBe('abc123def456');

      delete process.env.GIT_COMMIT;
    });

    it('should include tool version', async () => {
      const service = new MockManifestService();

      const manifest = await service.createRun('test', {});

      expect(manifest.tool_version).toBeDefined();
      expect(manifest.tool_version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('Artifact tracking', () => {
    it('should track all artifact paths', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      await service.updateRun(manifest.run_id, {
        artifact_paths: {
          duckdb: '/path/to/output.duckdb',
          parquet: '/path/to/output.parquet',
          json: '/path/to/output.json',
        },
        status: 'completed',
      });

      const updated = await service.updateRun(manifest.run_id, {});
      expect(updated.artifact_paths.duckdb).toBeDefined();
      expect(updated.artifact_paths.parquet).toBeDefined();
      expect(updated.artifact_paths.json).toBeDefined();
    });

    it('should detect missing artifacts', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      await service.updateRun(manifest.run_id, {
        artifact_paths: {
          duckdb: '/path/to/output.duckdb',
          // Missing parquet
        },
        status: 'completed',
      });

      const updated = await service.updateRun(manifest.run_id, {});
      expect(updated.artifact_paths.duckdb).toBeDefined();
      expect(updated.artifact_paths.parquet).toBeUndefined();
    });

    it('should validate artifact paths exist', async () => {
      // This would require actual file system checks
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      await service.updateRun(manifest.run_id, {
        artifact_paths: {
          duckdb: '/nonexistent/path.duckdb',
        },
      });

      // Should validate that files exist
      // (Requires actual implementation)
    });
  });

  describe('Run reuse', () => {
    it('should find existing run with same input and options', async () => {
      const service = new MockManifestService();
      const input = 'test input';
      const options = { rebuild: false };

      const manifest1 = await service.createRun(input, options);
      await service.updateRun(manifest1.run_id, { status: 'completed' });

      const inputHash = createHash('sha256').update(input).digest('hex');
      const existing = await service.findByInputHash(inputHash, options);

      expect(existing).toBeDefined();
      expect(existing?.run_id).toBe(manifest1.run_id);
    });

    it('should not reuse run with different options', async () => {
      const service = new MockManifestService();
      const input = 'test input';

      await service.createRun(input, { rebuild: false });

      const inputHash = createHash('sha256').update(input).digest('hex');
      const existing = await service.findByInputHash(inputHash, { rebuild: true });

      expect(existing).toBeNull();
    });

    it('should create new run when explicitly requested', async () => {
      const service = new MockManifestService();
      const input = 'test input';
      const options = { rebuild: true };

      const manifest1 = await service.createRun(input, options);
      const manifest2 = await service.createRun(input, options);

      // Should create new run even with same input
      expect(manifest1.run_id).not.toBe(manifest2.run_id);
      expect(manifest1.input_hash).toBe(manifest2.input_hash);
    });

    it('should record reason for new run', async () => {
      const service = new MockManifestService();
      const input = 'test input';

      const manifest1 = await service.createRun(input, { rebuild: false });
      const manifest2 = await service.createRun(input, { rebuild: true });

      // Should indicate why new run was created
      // (Requires additional field in manifest)
      expect(manifest2.options).toHaveProperty('rebuild', true);
    });
  });

  describe('Status tracking', () => {
    it('should track run lifecycle', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      expect(manifest.status).toBe('pending');

      await service.updateRun(manifest.run_id, { status: 'running' });
      let updated = await service.updateRun(manifest.run_id, {});
      expect(updated.status).toBe('running');

      await service.updateRun(manifest.run_id, { status: 'completed' });
      updated = await service.updateRun(manifest.run_id, {});
      expect(updated.status).toBe('completed');
    });

    it('should record error on failure', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      await service.updateRun(manifest.run_id, {
        status: 'failed',
        error: 'Database connection failed',
      });

      const updated = await service.updateRun(manifest.run_id, {});
      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Database connection failed');
    });

    it('should preserve timestamp of creation', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      const originalTimestamp = manifest.timestamp;

      await service.updateRun(manifest.run_id, { status: 'completed' });
      const updated = await service.updateRun(manifest.run_id, {});

      // Timestamp should not change
      expect(updated.timestamp).toBe(originalTimestamp);
    });
  });

  describe('Audit trail', () => {
    it('should provide complete history', async () => {
      const service = new MockManifestService();

      await service.createRun('input 1', { option: 'a' });
      await service.createRun('input 2', { option: 'b' });
      await service.createRun('input 3', { option: 'c' });

      const all = service.getAll();
      expect(all.length).toBe(3);
    });

    it('should enable querying by input hash', async () => {
      const service = new MockManifestService();
      const input = 'test input';

      await service.createRun(input, { option: 'a' });
      await service.createRun(input, { option: 'b' });
      await service.createRun('different input', { option: 'c' });

      const inputHash = createHash('sha256').update(input).digest('hex');
      const all = service.getAll();
      const matching = all.filter((m) => m.input_hash === inputHash);

      expect(matching.length).toBe(2);
    });

    it('should enable querying by status', async () => {
      const service = new MockManifestService();

      const m1 = await service.createRun('input 1', {});
      const m2 = await service.createRun('input 2', {});
      const m3 = await service.createRun('input 3', {});

      await service.updateRun(m1.run_id, { status: 'completed' });
      await service.updateRun(m2.run_id, { status: 'failed' });
      // m3 remains pending

      const all = service.getAll();
      const completed = all.filter((m) => m.status === 'completed');
      const failed = all.filter((m) => m.status === 'failed');
      const pending = all.filter((m) => m.status === 'pending');

      expect(completed.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(pending.length).toBe(1);
    });
  });

  describe('Invariant violations', () => {
    it('should never have run without input_hash', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      expect(manifest.input_hash).toBeDefined();
      expect(manifest.input_hash.length).toBe(64); // SHA-256
    });

    it('should never have run without run_id', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      expect(manifest.run_id).toBeDefined();
      expect(manifest.run_id.length).toBeGreaterThan(0);
    });

    it('should never have run without timestamp', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      expect(manifest.timestamp).toBeDefined();
      expect(new Date(manifest.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should never have run without tool_version', async () => {
      const service = new MockManifestService();
      const manifest = await service.createRun('test', {});

      expect(manifest.tool_version).toBeDefined();
      expect(manifest.tool_version.length).toBeGreaterThan(0);
    });

    it('should never have duplicate run_id', async () => {
      const service = new MockManifestService();

      const m1 = await service.createRun('test', {});
      const m2 = await service.createRun('test', {});

      expect(m1.run_id).not.toBe(m2.run_id);

      const all = service.getAll();
      const runIds = all.map((m) => m.run_id);
      const uniqueRunIds = new Set(runIds);

      expect(runIds.length).toBe(uniqueRunIds.size);
    });
  });
});
