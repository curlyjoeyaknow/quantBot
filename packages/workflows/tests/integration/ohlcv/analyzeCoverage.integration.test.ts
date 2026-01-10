/**
 * Integration tests for analyzeCoverage workflow
 *
 * Tests with REAL Python scripts and REAL databases.
 * Focus: End-to-end workflow, Python integration, actual data processing
 *
 * These tests are designed to be CHALLENGING and expose real issues.
 *
 * Requirements:
 * - ClickHouse running (localhost:8123)
 * - DuckDB with test data
 * - Set RUN_DB_STRESS=1 to enable these tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { analyzeCoverage } from '../../../src/ohlcv/analyzeCoverage.js';
import type { AnalyzeCoverageContext } from '../../../src/ohlcv/analyzeCoverage.js';
import { DateTime } from 'luxon';
import { PythonEngine, logger } from '@quantbot/utils';
import { shouldRunDbStress } from '@quantbot/utils/test-helpers/test-gating';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Gate these tests behind RUN_DB_STRESS=1
// These tests require ClickHouse and real database connections
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)('analyzeCoverage integration tests', () => {
  const testDir = join(process.cwd(), 'test-data', 'coverage-analysis');
  const testDuckdbPath = join(testDir, 'test-calls.duckdb');
  let pythonEngine: PythonEngine;
  let context: AnalyzeCoverageContext;

  beforeAll(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Create test DuckDB with sample data
    const setupScript = `
import duckdb
import sys

db_path = sys.argv[1]
conn = duckdb.connect(db_path)

# Create caller_links_d table with sample data
conn.execute("""
  CREATE TABLE IF NOT EXISTS caller_links_d (
    trigger_from_name VARCHAR,
    mint VARCHAR,
    trigger_ts_ms BIGINT,
    chain VARCHAR
  )
""")

# Insert sample data - Brook with some calls in Dec 2025
# Timestamps: Dec 1-5, 2025 (UTC)
conn.execute("""
  INSERT INTO caller_links_d VALUES
    ('Brook', '22B2rUzC5eNUh4vEf11VxrSZvqFYy7Nfj5ANrAatZRBW', 1764547200000, 'solana'),
    ('Brook', 'So11111111111111111111111111111111111111112', 1764633600000, 'solana'),
    ('Brook', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1764720000000, 'solana'),
    ('Lsy', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 1764806400000, 'solana'),
    ('Lsy', 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 1764892800000, 'solana')
""")

conn.close()
print("Test database created successfully")
`;

    try {
      execSync(`python3 -c "${setupScript.replace(/"/g, '\\"')}" "${testDuckdbPath}"`, {
        encoding: 'utf-8',
      });
    } catch (error) {
      console.error('Failed to create test database:', error);
      throw error;
    }

    // Initialize Python engine
    pythonEngine = new PythonEngine();

    // Create context
    context = {
      pythonEngine,
      logger: {
        info: (msg: string, meta?: Record<string, unknown>) => {
          logger.info(msg, { service: 'test', ...meta });
        },
        error: (msg: string, meta?: Record<string, unknown>) => {
          logger.error(msg, { service: 'test', ...meta });
        },
        debug: (msg: string, meta?: Record<string, unknown>) => {
          logger.debug(msg, { service: 'test', ...meta });
        },
      },
      clock: {
        now: () => DateTime.utc(),
      },
    };
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Caller Coverage Analysis (Real Python Script)', () => {
    it('should analyze caller coverage with real DuckDB data', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        minCoverage: 0.8,
      };

      const result = await analyzeCoverage(spec, context);

      // Verify structure
      expect(result.analysisType).toBe('caller');
      expect(result.callers).toBeInstanceOf(Array);
      expect(result.months).toBeInstanceOf(Array);
      expect(result.matrix).toBeDefined();
      expect(result.metadata).toBeDefined();

      // Verify we found our test callers
      expect(result.callers).toContain('Brook');
      expect(result.callers).toContain('Lsy');

      // Verify month detection (Dec 2025)
      expect(result.months).toContain('2025-12');

      // Verify matrix structure
      expect(result.matrix.Brook).toBeDefined();
      expect(result.matrix.Brook['2025-12']).toBeDefined();
      expect(result.matrix.Brook['2025-12'].total_calls).toBeGreaterThan(0);
      expect(result.matrix.Brook['2025-12'].coverage_ratio).toBeGreaterThanOrEqual(0);
      expect(result.matrix.Brook['2025-12'].coverage_ratio).toBeLessThanOrEqual(1);

      // Verify metadata
      expect(result.metadata.duckdbPath).toBe(testDuckdbPath);
      expect(result.metadata.interval).toBe('5m');
      expect(result.metadata.minCoverage).toBe(0.8);
      expect(result.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }, 30000); // 30 second timeout for real Python execution

    it('should filter by specific caller', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        caller: 'Brook',
        interval: '5m' as const,
      };

      const result = await analyzeCoverage(spec, context);

      // Should only have Brook
      expect(result.callers).toEqual(['Brook']);
      expect(result.matrix.Brook).toBeDefined();
      expect(result.matrix.Lsy).toBeUndefined();
    }, 30000);

    it('should generate fetch plan when requested', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        generateFetchPlan: true,
        minCoverage: 1.0, // Require perfect coverage to generate plan
      };

      const result = await analyzeCoverage(spec, context);

      // Fetch plan should exist (since we have no OHLCV data, coverage will be 0%)
      expect(result.fetchPlan).toBeDefined();
      expect(Array.isArray(result.fetchPlan)).toBe(true);

      // Verify fetch plan structure
      if (result.fetchPlan && result.fetchPlan.length > 0) {
        const task = result.fetchPlan[0];
        expect(task.caller).toBeDefined();
        expect(task.month).toBeDefined();
        expect(task.missing_mints).toBeInstanceOf(Array);
        expect(task.total_calls).toBeGreaterThan(0);
        expect(task.calls_with_coverage).toBeGreaterThanOrEqual(0);
        expect(task.current_coverage).toBeGreaterThanOrEqual(0);
        expect(task.priority).toBeGreaterThanOrEqual(0);
      }
    }, 30000);

    it('should handle month range filtering', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        startMonth: '2025-12',
        endMonth: '2025-12',
      };

      const result = await analyzeCoverage(spec, context);

      // Should only have Dec 2025
      expect(result.months).toEqual(['2025-12']);
    }, 30000);

    it('should handle non-existent caller gracefully', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        caller: 'NonExistentCaller',
      };

      const result = await analyzeCoverage(spec, context);

      // Should return empty results, not error
      expect(result.callers).toEqual([]);
      expect(result.months).toEqual([]);
      expect(result.matrix).toEqual({});
    }, 30000);
  });

  describe('Stress Tests', () => {
    it('should handle minimum coverage threshold of 0', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        minCoverage: 0.0,
        generateFetchPlan: true,
      };

      const result = await analyzeCoverage(spec, context);

      // Should work without errors
      expect(result.analysisType).toBe('caller');
      // With 0% threshold, fetch plan should be empty or minimal
      expect(result.fetchPlan).toBeDefined();
    }, 30000);

    it('should handle maximum coverage threshold of 1', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
        minCoverage: 1.0,
        generateFetchPlan: true,
      };

      const result = await analyzeCoverage(spec, context);

      // Should work without errors
      expect(result.analysisType).toBe('caller');
      // With 100% threshold, all callers should be in fetch plan (since we have no OHLCV data)
      expect(result.fetchPlan).toBeDefined();
      if (result.fetchPlan) {
        expect(result.fetchPlan.length).toBeGreaterThan(0);
      }
    }, 30000);

    it('should handle concurrent analysis requests', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
      };

      // Run 3 analyses concurrently
      const results = await Promise.all([
        analyzeCoverage(spec, context),
        analyzeCoverage(spec, context),
        analyzeCoverage(spec, context),
      ]);

      // All should succeed
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.analysisType).toBe('caller');
        expect(result.callers).toContain('Brook');
      });
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should handle non-existent DuckDB file', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: join(testDir, 'non-existent.duckdb'),
      };

      await expect(analyzeCoverage(spec, context)).rejects.toThrow();
    }, 30000);

    it('should handle corrupted DuckDB file', async () => {
      const corruptedPath = join(testDir, 'corrupted.duckdb');

      // Create a file with invalid content
      execSync(`echo "not a valid duckdb file" > "${corruptedPath}"`);

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: corruptedPath,
      };

      await expect(analyzeCoverage(spec, context)).rejects.toThrow();
    }, 30000);
  });

  describe('Result Serialization', () => {
    it('should return JSON-serializable results', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
      };

      const result = await analyzeCoverage(spec, context);

      // Should be able to JSON.stringify without errors
      expect(() => JSON.stringify(result)).not.toThrow();

      // Parse and verify
      const parsed = JSON.parse(JSON.stringify(result));
      expect(parsed.analysisType).toBe('caller');
      expect(parsed.callers).toBeInstanceOf(Array);
      expect(parsed.metadata.generatedAt).toBeDefined();

      // No Date objects (should be ISO strings)
      expect(typeof parsed.metadata.generatedAt).toBe('string');
    }, 30000);

    it('should have no circular references', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
      };

      const result = await analyzeCoverage(spec, context);

      // JSON.stringify will throw on circular references
      expect(() => JSON.stringify(result)).not.toThrow();
    }, 30000);
  });

  describe('Performance', () => {
    it('should complete analysis within reasonable time', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: testDuckdbPath,
      };

      const startTime = Date.now();
      await analyzeCoverage(spec, context);
      const duration = Date.now() - startTime;

      // Should complete in under 10 seconds for small dataset
      expect(duration).toBeLessThan(10000);
    }, 30000);
  });
});
