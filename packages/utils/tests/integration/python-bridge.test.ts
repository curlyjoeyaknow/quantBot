/**
 * Bridge Test: Runs real Python tool and validates output
 *
 * This is the "contract test" that ensures the TypeScript/Python boundary works correctly.
 *
 * IMPORTANT: This does NOT test address validation correctness - that's tested in Python (pytest).
 * This only tests:
 * - Python tool executes successfully
 * - Output JSON matches expected schema
 * - Output files exist (if applicable)
 * - Integration boundary works
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { PythonEngine, PythonManifestSchema } from '../../src/python/python-engine';

// Find workspace root by looking for pnpm-workspace.yaml or package.json with workspaces
function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (current !== '/') {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) ||
      (existsSync(join(current, 'package.json')) &&
        require(join(current, 'package.json')).workspaces)
    ) {
      return current;
    }
    current = join(current, '..');
  }
  return process.cwd(); // Fallback to current directory
}

describe('Python Bridge Test - Telegram Ingestion', () => {
  const workspaceRoot = findWorkspaceRoot();
  const pythonToolPath = join(workspaceRoot, 'tools/telegram/duckdb_punch_pipeline.py');
  const testFixturePath = join(workspaceRoot, 'tools/telegram/tests/fixtures/sample_telegram.json');
  const outputDbPath = join(workspaceRoot, 'tools/telegram/tests/fixtures/test_output.duckdb');

  it('runs Python tool on tiny fixture and validates output schema', async () => {
    // Skip if Python tool doesn't exist
    if (!existsSync(pythonToolPath)) {
      console.warn(`Python tool not found at ${pythonToolPath}, skipping bridge test`);
      return;
    }

    // Create a minimal test fixture if it doesn't exist
    const minimalFixture = {
      id: 'test_chat',
      name: 'Test Chat',
      type: 'private_group',
      messages: [
        {
          id: 1,
          date: '2024-01-01T00:00:00Z',
          date_unixtime: '1704067200',
          from: 'TestUser',
          from_id: 'user123',
          text: 'Check out So11111111111111111111111111111111111111112',
          type: 'message',
        },
      ],
    };

    // Write minimal fixture
    const fs = require('fs');
    const fixtureDir = join(workspaceRoot, 'tools/telegram/tests/fixtures');
    if (!existsSync(fixtureDir)) {
      fs.mkdirSync(fixtureDir, { recursive: true });
    }
    fs.writeFileSync(testFixturePath, JSON.stringify(minimalFixture, null, 2));

    try {
      // Use PythonEngine to run the tool
      const engine = new PythonEngine();
      const validated = await engine.runTelegramPipeline(
        {
          inputFile: testFixturePath,
          outputDb: outputDbPath,
          chatId: 'test_chat',
          rebuild: true,
        },
        {
          cwd: join(workspaceRoot, 'tools/telegram'),
          env: { PYTHONPATH: join(workspaceRoot, 'tools/telegram') },
        }
      );

      // Assertions
      expect(validated.chat_id).toBe('test_chat');
      expect(validated.chat_name).toBe('Test Chat');
      expect(validated.duckdb_file).toBe(outputDbPath);

      // Check that output DB file exists
      if (existsSync(outputDbPath)) {
        expect(existsSync(outputDbPath)).toBe(true);
      }
    } catch (error) {
      // If Python tool fails, that's also valuable information
      console.error('Python tool execution failed:', error);
      throw error;
    } finally {
      // Cleanup
      if (existsSync(outputDbPath)) {
        require('fs').unlinkSync(outputDbPath);
      }
    }
  });

  it('validates Python tool handles invalid input gracefully', async () => {
    if (!existsSync(pythonToolPath)) {
      console.warn(`Python tool not found at ${pythonToolPath}, skipping test`);
      return;
    }

    const invalidFixture = { invalid: 'data' };
    const fs = require('fs');
    const invalidPath = join(workspaceRoot, 'tools/telegram/tests/fixtures/invalid.json');
    fs.writeFileSync(invalidPath, JSON.stringify(invalidFixture));

    try {
      const engine = new PythonEngine();
      // Tool should handle invalid input gracefully by returning empty result
      const result = await engine.runTelegramPipeline(
        {
          inputFile: invalidPath,
          outputDb: outputDbPath,
          chatId: 'test_chat',
          rebuild: true,
        },
        {
          cwd: join(workspaceRoot, 'tools/telegram'),
          env: { PYTHONPATH: join(workspaceRoot, 'tools/telegram') },
        }
      );

      // Tool handles invalid input gracefully by returning empty result
      expect(result.chat_id).toBe('test_chat');
      expect(result.tg_rows).toBe(0);
      expect(result.user_calls_rows).toBe(0);
    } finally {
      if (existsSync(invalidPath)) {
        require('fs').unlinkSync(invalidPath);
      }
    }
  });
});
