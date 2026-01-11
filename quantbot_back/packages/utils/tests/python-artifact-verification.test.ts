/**
 * Artifact Verification Tests
 *
 * Tests that PythonEngine can verify artifact files exist before claiming success.
 * This prevents "half-truth" runs where Python claims success but files are missing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { PythonEngine } from '../src/python/python-engine';
import { z } from 'zod';
import { ValidationError } from '../src/index';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'bad-tools');
const TEMP_DIR = join(tmpdir(), 'quantbot-artifact-tests');

describe('PythonEngine: Artifact Verification', () => {
  let engine: PythonEngine;

  beforeAll(() => {
    engine = new PythonEngine('python3');
    // Create temp directory for test artifacts
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup temp directory
    try {
      const fs = require('fs');
      if (existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Artifact existence verification', () => {
    it('fails when artifact file does not exist', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      await expect(
        engine.runScriptWithArtifacts(
          scriptPath,
          {},
          schema,
          { timeout: 1000 },
          {
            verifyArtifacts: true,
            artifactFields: ['artifacts', 'manifest'],
          }
        )
      ).rejects.toThrow(ValidationError);
    });

    it('error message lists all missing artifacts', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      try {
        await engine.runScriptWithArtifacts(
          scriptPath,
          {},
          schema,
          { timeout: 1000 },
          {
            verifyArtifacts: true,
            artifactFields: ['artifacts', 'manifest'],
          }
        );
        expect.fail('Should have thrown ValidationError');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('artifacts that do not exist');
        expect(error.context?.missingArtifacts).toBeDefined();
        expect(error.context?.missingArtifacts.length).toBeGreaterThan(0);
      }
    });

    it('succeeds when all artifacts exist', async () => {
      // Create a Python script that returns existing files
      const artifact1 = join(TEMP_DIR, 'artifact1.txt');
      const artifact2 = join(TEMP_DIR, 'artifact2.db');
      writeFileSync(artifact1, 'test data 1');
      writeFileSync(artifact2, 'test data 2');

      const scriptPath = join(TEMP_DIR, 'good_artifacts.py');
      writeFileSync(
        scriptPath,
        `#!/usr/bin/env python3
import json
import sys

output = {
    "success": True,
    "artifacts": ["${artifact1}", "${artifact2}"],
    "manifest": {
        "duckdb_file": "${artifact2}",
        "rows_processed": 100
    }
}

print(json.dumps(output))
sys.exit(0)
`
      );

      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      const result = await engine.runScriptWithArtifacts(
        scriptPath,
        {},
        schema,
        { timeout: 1000 },
        {
          verifyArtifacts: true,
          artifactFields: ['artifacts', 'manifest'],
        }
      );

      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(2);
      expect(existsSync(result.artifacts[0])).toBe(true);
      expect(existsSync(result.artifacts[1])).toBe(true);

      // Cleanup
      unlinkSync(artifact1);
      unlinkSync(artifact2);
      unlinkSync(scriptPath);
    });

    it('verification can be disabled (default behavior)', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      // Without verification, this should succeed even though files don't exist
      const result = await engine.runScript(scriptPath, {}, schema, {
        timeout: 1000,
      });

      expect(result.success).toBe(true);
      // But files don't actually exist
      expect(existsSync(result.artifacts[0])).toBe(false);
    });
  });

  describe('Partial success prevention', () => {
    it('prevents claiming success when artifacts are missing', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      // Even though Python claims success=true, verification should fail
      await expect(
        engine.runScriptWithArtifacts(
          scriptPath,
          {},
          schema,
          { timeout: 1000 },
          {
            verifyArtifacts: true,
            artifactFields: ['artifacts', 'manifest'],
          }
        )
      ).rejects.toThrow(ValidationError);
    });

    it('all-or-nothing: no partial results', async () => {
      // Create a script that claims some files exist and some don't
      const existingFile = join(TEMP_DIR, 'exists.txt');
      const missingFile = join(TEMP_DIR, 'missing.txt');
      writeFileSync(existingFile, 'data');

      const scriptPath = join(TEMP_DIR, 'partial_artifacts.py');
      writeFileSync(
        scriptPath,
        `#!/usr/bin/env python3
import json
import sys

output = {
    "success": True,
    "artifacts": ["${existingFile}", "${missingFile}"]
}

print(json.dumps(output))
sys.exit(0)
`
      );

      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
      });

      // Should fail because one artifact is missing
      await expect(
        engine.runScriptWithArtifacts(
          scriptPath,
          {},
          schema,
          { timeout: 1000 },
          {
            verifyArtifacts: true,
            artifactFields: ['artifacts'],
          }
        )
      ).rejects.toThrow(ValidationError);

      // Cleanup
      unlinkSync(existingFile);
      unlinkSync(scriptPath);
    });
  });

  describe('Nested artifact verification', () => {
    it('verifies artifacts in nested objects', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      // Verify nested manifest.duckdb_file
      await expect(
        engine.runScriptWithArtifacts(
          scriptPath,
          {},
          schema,
          { timeout: 1000 },
          {
            verifyArtifacts: true,
            artifactFields: ['manifest'], // Will recursively check duckdb_file
          }
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Error context quality', () => {
    it('includes result object in error context', async () => {
      const scriptPath = join(FIXTURES_DIR, 'missing_artifacts.py');
      const schema = z.object({
        success: z.boolean(),
        artifacts: z.array(z.string()),
        manifest: z.object({
          duckdb_file: z.string(),
          rows_processed: z.number(),
        }),
      });

      try {
        await engine.runScriptWithArtifacts(
          scriptPath,
          {},
          schema,
          { timeout: 1000 },
          {
            verifyArtifacts: true,
            artifactFields: ['artifacts'],
          }
        );
        expect.fail('Should have thrown ValidationError');
      } catch (error: any) {
        expect(error.context?.result).toBeDefined();
        expect(error.context?.result.success).toBe(true);
        expect(error.context?.missingArtifacts).toBeDefined();
      }
    });
  });
});

describe('PythonEngine: Enhanced Error Messages', () => {
  let engine: PythonEngine;

  beforeAll(() => {
    engine = new PythonEngine('python3');
  });

  describe('Schema validation errors', () => {
    it('includes Zod error details in ValidationError', async () => {
      const scriptPath = join(FIXTURES_DIR, 'wrong_schema.py');
      const schema = z.object({
        success: z.boolean(),
        required_field: z.string(),
        another_required: z.number(),
      });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown ValidationError');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('schema validation');
        expect(error.context?.zodError).toBeDefined();
        expect(error.context?.receivedData).toBeDefined();
      }
    });

    it('includes received data in error context', async () => {
      const scriptPath = join(FIXTURES_DIR, 'wrong_schema.py');
      const schema = z.object({
        success: z.boolean(),
        required_field: z.string(),
      });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown ValidationError');
      } catch (error: any) {
        expect(error.context?.receivedData).toBeDefined();
        expect(error.context?.receivedData.wrong_field).toBe('value');
      }
    });
  });

  describe('Subprocess error context', () => {
    it('truncates stderr to prevent huge error messages', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown AppError');
      } catch (error: any) {
        expect(error.context?.stderr).toBeDefined();
        expect(error.context?.stderr.length).toBeLessThanOrEqual(1000);
      }
    });

    it('includes stdout for context on non-zero exit', async () => {
      const scriptPath = join(FIXTURES_DIR, 'non_zero_exit.py');
      const schema = z.object({ success: z.boolean() });

      try {
        await engine.runScript(scriptPath, {}, schema, { timeout: 1000 });
        expect.fail('Should have thrown AppError');
      } catch (error: any) {
        // stdout should be included (truncated to 500 chars)
        expect(error.context?.stdout).toBeDefined();
        if (error.context?.stdout) {
          expect(error.context.stdout.length).toBeLessThanOrEqual(500);
        }
      }
    });
  });
});
