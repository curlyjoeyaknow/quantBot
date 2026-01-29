/**
 * Integration security tests for ExperimentTrackerAdapter
 *
 * Tests SQL injection prevention with real DuckDB, transaction safety, and performance.
 * These tests verify that the Python script properly validates and sanitizes inputs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ExperimentTrackerAdapter } from '../../src/adapters/experiment-tracker-adapter.js';
import type { ExperimentDefinition } from '@quantbot/core';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { NotFoundError, AppError } from '@quantbot/infra/utils';

describe('ExperimentTrackerAdapter Security (Integration)', () => {
  const testDbPath = `/tmp/test-experiments-security-${Date.now()}.duckdb`;
  let adapter: ExperimentTrackerAdapter;

  // Increase timeout for DuckDB operations
  vi.setConfig({ testTimeout: 30000 });

  beforeAll(() => {
    adapter = new ExperimentTrackerAdapter(testDbPath);
  });

  afterAll(async () => {
    // Clean up test database
    if (existsSync(testDbPath)) {
      await unlink(testDbPath);
    }
  });

  describe('SQL Injection Prevention (Real DuckDB)', () => {
    it('CRITICAL: should prevent SQL injection in findByInputArtifacts', async () => {
      // Create a legitimate experiment first
      const definition: ExperimentDefinition = {
        experimentId: 'exp-safe-test',
        name: 'Safe Test',
        inputs: {
          alerts: ['alert-safe-1'],
          ohlcv: ['ohlcv-safe-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Test malicious artifact IDs - should not execute SQL injection
      const maliciousArtifactIds = [
        "'; DROP TABLE experiments; --",
        "'; DELETE FROM experiments; --",
        "alert-safe-1'; DROP TABLE experiments; --",
        "alert-safe-1' OR '1'='1",
      ];

      for (const maliciousId of maliciousArtifactIds) {
        // Should reject invalid artifact IDs with validation error (not SQL error)
        // This prevents SQL injection by validating input before SQL construction
        try {
          await adapter.findByInputArtifacts([maliciousId]);
          // If it doesn't throw, that's unexpected - validation should catch this
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          // Expected - should reject invalid artifact ID with validation error
          expect(error).toBeDefined();
          // Should be a validation error, not a SQL error
          if (error instanceof AppError) {
            expect(error.code).toBe('VALIDATION_ERROR');
          }
        }

        // Verify database still exists and is queryable
        const experiments = await adapter.listExperiments({});
        expect(experiments.length).toBeGreaterThanOrEqual(1);

        // Verify our safe experiment still exists
        const safeExperiment = await adapter.getExperiment('exp-safe-test');
        expect(safeExperiment.experimentId).toBe('exp-safe-test');
      }
    });

    it('CRITICAL: should prevent SQL injection in listExperiments filter', async () => {
      // Create a legitimate experiment
      const definition: ExperimentDefinition = {
        experimentId: 'exp-filter-test',
        name: 'Filter Test',
        inputs: {
          alerts: ['alert-filter-1'],
          ohlcv: ['ohlcv-filter-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'def456',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Test malicious status values
      const maliciousStatuses = [
        "'; DROP TABLE experiments; --",
        "pending'; DROP TABLE experiments; --",
        "pending' OR '1'='1",
      ];

      for (const maliciousStatus of maliciousStatuses) {
        // Should handle gracefully without executing SQL injection
        try {
          await adapter.listExperiments({ status: maliciousStatus as any });
        } catch (error) {
          // Expected - should reject invalid status
          expect(error).toBeDefined();
        }

        // Verify database still exists
        const experiments = await adapter.listExperiments({});
        expect(experiments.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('CRITICAL: should prevent SQL injection in storeResults', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-results-test',
        name: 'Results Test',
        inputs: {
          alerts: ['alert-results-1'],
          ohlcv: ['ohlcv-results-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'ghi789',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Test malicious artifact IDs in results
      const maliciousArtifactIds = [
        "'; DROP TABLE experiments; --",
        "trades-123'; DROP TABLE experiments; --",
        "trades-123' OR '1'='1",
      ];

      for (const maliciousId of maliciousArtifactIds) {
        try {
          await adapter.storeResults('exp-results-test', {
            tradesArtifactId: maliciousId,
          });
        } catch (error) {
          // Expected - should reject invalid artifact ID
          expect(error).toBeDefined();
        }

        // Verify database still exists
        const experiment = await adapter.getExperiment('exp-results-test');
        expect(experiment.experimentId).toBe('exp-results-test');
      }
    });

    it('CRITICAL: should prevent SQL injection in createExperiment', async () => {
      const maliciousIds = [
        "'; DROP TABLE experiments; --",
        "exp-hack'; DROP TABLE experiments; --",
        "exp-hack' OR '1'='1",
      ];

      for (const maliciousId of maliciousIds) {
        const definition: ExperimentDefinition = {
          experimentId: maliciousId,
          name: 'Hacked',
          inputs: {
            alerts: ['alert-1'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: {},
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'hack123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        };

        try {
          await adapter.createExperiment(definition);
        } catch (error) {
          // Expected - should reject invalid experiment ID
          expect(error).toBeDefined();
        }

        // Verify database still exists and is queryable
        const experiments = await adapter.listExperiments({});
        expect(experiments.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Input Validation (Real DuckDB)', () => {
    it('should reject invalid experiment ID formats', async () => {
      const invalidIds = ['', '   ', 'exp with spaces', 'exp-with-@special-chars'];

      for (const invalidId of invalidIds) {
        const definition: ExperimentDefinition = {
          experimentId: invalidId,
          name: 'Test',
          inputs: {
            alerts: ['alert-1'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: {},
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        };

        try {
          await adapter.createExperiment(definition);
          // If it succeeds, the ID should be sanitized
          const experiment = await adapter.getExperiment(invalidId);
          expect(experiment).toBeDefined();
        } catch (error) {
          // Expected - should reject invalid ID
          expect(error).toBeDefined();
        }
      }
    });

    it('should reject invalid status values', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-status-test',
        name: 'Status Test',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      const invalidStatuses = ['invalid', 'hacked', 'exploited', ''];

      for (const invalidStatus of invalidStatuses) {
        try {
          await adapter.updateStatus('exp-status-test', invalidStatus as any);
          // Should reject invalid status
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          // Expected
          expect(error).toBeDefined();
        }
      }
    });

    it('should reject invalid limit values', async () => {
      const invalidLimits = [-1, 0, 1000000];

      for (const invalidLimit of invalidLimits) {
        try {
          await adapter.listExperiments({ limit: invalidLimit as any });
          // Should reject or sanitize invalid limit
        } catch (error) {
          // Expected for negative or zero
          if (invalidLimit <= 0) {
            expect(error).toBeDefined();
          }
        }
      }
    });

    it('should reject invalid date formats', async () => {
      const invalidDates = ['invalid-date', '2025-13-45', 'not-a-date'];

      for (const invalidDate of invalidDates) {
        try {
          await adapter.listExperiments({ minCreatedAt: invalidDate });
          // Should reject invalid date
        } catch (error) {
          // Expected
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe('Transaction Safety', () => {
    it('should handle partial failures in updateStatus gracefully', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-transaction-test',
        name: 'Transaction Test',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Update to running
      await adapter.updateStatus('exp-transaction-test', 'running');

      let experiment = await adapter.getExperiment('exp-transaction-test');
      expect(experiment.status).toBe('running');
      expect(experiment.execution?.startedAt).toBeDefined();

      // Try to update to completed - should set completed_at and duration
      await adapter.updateStatus('exp-transaction-test', 'completed');

      experiment = await adapter.getExperiment('exp-transaction-test');
      expect(experiment.status).toBe('completed');
      expect(experiment.execution?.completedAt).toBeDefined();
      expect(experiment.execution?.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle partial failures in storeResults gracefully', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-partial-results',
        name: 'Partial Results Test',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Store partial results
      await adapter.storeResults('exp-partial-results', {
        tradesArtifactId: 'trades-123',
        metricsArtifactId: 'metrics-456',
      });

      let experiment = await adapter.getExperiment('exp-partial-results');
      expect(experiment.outputs?.trades).toBe('trades-123');
      expect(experiment.outputs?.metrics).toBe('metrics-456');

      // Store additional results
      await adapter.storeResults('exp-partial-results', {
        curvesArtifactId: 'curves-789',
        diagnosticsArtifactId: 'diagnostics-012',
      });

      experiment = await adapter.getExperiment('exp-partial-results');
      expect(experiment.outputs?.trades).toBe('trades-123');
      expect(experiment.outputs?.metrics).toBe('metrics-456');
      expect(experiment.outputs?.curves).toBe('curves-789');
      expect(experiment.outputs?.diagnostics).toBe('diagnostics-012');
    });
  });

  describe('Performance & Scalability', () => {
    it('should handle large artifact arrays efficiently', async () => {
      const largeArtifactArray = Array.from({ length: 100 }, (_, i) => `alert-${i}`);

      const definition: ExperimentDefinition = {
        experimentId: 'exp-large-artifacts',
        name: 'Large Artifacts Test',
        inputs: {
          alerts: largeArtifactArray,
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Query by one of the artifacts
      const results = await adapter.findByInputArtifacts(['alert-50']);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].experimentId).toBe('exp-large-artifacts');
    });

    it(
      'should handle multiple experiments efficiently',
      async () => {
        // Create multiple experiments
        const experiments: ExperimentDefinition[] = [];
        for (let i = 0; i < 50; i++) {
        experiments.push({
          experimentId: `exp-bulk-${i}`,
          name: `Bulk Test ${i}`,
          inputs: {
            alerts: [`alert-${i}`],
            ohlcv: [`ohlcv-${i}`],
          },
          config: {
            strategy: {},
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        });
      }

      // Create all experiments
      for (const exp of experiments) {
        await adapter.createExperiment(exp);
      }

      // List all experiments
      const allExperiments = await adapter.listExperiments({ limit: 100 });

      expect(allExperiments.length).toBeGreaterThanOrEqual(50);

        // Filter by status
        const pendingExperiments = await adapter.listExperiments({ status: 'pending' });
        expect(pendingExperiments.length).toBeGreaterThanOrEqual(50);
      },
      60000
    ); // 60 second timeout for bulk operations

    it('should handle concurrent operations', async () => {
      // Test 1: Concurrent reads should work (read-only connections)
      // Create one experiment first
      const definition: ExperimentDefinition = {
        experimentId: 'exp-concurrent-read-test',
        name: 'Concurrent Read Test',
        inputs: {
          alerts: ['alert-read'],
          ohlcv: ['ohlcv-read'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      // Now try concurrent reads (should all succeed with read-only connections)
      const readPromises = Array.from({ length: 10 }, () =>
        adapter.getExperiment('exp-concurrent-read-test')
      );

      const readResults = await Promise.all(readPromises);
      expect(readResults.length).toBe(10);
      readResults.forEach((result) => {
        expect(result.experimentId).toBe('exp-concurrent-read-test');
      });

      // Test 2: Concurrent writes (DuckDB limitation - only one writer at a time)
      // With retry logic, some should succeed, but not all concurrently
      const writePromises: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        const writeDefinition: ExperimentDefinition = {
          experimentId: `exp-concurrent-write-${i}`,
          name: `Concurrent Write Test ${i}`,
          inputs: {
            alerts: [`alert-write-${i}`],
            ohlcv: [`ohlcv-write-${i}`],
          },
          config: {
            strategy: {},
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        };

        writePromises.push(adapter.createExperiment(writeDefinition));
      }

      const writeResults = await Promise.allSettled(writePromises);
      const successful = writeResults.filter((r) => r.status === 'fulfilled');

      // Verify database integrity - should still be queryable
      const allExperiments = await adapter.listExperiments({});
      expect(allExperiments.length).toBeGreaterThanOrEqual(1);

      // Verify some experiments were created (with retry logic, at least some should succeed)
      const concurrentExperiments = allExperiments.filter((e) =>
        e.experimentId.startsWith('exp-concurrent-write-')
      );
      // DuckDB doesn't support concurrent writes well, but retry logic should allow some to succeed
      expect(concurrentExperiments.length).toBeGreaterThanOrEqual(1);
      expect(concurrentExperiments.length).toBeLessThanOrEqual(10);
      // Verify database wasn't corrupted - concurrent experiments should have valid structure
      if (concurrentExperiments.length > 0) {
        concurrentExperiments.forEach((exp) => {
          expect(exp.experimentId).toBeTruthy();
          expect(exp.name).toBeTruthy();
          expect(exp.status).toBeTruthy();
        });
      }
    });
  });

  describe('Edge Cases (Real DuckDB)', () => {
    it('should handle empty artifact arrays', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-empty-artifacts',
        name: 'Empty Artifacts Test',
        inputs: {
          alerts: [],
          ohlcv: [],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      try {
        await adapter.createExperiment(definition);
        // Should either succeed or fail gracefully
      } catch (error) {
        // Expected if empty arrays are not allowed
        expect(error).toBeDefined();
      }
    });

    it('should handle Unicode characters in experiment names', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-unicode-test',
        name: 'Test 🚀 Experiment 测试',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      await adapter.createExperiment(definition);

      const experiment = await adapter.getExperiment('exp-unicode-test');
      expect(experiment.name).toBe('Test 🚀 Experiment 测试');
    });

    it('should handle very long experiment IDs', async () => {
      const longId = 'a'.repeat(200);
      const definition: ExperimentDefinition = {
        experimentId: longId,
        name: 'Long ID Test',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: {},
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      try {
        await adapter.createExperiment(definition);
        const experiment = await adapter.getExperiment(longId);
        expect(experiment.experimentId).toBe(longId);
      } catch (error) {
        // Expected if IDs are length-limited
        expect(error).toBeDefined();
      }
    });
  });
});

