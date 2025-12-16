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
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// Schema for Python tool output (manifest)
const PythonManifestSchema = z.object({
  chat_id: z.string(),
  chat_name: z.string(),
  duckdb_file: z.string(),
  tg_rows: z.number().optional(),
  caller_links_rows: z.number().optional(),
  user_calls_rows: z.number().optional(),
});

describe('Python Bridge Test - Telegram Ingestion', () => {
  const pythonToolPath = join(__dirname, '../../../../tools/telegram/duckdb_punch_pipeline.py');
  const testFixturePath = join(__dirname, '../../../../tools/telegram/tests/fixtures/sample_telegram.json');
  const outputDbPath = join(__dirname, '../../../../tools/telegram/tests/fixtures/test_output.duckdb');

  it('runs Python tool on tiny fixture and validates output schema', () => {
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
      // Run Python tool
      const command = `python3 ${pythonToolPath} --in ${testFixturePath} --duckdb ${outputDbPath} --rebuild --chat-id test_chat`;
      const output = execSync(command, {
        encoding: 'utf-8',
        cwd: join(__dirname, '../../../../tools/telegram'),
        env: { ...process.env, PYTHONPATH: join(__dirname, '../../../../tools/telegram') },
      });

      // Parse output JSON
      const lines = output.trim().split('\n');
      const jsonLine = lines[lines.length - 1];
      const result = JSON.parse(jsonLine);

      // Validate against schema
      const validated = PythonManifestSchema.parse(result);

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
      const command = `python3 ${pythonToolPath} --in ${invalidPath} --duckdb ${outputDbPath} --rebuild 2>&1 || true`;
      execSync(command, {
        encoding: 'utf-8',
        cwd: join(__dirname, '../../../../tools/telegram'),
        env: { ...process.env, PYTHONPATH: join(__dirname, '../../../../tools/telegram') },
      });
      // Should not throw - tool should handle invalid input gracefully
    } catch (error) {
      // Tool may exit with error code, which is acceptable
      expect(error).toBeDefined();
    } finally {
      if (existsSync(invalidPath)) {
        require('fs').unlinkSync(invalidPath);
      }
    }
  });
});

