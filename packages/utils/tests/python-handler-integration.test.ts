/**
 * Handler + PythonEngine Integration Tests
 *
 * Tests that handlers properly propagate Python tool errors without swallowing them.
 * These tests verify the contract:
 * - Handlers do not catch Python errors
 * - Errors propagate through execute()
 * - No process.exit inside handlers
 * - Error context is preserved
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PythonEngine } from '../src/python/python-engine.js';
import { z } from 'zod';
import { ValidationError, TimeoutError, AppError } from '../src/index.js';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'bad-tools');

/**
 * Mock handler that simulates a CLI handler calling PythonEngine
 * This follows the handler pattern: pure function, no error catching
 */
async function mockHandler(
  scriptPath: string,
  args: Record<string, unknown>,
  schema: z.ZodSchema,
  engine: PythonEngine
) {
  // Handler should NOT catch errors - let them bubble up
  return await engine.runScript(scriptPath, args, schema, { timeout: 1000 });
}

/**
 * Mock executor that simulates execute() function
 * This is where errors should be caught and formatted
 */
async function mockExecutor(
  handler: () => Promise<unknown>
): Promise<{ success: boolean; error?: string; context?: unknown }> {
  try {
    const result = await handler();
    return { success: true };
  } catch (error: any) {
    // Executor catches and formats errors
    return {
      success: false,
      error: error.message,
      context: error.context,
    };
  }
}

describe('Handler Integration: Error Propagation', () => {
  let engine: PythonEngine;

  beforeEach(() => {
    engine = new PythonEngine('python3');
  });

  describe('Handler propagates tool errors', () => {
    it('ValidationError propagates through handler to executor', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_json.py');
      const schema = z.object({ success: z.boolean() });

      const result = await mockExecutor(() => mockHandler(scriptPath, {}, schema, engine));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse JSON');
      expect(result.context).toBeDefined();
    });

    it('TimeoutError propagates through handler to executor', async () => {
      const scriptPath = join(FIXTURES_DIR, 'timeout.py');
      const schema = z.object({ success: z.boolean() });

      const result = await mockExecutor(() => mockHandler(scriptPath, {}, schema, engine));

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.context).toBeDefined();
    });

    it('AppError propagates through handler to executor', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      const result = await mockExecutor(() => mockHandler(scriptPath, {}, schema, engine));

      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
      expect(result.context?.exitCode).toBe(1);
    });

    it('Zod validation errors propagate through handler', async () => {
      const scriptPath = join(FIXTURES_DIR, 'wrong_schema.py');
      const schema = z.object({
        success: z.boolean(),
        required_field: z.string(),
      });

      const result = await mockExecutor(() => mockHandler(scriptPath, {}, schema, engine));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Handler does not swallow errors', () => {
    it('handler does not catch and reformat errors', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      // Call handler directly (not through executor)
      let caughtError: any;
      try {
        await mockHandler(scriptPath, {}, schema, engine);
      } catch (error) {
        caughtError = error;
      }

      // Error should be the original AppError, not wrapped
      expect(caughtError).toBeInstanceOf(AppError);
      expect(caughtError.context?.exitCode).toBe(1);
      expect(caughtError.context?.stderr).toContain('ERROR: Something went wrong');
    });

    it('handler does not hide error context', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_json.py');
      const schema = z.object({ success: z.boolean() });

      let caughtError: any;
      try {
        await mockHandler(scriptPath, {}, schema, engine);
      } catch (error) {
        caughtError = error;
      }

      // Original error context should be preserved
      expect(caughtError).toBeInstanceOf(ValidationError);
      expect(caughtError.context?.script).toBe(scriptPath);
      expect(caughtError.context?.lastLine).toBeDefined();
    });
  });

  describe('No process.exit in handlers', () => {
    it('handler throws errors instead of calling process.exit', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      // Handler should throw, not exit
      await expect(mockHandler(scriptPath, {}, schema, engine)).rejects.toThrow();

      // If we get here, process.exit was not called (good)
      expect(true).toBe(true);
    });
  });

  describe('Error context preservation', () => {
    it('preserves script path through error chain', async () => {
      const scriptPath = join(FIXTURES_DIR, 'timeout.py');
      const schema = z.object({ success: z.boolean() });

      const result = await mockExecutor(() => mockHandler(scriptPath, {}, schema, engine));

      expect(result.context?.script).toBe(scriptPath);
    });

    it('preserves exit code and stderr through error chain', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      const result = await mockExecutor(() => mockHandler(scriptPath, {}, schema, engine));

      expect(result.context?.exitCode).toBe(1);
      expect(result.context?.stderr).toContain('ERROR: Something went wrong');
    });

    it('preserves timeout duration through error chain', async () => {
      const scriptPath = join(FIXTURES_DIR, 'timeout.py');
      const schema = z.object({ success: z.boolean() });

      let caughtError: any;
      try {
        await mockHandler(scriptPath, {}, schema, engine);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(TimeoutError);
      expect(caughtError.timeoutMs).toBe(1000);
    });
  });
});

