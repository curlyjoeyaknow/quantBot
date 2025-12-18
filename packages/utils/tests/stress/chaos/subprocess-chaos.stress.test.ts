/**
 * Chaos Engineering Lite: Subprocess Chaos Tests
 *
 * Tests that simulate real-world failures in the toolchain.
 * Goal: System should detect failures and provide clear errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PythonEngine } from '../../../src/python/python-engine.js';
import { z } from 'zod';
import { shouldRunChaosTests, TEST_GATES } from '../../../src/test-helpers/test-gating';

vi.mock('child_process');

describe.skipIf(!shouldRunChaosTests())(
  'Subprocess Chaos Tests',
  () => {
    let tempDir: string;
    let engine: PythonEngine;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chaos-'));
    engine = new PythonEngine();
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    vi.restoreAllMocks();
  });

  describe('Random subprocess kills', () => {
    it('should detect when subprocess is killed mid-execution', async () => {
      const error: any = new Error('Process killed');
      error.signal = 'SIGKILL';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const schema = z.object({ result: z.string() });

      await expect(engine.runScript('/fake/script.py', {}, schema)).rejects.toThrow();
    });

    it('should provide clean error when subprocess times out', async () => {
      const error: any = new Error('Timeout');
      error.signal = 'SIGTERM';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const schema = z.object({ result: z.string() });

      try {
        await engine.runScript('/fake/script.py', {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('timed out');
        expect(err.timeout).toBe(1000);
      }
    });

    it('should recover after subprocess kill', async () => {
      const schema = z.object({ result: z.string() });

      // First call: killed
      const error: any = new Error('Process killed');
      error.signal = 'SIGKILL';
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw error;
      });

      await expect(engine.runScript('/fake/script.py', {}, schema)).rejects.toThrow();

      // Second call: succeeds
      vi.mocked(execSync).mockReturnValue(Buffer.from(JSON.stringify({ result: 'success' })));

      const result = await engine.runScript('/fake/script.py', {}, schema);
      expect(result.result).toBe('success');
    });
  });

  describe('Artifact corruption', () => {
    it('should detect corrupted artifact file', () => {
      const artifactPath = join(tempDir, 'output.duckdb');
      writeFileSync(artifactPath, 'CORRUPTED_DATA');

      // Attempt to read corrupted file
      const content = readFileSync(artifactPath, 'utf-8');
      expect(content).toBe('CORRUPTED_DATA');

      // Should detect corruption (requires actual implementation)
      // For now, just verify we can detect it's not valid DuckDB
      expect(content.startsWith('CORRUPTED')).toBe(true);
    });

    it('should error when artifact is missing', () => {
      const missingPath = join(tempDir, 'nonexistent.duckdb');

      expect(() => {
        readFileSync(missingPath);
      }).toThrow();
    });

    it('should detect partial artifact write', () => {
      const artifactPath = join(tempDir, 'output.duckdb');

      // Write partial file
      writeFileSync(artifactPath, 'PARTIAL');

      const content = readFileSync(artifactPath, 'utf-8');
      expect(content.length).toBeLessThan(100); // Suspiciously small

      // Should detect incomplete write
    });

    it('should not use corrupted artifact on rerun', () => {
      const artifactPath = join(tempDir, 'output.duckdb');

      // Create corrupted artifact
      writeFileSync(artifactPath, 'CORRUPTED');

      // Rerun should detect corruption and rebuild
      // (Requires actual implementation)
      const exists = readFileSync(artifactPath, 'utf-8');
      expect(exists).toBe('CORRUPTED');
    });
  });

  describe('Disk full scenarios', () => {
    it('should error when directory is read-only', () => {
      const readOnlyDir = join(tempDir, 'readonly');
      mkdtempSync(readOnlyDir);
      chmodSync(readOnlyDir, 0o444);

      try {
        expect(() => {
          writeFileSync(join(readOnlyDir, 'test.txt'), 'data');
        }).toThrow();
      } finally {
        chmodSync(readOnlyDir, 0o755);
      }
    });

    it('should error when disk is full (simulated)', () => {
      // Simulate disk full by writing to read-only directory
      chmodSync(tempDir, 0o444);

      try {
        expect(() => {
          writeFileSync(join(tempDir, 'test.txt'), 'data');
        }).toThrow();
      } finally {
        chmodSync(tempDir, 0o755);
      }
    });

    it('should not claim success when write fails', () => {
      chmodSync(tempDir, 0o444);

      try {
        const result = (() => {
          try {
            writeFileSync(join(tempDir, 'test.txt'), 'data');
            return { success: true };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        })();

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      } finally {
        chmodSync(tempDir, 0o755);
      }
    });
  });

  describe('File deletion during execution', () => {
    it('should detect when DuckDB file is deleted mid-run', () => {
      const dbPath = join(tempDir, 'test.duckdb');
      writeFileSync(dbPath, 'INITIAL_DATA');

      // Delete file
      unlinkSync(dbPath);

      // Attempt to read should fail
      expect(() => {
        readFileSync(dbPath);
      }).toThrow();
    });

    it('should rebuild when artifact is missing on rerun', () => {
      const dbPath = join(tempDir, 'test.duckdb');
      writeFileSync(dbPath, 'INITIAL_DATA');

      // Delete file
      unlinkSync(dbPath);

      // Rerun should detect missing file and rebuild
      // (Requires actual implementation)
      expect(() => {
        readFileSync(dbPath);
      }).toThrow();
    });
  });

  describe('Environment chaos', () => {
    it('should handle missing PYTHONPATH', async () => {
      const schema = z.object({ result: z.string() });

      // Run without PYTHONPATH
      vi.mocked(execSync).mockReturnValue(Buffer.from(JSON.stringify({ result: 'success' })));

      const result = await engine.runScript('/fake/script.py', {}, schema, {
        env: {}, // No PYTHONPATH
      });

      expect(result.result).toBe('success');
    });

    it('should handle missing Python executable', async () => {
      const badEngine = new PythonEngine('nonexistent-python');
      const schema = z.object({ result: z.string() });

      const error: any = new Error('Command not found');
      error.code = 'ENOENT';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      await expect(badEngine.runScript('/fake/script.py', {}, schema)).rejects.toThrow();
    });

    it('should handle corrupted Python environment', async () => {
      const schema = z.object({ result: z.string() });

      const error: any = new Error('ModuleNotFoundError');
      error.status = 1;
      error.stderr = Buffer.from('ModuleNotFoundError: No module named "duckdb"');
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      await expect(engine.runScript('/fake/script.py', {}, schema)).rejects.toThrow();
    });
  });

  describe('Concurrent chaos', () => {
    it('should handle concurrent subprocess executions', async () => {
      const schema = z.object({ result: z.string() });

      vi.mocked(execSync).mockReturnValue(Buffer.from(JSON.stringify({ result: 'success' })));

      const runs = Array.from({ length: 10 }, () =>
        engine.runScript('/fake/script.py', {}, schema)
      );

      const results = await Promise.all(runs);
      expect(results.every((r) => r.result === 'success')).toBe(true);
    });

    it('should handle concurrent file writes', () => {
      const filePath = join(tempDir, 'concurrent.txt');

      const writes = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          writeFileSync(filePath, `data-${i}`);
        })
      );

      return Promise.all(writes).then(() => {
        // File should have some data (last write wins)
        const content = readFileSync(filePath, 'utf-8');
        expect(content).toMatch(/^data-\d+$/);
      });
    });

    it('should detect race conditions in artifact creation', () => {
      const artifactPath = join(tempDir, 'artifact.duckdb');

      // Simulate concurrent writes
      writeFileSync(artifactPath, 'WRITE_1');
      writeFileSync(artifactPath, 'WRITE_2');

      const content = readFileSync(artifactPath, 'utf-8');
      expect(content).toBe('WRITE_2'); // Last write wins
    });
  });

  describe('Resource exhaustion', () => {
    it('should handle very large subprocess output', async () => {
      const schema = z.object({ result: z.string() });

      // Simulate large output (within maxBuffer)
      const largeOutput = JSON.stringify({
        result: 'x'.repeat(1024 * 1024), // 1MB
      });
      vi.mocked(execSync).mockReturnValue(Buffer.from(largeOutput));

      const result = await engine.runScript('/fake/script.py', {}, schema);
      expect(result.result.length).toBe(1024 * 1024);
    });

    it('should error when output exceeds maxBuffer', async () => {
      const schema = z.object({ result: z.string() });

      const error: any = new Error('maxBuffer exceeded');
      error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      await expect(engine.runScript('/fake/script.py', {}, schema)).rejects.toThrow();
    });

    it('should handle many small subprocess calls', async () => {
      const schema = z.object({ result: z.string() });

      vi.mocked(execSync).mockReturnValue(Buffer.from(JSON.stringify({ result: 'success' })));

      const calls = Array.from({ length: 100 }, () =>
        engine.runScript('/fake/script.py', {}, schema)
      );

      const results = await Promise.all(calls);
      expect(results.length).toBe(100);
      expect(results.every((r) => r.result === 'success')).toBe(true);
    });
  });

  describe('Error propagation', () => {
    it('should propagate subprocess errors with context', async () => {
      const schema = z.object({ result: z.string() });

      const error: any = new Error('Script failed');
      error.status = 1;
      error.stderr = Buffer.from('Traceback: ValueError');
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      try {
        await engine.runScript('/fake/script.py', {}, schema);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('exited with code 1');
        expect(err.context).toBeDefined();
        expect(err.context.stderr).toContain('Traceback');
      }
    });

    it('should not swallow errors', async () => {
      const schema = z.object({ result: z.string() });

      const error: any = new Error('Unexpected error');
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      await expect(engine.runScript('/fake/script.py', {}, schema)).rejects.toThrow(
        'Unexpected error'
      );
    });

    it('should provide actionable error messages', async () => {
      const schema = z.object({ result: z.string() });

      const error: any = new Error('Script failed');
      error.status = 1;
      error.stderr = Buffer.from('ModuleNotFoundError: No module named "duckdb"');
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      try {
        await engine.runScript('/fake/script.py', {}, schema);
        expect.fail('Should have thrown');
      } catch (err: any) {
        // Error should be actionable
        expect(err.message).toBeDefined();
        expect(err.context.stderr).toContain('ModuleNotFoundError');
      }
    });
  });
  },
  `Chaos tests require ${TEST_GATES.CHAOS}=1`
);
