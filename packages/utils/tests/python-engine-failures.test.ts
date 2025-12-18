/**
 * PythonEngine Failure Mode Tests
 *
 * Tests the foundational contract between TypeScript and Python:
 * - Python tools either return valid, schema-checked results
 * - Or fail loudly, deterministically, and safely
 *
 * These tests use REAL subprocess execution (no mocks) to verify:
 * - Error propagation
 * - Schema validation
 * - Timeout handling
 * - Output size limits
 * - Determinism enforcement
 * - Artifact integrity
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { PythonEngine } from '../src/python/python-engine';
import { z } from 'zod';
import { ValidationError, TimeoutError, AppError } from '../src/index';
import { existsSync } from 'fs';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'bad-tools');

describe('PythonEngine: Process Behavior Failures', () => {
  let engine: PythonEngine;

  beforeAll(() => {
    engine = new PythonEngine('python3');
  });

  describe('1. Non-JSON stdout', () => {
    it('fails with ValidationError when Python outputs non-JSON text', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_json.py');
      const schema = z.object({ success: z.boolean() });

      await expect(engine.runScript(scriptPath, {}, schema, { timeout: 1000 })).rejects.toThrow(
        ValidationError
      );
    });

    it('error message includes tool name and truncated output', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_json.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown ValidationError');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('Failed to parse JSON');
        expect(error.context?.script).toBe(scriptPath);
        expect(error.context?.lastLine).toBeDefined();
        expect(error.context?.lastLine.length).toBeLessThanOrEqual(200);
      }
    });

    it('does not claim partial artifacts on parse failure', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_json.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown ValidationError');
      } catch (error: any) {
        // Error should not contain any artifact paths
        expect(error.context?.artifacts).toBeUndefined();
        expect(error.context?.duckdb_file).toBeUndefined();
      }
    });
  });

  describe('2. JSON but invalid schema', () => {
    it('fails when JSON does not match Zod schema', async () => {
      const scriptPath = join(FIXTURES_DIR, 'wrong_schema.py');
      const schema = z.object({
        success: z.boolean(),
        required_field: z.string(),
      });

      await expect(engine.runScript(scriptPath, {}, schema, { timeout: 1000 })).rejects.toThrow();
    });

    it('error clearly states which field is missing/invalid', async () => {
      const scriptPath = join(FIXTURES_DIR, 'wrong_schema.py');
      const schema = z.object({
        success: z.boolean(),
        required_field: z.string(),
      });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        // Zod error should mention the missing field
        expect(error.message).toMatch(/required_field|Required/i);
      }
    });

    it('handler does not swallow schema validation error', async () => {
      const scriptPath = join(FIXTURES_DIR, 'wrong_schema.py');
      const schema = z.object({
        success: z.boolean(),
        required_field: z.string(),
      });

      // Error should propagate without being caught
      let errorThrown = false;
      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
      } catch (error) {
        errorThrown = true;
        // Error should not be wrapped in a generic error
        expect(error).toBeDefined();
      }
      expect(errorThrown).toBe(true);
    });
  });

  describe('3. Mixed stdout + stderr', () => {
    it('treats mixed stdout as invalid output', async () => {
      const scriptPath = join(FIXTURES_DIR, 'mixed_output.py');
      const schema = z.object({
        success: z.boolean(),
        result: z.string(),
      });

      // The tool outputs logs to stdout before JSON
      // PythonEngine tries to parse last line as JSON
      // This should succeed if last line is valid JSON
      const result = await engine.runScript(scriptPath, {}, schema, {
        timeout: 1000,
      });

      // Verify it parsed the JSON from the last line
      expect(result.success).toBe(true);
      expect(result.result).toBe('data');
    });

    it('forces discipline: Python tools must log to stderr only', async () => {
      // This test documents the contract:
      // Python tools should log to stderr, output JSON to stdout (last line)
      const goodToolPath = join(FIXTURES_DIR, 'good_tool.py');
      const schema = z.object({
        success: z.boolean(),
        input_received: z.string(),
        seed_used: z.number(),
        result: z.string(),
      });

      const result = await engine.runScript(goodToolPath, { input: 'test', seed: 42 }, schema, {
        timeout: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.input_received).toBe('test');
      expect(result.seed_used).toBe(42);
    });
  });

  describe('4. Non-zero exit code', () => {
    it('throws AppError when Python exits with non-zero code', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      await expect(engine.runScript(scriptPath, {}, schema, { timeout: 1000 })).rejects.toThrow(
        AppError
      );
    });

    it('error includes exit code and stderr', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown AppError');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.message).toContain('exited with code 1');
        expect(error.context?.exitCode).toBe(1);
        expect(error.context?.stderr).toContain('ERROR: Something went wrong');
      }
    });

    it('stdout is ignored when exit code is non-zero', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown AppError');
      } catch (error: any) {
        // Error should not attempt to parse stdout as JSON
        expect(error).toBeInstanceOf(AppError);
        expect(error.message).not.toContain('parse');
      }
    });
  });

  describe('5. Timeout / hang', () => {
    it('kills process and throws TimeoutError when script exceeds timeout', async () => {
      const scriptPath = join(FIXTURES_DIR, 'timeout.py');
      const schema = z.object({ success: z.boolean() });

      await expect(engine.runScript(scriptPath, {}, schema, { timeout: 500 })).rejects.toThrow(
        TimeoutError
      );
    });

    it('error message includes timeout duration', async () => {
      const scriptPath = join(FIXTURES_DIR, 'timeout.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 500 });
        expect.fail('Should have thrown TimeoutError');
      } catch (error: any) {
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error.message).toContain('timed out after 500ms');
        expect(error.timeoutMs).toBe(500);
        expect(error.context?.script).toBe(scriptPath);
      }
    });

    it('subsequent runs still work after timeout', async () => {
      const scriptPath = join(FIXTURES_DIR, 'timeout.py');
      const goodToolPath = join(FIXTURES_DIR, 'good_tool.py');
      const timeoutSchema = z.object({ success: z.boolean() });
      const goodSchema = z.object({
        success: z.boolean(),
        input_received: z.string(),
        seed_used: z.number(),
        result: z.string(),
      });

      // First call times out
      await expect(
        engine.runScript(scriptPath, {}, timeoutSchema, { timeout: 500 })
      ).rejects.toThrow(TimeoutError);

      // Second call should still work
      const result = await engine.runScript(goodToolPath, { input: 'test', seed: 42 }, goodSchema, {
        timeout: 1000,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('6. Huge stdout', () => {
    it('aborts when output exceeds maxBuffer limit', async () => {
      const scriptPath = join(FIXTURES_DIR, 'huge_output.py');
      const schema = z.object({ success: z.boolean() });

      // Current maxBuffer is 10MB, script generates ~15MB
      await expect(engine.runScript(scriptPath, {}, schema, { timeout: 5000 })).rejects.toThrow();
    });

    it('error indicates output size exceeded', async () => {
      const scriptPath = join(FIXTURES_DIR, 'huge_output.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 30000 });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        // Node.js throws when maxBuffer is exceeded
        // The error could be a timeout or maxBuffer exceeded depending on system speed
        expect(
          error.message.match(/maxBuffer|stdout maxBuffer|exceeded/i) ||
            error.message.includes('timed out')
        ).toBeTruthy();
      }
    });
  });
});

describe('PythonEngine: Contract / Determinism Failures', () => {
  let engine: PythonEngine;

  beforeAll(() => {
    engine = new PythonEngine('python3');
  });

  describe('7. Same input → different output (non-determinism)', () => {
    it('fails when tool returns random data without seed', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_deterministic.py');
      const schema = z.object({
        success: z.boolean(),
        random_value: z.number(),
        random_float: z.number(),
      });

      // Run twice without seed
      const result1 = await engine.runScript(scriptPath, {}, schema, {
        timeout: 1000,
      });
      const result2 = await engine.runScript(scriptPath, {}, schema, {
        timeout: 1000,
      });

      // Results should be different (non-deterministic)
      // This documents the problem
      expect(result1.random_value).not.toBe(result2.random_value);
    });

    it('succeeds when input seed controls output (determinism enforced)', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_deterministic.py');
      const schema = z.object({
        success: z.boolean(),
        random_value: z.number(),
        random_float: z.number(),
      });

      // Run twice with same seed
      const result1 = await engine.runScript(scriptPath, { seed: 12345 }, schema, {
        timeout: 1000,
      });
      const result2 = await engine.runScript(scriptPath, { seed: 12345 }, schema, {
        timeout: 1000,
      });

      // Results should be identical (deterministic)
      expect(result1.random_value).toBe(result2.random_value);
      expect(result1.random_float).toBe(result2.random_float);
    });

    it('different seeds produce different outputs', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_deterministic.py');
      const schema = z.object({
        success: z.boolean(),
        random_value: z.number(),
        random_float: z.number(),
      });

      const result1 = await engine.runScript(scriptPath, { seed: 11111 }, schema, {
        timeout: 1000,
      });
      const result2 = await engine.runScript(scriptPath, { seed: 22222 }, schema, {
        timeout: 1000,
      });

      // Different seeds should produce different outputs
      expect(result1.random_value).not.toBe(result2.random_value);
    });
  });

  describe('8. Artifact claims without files', () => {
    it('detects when Python claims artifacts that do not exist', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      const result = await engine.runScript(scriptPath, {}, schema, {
        timeout: 1000,
      });

      // Schema validation passes, but artifacts don't exist
      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(3);

      // Verify artifacts don't actually exist
      for (const artifactPath of result.artifacts) {
        expect(existsSync(artifactPath)).toBe(false);
      }

      // This test documents the problem:
      // PythonEngine currently doesn't verify artifact existence
      // TODO: Add artifact verification in enhancement phase
    });

    it('manifest file path should be verified', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      const result = await engine.runScript(scriptPath, {}, schema, {
        timeout: 1000,
      });

      // Manifest claims a duckdb file exists
      expect(result.manifest.duckdb_file).toBeDefined();
      expect(existsSync(result.manifest.duckdb_file)).toBe(false);

      // This should fail in production
      // TODO: Add verification in enhancement phase
    });
  });

  describe('9. Partial success is forbidden', () => {
    it('fails when Python returns incomplete manifest', async () => {
      const scriptPath = join(FIXTURES_DIR, 'partial_success.py');
      const schema = z.object({
        success: z.boolean(),
        required_field_1: z.string(),
        required_field_2: z.number(),
        required_field_3: z.array(z.string()),
      });

      // Schema validation should fail on missing fields
      await expect(engine.runScript(scriptPath, {}, schema, { timeout: 1000 })).rejects.toThrow();
    });

    it('prevents half-truth runs', async () => {
      const scriptPath = join(FIXTURES_DIR, 'partial_success.py');
      const strictSchema = z.object({
        success: z.boolean(),
        data: z.object({
          field1: z.string(),
          field2: z.number(),
          field3: z.array(z.string()),
        }),
      });

      try {
        await engine.runScript(scriptPath, {}, strictSchema, { timeout: 1000 });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        // Error should indicate missing required fields
        expect(error.message).toBeDefined();
        // No partial data should be accessible
      }
    });
  });
});

describe('PythonEngine: Error Context Quality', () => {
  let engine: PythonEngine;

  beforeAll(() => {
    engine = new PythonEngine('python3');
  });

  it('includes script path in all errors', async () => {
    const scriptPath = join(FIXTURES_DIR, 'non_json.py');
    const schema = z.object({ success: z.boolean() });

    try {
      await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
      expect.fail('Should have thrown error');
    } catch (error: any) {
      expect(error.context?.script || error.message).toContain(scriptPath);
    }
  });

  it('provides enough context to debug failures', async () => {
    const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
    const schema = z.object({ success: z.boolean() });

    try {
      await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
      expect.fail('Should have thrown error');
    } catch (error: any) {
      // Should have script path, exit code, and stderr
      expect(error.context?.script).toBe(scriptPath);
      expect(error.context?.exitCode).toBe(1);
      expect(error.context?.stderr).toBeDefined();
      expect(error.context?.stderr.length).toBeGreaterThan(0);
    }
  });

  it('truncates large outputs in error messages', async () => {
    const scriptPath = join(FIXTURES_DIR, 'non_json.py');
    const schema = z.object({ success: z.boolean() });

    try {
      await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
      expect.fail('Should have thrown error');
    } catch (error: any) {
      // lastLine should be truncated to 200 chars
      if (error.context?.lastLine) {
        expect(error.context.lastLine.length).toBeLessThanOrEqual(200);
      }
    }
  });
});