describe('Handler Integration: Success Cases', () => {
  let engine: PythonEngine;

  beforeEach(() => {
    engine = new PythonEngine('python3');
  });

  it('handler returns validated result on success', async () => {
    const scriptPath = join(FIXTURES_DIR, 'good_tool.py');
    const schema = z.object({
      success: z.boolean(),
      input_received: z.string(),
      seed_used: z.number(),
      result: z.string(),
    });

    const result = await mockHandler(scriptPath, { input: 'test', seed: 42 }, schema, engine);

    expect(result.success).toBe(true);
    expect(result.input_received).toBe('test');
    expect(result.seed_used).toBe(42);
    expect(result.result).toBe('processed');
  });

  it('executor receives successful result', async () => {
    const scriptPath = join(FIXTURES_DIR, 'good_tool.py');
    const schema = z.object({
      success: z.boolean(),
      input_received: z.string(),
      seed_used: z.number(),
      result: z.string(),
    });

    const result = await mockExecutor(() =>
      mockHandler(scriptPath, { input: 'test', seed: 42 }, schema, engine)
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('Handler Integration: Determinism', () => {
  let engine: PythonEngine;

  beforeEach(() => {
    engine = new PythonEngine('python3');
  });

  it('same input produces same output when seeded', async () => {
    const scriptPath = join(FIXTURES_DIR, 'non_deterministic.py');
    const schema = z.object({
      success: z.boolean(),
      random_value: z.number(),
      random_float: z.number(),
    });

    const result1 = await mockHandler(scriptPath, { seed: 99999 }, schema, engine);
    const result2 = await mockHandler(scriptPath, { seed: 99999 }, schema, engine);

    expect(result1.random_value).toBe(result2.random_value);
    expect(result1.random_float).toBe(result2.random_float);
  });

  it('handler can be called multiple times (REPL-friendly)', async () => {
    const scriptPath = join(FIXTURES_DIR, 'good_tool.py');
    const schema = z.object({
      success: z.boolean(),
      input_received: z.string(),
      seed_used: z.number(),
      result: z.string(),
    });

    // Simulate REPL usage: call handler multiple times
    const result1 = await mockHandler(scriptPath, { input: 'first', seed: 1 }, schema, engine);
    const result2 = await mockHandler(scriptPath, { input: 'second', seed: 2 }, schema, engine);
    const result3 = await mockHandler(scriptPath, { input: 'third', seed: 3 }, schema, engine);

    expect(result1.input_received).toBe('first');
    expect(result2.input_received).toBe('second');
    expect(result3.input_received).toBe('third');
  });
});

describe('Handler Integration: Real Handler Pattern', () => {
  /**
   * This simulates a real CLI handler following the pattern from .cursor/rules
   */
  interface CommandContext {
    services: {
      pythonEngine: () => PythonEngine;
    };
  }

  async function realStyleHandler(args: { input: string; seed?: number }, ctx: CommandContext) {
    const engine = ctx.services.pythonEngine();
    const scriptPath = join(FIXTURES_DIR, 'good_tool.py');
    const schema = z.object({
      success: z.boolean(),
      input_received: z.string(),
      seed_used: z.number(),
      result: z.string(),
    });

    // Handler does NOT catch errors
    return await engine.runScript(
      scriptPath,
      { input: args.input, seed: args.seed ?? 42 },
      schema,
      { timeout: 1000 }
    );
  }

  it('real handler pattern propagates errors correctly', async () => {
    const ctx: CommandContext = {
      services: {
        pythonEngine: () => new PythonEngine('python3'),
      },
    };

    const result = await realStyleHandler({ input: 'test', seed: 42 }, ctx);

    expect(result.success).toBe(true);
    expect(result.input_received).toBe('test');
  });

  it('real handler pattern fails loudly on error', async () => {
    const ctx: CommandContext = {
      services: {
        pythonEngine: () => new PythonEngine('python3'),
      },
    };

    // Create a handler that will fail
    async function failingHandler(ctx: CommandContext) {
      const engine = ctx.services.pythonEngine();
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      return await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
    }

    await expect(failingHandler(ctx)).rejects.toThrow(AppError);
  });

  it('real handler can be tested with mock context', async () => {
    // This demonstrates how to test handlers in isolation
    const mockEngine = new PythonEngine('python3');
    const ctx: CommandContext = {
      services: {
        pythonEngine: () => mockEngine,
      },
    };

    const result = await realStyleHandler({ input: 'mock-test' }, ctx);

    expect(result.success).toBe(true);
    expect(result.input_received).toBe('mock-test');
  });
});
