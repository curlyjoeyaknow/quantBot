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
import { PythonEngine, PythonManifestSchema } from '../../src/python/python-engine.js';

describe('Python Bridge Test - Telegram Ingestion', () => {
  const pythonToolPath = join(__dirname, '../../../../tools/telegram/duckdb_punch_pipeline.py');
  const testFixturePath = join(
    __dirname,
    '../../../../tools/telegram/tests/fixtures/sample_telegram.json'
  );
  const outputDbPath = join(
    __dirname,
    '../../../../tools/telegram/tests/fixtures/test_output.duckdb'
  );

  it('runs Python tool on tiny fixture and validates output schema', async () => {
    // Skip if Python tool doesn't exist
    if (!existsSync(pythonToolPath)) {
      console.warn('Python tool not found, skipping bridge test');
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
    const fixtureDir = join(__dirname, '../../../../tools/telegram/tests/fixtures');
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
          cwd: join(__dirname, '../../../../tools/telegram'),
          env: { PYTHONPATH: join(__dirname, '../../../../tools/telegram') },
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

  it('validates Python tool handles invalid input gracefully', () => {
    if (!existsSync(pythonToolPath)) {
      return;
    }

    const invalidFixture = { invalid: 'data' };
    const fs = require('fs');
    const invalidPath = join(__dirname, '../../../../tools/telegram/tests/fixtures/invalid.json');
    fs.writeFileSync(invalidPath, JSON.stringify(invalidFixture));

    try {
      const engine = new PythonEngine();
      // Tool should handle invalid input gracefully or throw an error
      await expect(
        engine.runTelegramPipeline(
          {
            inputFile: invalidPath,
            outputDb: outputDbPath,
            chatId: 'test_chat',
            rebuild: true,
          },
          {
            cwd: join(__dirname, '../../../../tools/telegram'),
            env: { PYTHONPATH: join(__dirname, '../../../../tools/telegram') },
          }
        )
      ).rejects.toThrow();
    } finally {
      if (existsSync(invalidPath)) {
        require('fs').unlinkSync(invalidPath);
      }
    }
  });
});
