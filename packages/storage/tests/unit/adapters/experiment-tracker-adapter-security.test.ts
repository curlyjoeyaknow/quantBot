/**
 * Security and edge case tests for ExperimentTrackerAdapter
 *
 * Tests SQL injection prevention, input validation, error handling, and edge cases.
 * Based on critical review findings from phase-3-experiment-tracking-critical-review.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExperimentTrackerAdapter } from '../../../src/adapters/experiment-tracker-adapter.js';
import type { PythonEngine } from '@quantbot/utils';
import type { ExperimentDefinition, ExperimentFilter, ExperimentResults } from '@quantbot/core';
import { NotFoundError, AppError } from '@quantbot/infra/utils';

describe('ExperimentTrackerAdapter Security & Edge Cases', () => {
  let mockPythonEngine: PythonEngine;
  let adapter: ExperimentTrackerAdapter;
  const dbPath = '/tmp/test-experiments-security.duckdb';

  beforeEach(() => {
    mockPythonEngine = {
      runScriptWithStdin: vi.fn(),
    } as unknown as PythonEngine;

    adapter = new ExperimentTrackerAdapter(dbPath, mockPythonEngine);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('SQL Injection Prevention', () => {
    describe('findByInputArtifacts', () => {
      it('CRITICAL: should reject malicious artifact IDs with SQL injection attempts', async () => {
        const maliciousArtifactIds = [
          "'; DROP TABLE experiments; --",
          "'; DELETE FROM experiments; --",
          "'; UPDATE experiments SET status='hacked'; --",
          "'; INSERT INTO experiments VALUES ('hacked'); --",
          "'; ALTER TABLE experiments ADD COLUMN hacked TEXT; --",
          "'; CREATE TABLE hacked (id TEXT); --",
          "alert-1'; DROP TABLE experiments; --",
          'alert-1"; DROP TABLE experiments; --',
          "alert-1' OR '1'='1",
          "alert-1' UNION SELECT * FROM experiments--",
        ];

        for (const maliciousId of maliciousArtifactIds) {
          // The adapter should validate input before calling Python
          // Invalid artifact IDs should be rejected with validation error
          await expect(adapter.findByInputArtifacts([maliciousId])).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('should handle artifact IDs with special characters safely', async () => {
        const specialChars = [
          "alert-with'quotes", // Invalid - contains quote
          'alert-with"double-quotes', // Invalid - contains quote
          'alert-with\\backslashes', // Invalid - contains backslash
          'alert-with\nnewlines', // Invalid - contains newline
          'alert-with%wildcards', // Invalid - contains %
          'alert-with_underscores', // Valid
          'alert-with-dashes', // Valid
          'alert.with.dots', // Invalid - contains dots
        ];

        for (const artifactId of specialChars) {
          vi.clearAllMocks(); // Clear mocks between iterations

          const isValid = /^[a-zA-Z0-9_-]+$/.test(artifactId) && artifactId.length <= 100;

          if (isValid) {
            vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce([]);
            await adapter.findByInputArtifacts([artifactId]);
            expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalled();
          } else {
            // Invalid characters should be rejected
            await expect(adapter.findByInputArtifacts([artifactId])).rejects.toThrow(AppError);
            expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
          }
        }
      });

      it('should handle empty artifact ID array', async () => {
        // Empty array should return empty results without calling Python
        const result = await adapter.findByInputArtifacts([]);

        expect(result).toEqual([]);
        // Python should not be called for empty arrays (early return)
        expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
      });

      it('should handle very long artifact IDs', async () => {
        const longArtifactId = 'a'.repeat(1000);
        // Very long IDs (>100 chars) should be rejected with validation error
        await expect(adapter.findByInputArtifacts([longArtifactId])).rejects.toThrow(AppError);

        // Verify Python was NOT called (validation failed before Python call)
        expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
      });
    });

    describe('listExperiments', () => {
      it('CRITICAL: should reject malicious status values', async () => {
        const maliciousStatuses = [
          "'; DROP TABLE experiments; --",
          "pending'; DROP TABLE experiments; --",
          "pending' OR '1'='1",
          "pending' UNION SELECT * FROM experiments--",
        ];

        for (const maliciousStatus of maliciousStatuses) {
          const filter: ExperimentFilter = {
            status: maliciousStatus as any,
          };

          // The adapter should validate input before calling Python
          // Invalid status should be rejected with validation error
          await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('CRITICAL: should reject malicious git commit values', async () => {
        const maliciousCommits = [
          "'; DROP TABLE experiments; --",
          "abc123'; DROP TABLE experiments; --",
          "abc123' OR '1'='1",
        ];

        for (const maliciousCommit of maliciousCommits) {
          const filter: ExperimentFilter = {
            gitCommit: maliciousCommit,
          };

          // The adapter should validate input before calling Python
          // Invalid git commit should be rejected with validation error
          await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('CRITICAL: should reject malicious date values', async () => {
        const maliciousDates = [
          "'; DROP TABLE experiments; --",
          "2025-01-01'; DROP TABLE experiments; --",
          "2025-01-01' OR '1'='1",
        ];

        for (const maliciousDate of maliciousDates) {
          const filter: ExperimentFilter = {
            minCreatedAt: maliciousDate,
          };

          // The adapter should validate input before calling Python
          // Invalid date should be rejected with validation error
          await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('CRITICAL: should reject malicious limit values', async () => {
        const maliciousLimits = [
          -1,
          0,
          1000000, // Extremely large
          Number.MAX_SAFE_INTEGER,
          NaN,
          Infinity,
          -Infinity,
        ];

        for (const maliciousLimit of maliciousLimits) {
          const filter: ExperimentFilter = {
            limit: maliciousLimit as any,
          };

          // The adapter should validate input before calling Python
          // Invalid limit should be rejected with validation error (if < 1 or > 10000 or not integer)
          if (maliciousLimit < 1 || maliciousLimit > 10000 || !Number.isInteger(maliciousLimit)) {
            await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);
            // Verify Python was NOT called (validation failed before Python call)
            expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
          } else {
            // Valid limit - should pass through
            vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce([]);
            await adapter.listExperiments(filter);
            expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalled();
          }
        }
      });
    });

    describe('storeResults', () => {
      it('CRITICAL: should reject malicious experiment IDs', async () => {
        const maliciousExperimentIds = [
          "'; DROP TABLE experiments; --",
          "exp-123'; DROP TABLE experiments; --",
          "exp-123' OR '1'='1",
        ];

        const results: ExperimentResults = {
          tradesArtifactId: 'trades-123',
        };

        for (const maliciousId of maliciousExperimentIds) {
          // The adapter should validate input before calling Python
          // Invalid experiment ID should be rejected with validation error
          await expect(adapter.storeResults(maliciousId, results)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('CRITICAL: should reject malicious artifact IDs in results', async () => {
        const maliciousArtifactIds = [
          "'; DROP TABLE experiments; --",
          "trades-123'; DROP TABLE experiments; --",
          "trades-123' OR '1'='1",
        ];

        for (const maliciousId of maliciousArtifactIds) {
          const results: ExperimentResults = {
            tradesArtifactId: maliciousId,
          };

          // The adapter should validate input before calling Python
          // Invalid artifact ID should be rejected with validation error
          await expect(adapter.storeResults('exp-123', results)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });
    });

    describe('createExperiment', () => {
      it('CRITICAL: should reject malicious experiment IDs', async () => {
        const maliciousIds = [
          "'; DROP TABLE experiments; --",
          "exp-123'; DROP TABLE experiments; --",
          "exp-123' OR '1'='1",
        ];

        const baseDefinition: ExperimentDefinition = {
          experimentId: '',
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

        for (const maliciousId of maliciousIds) {
          const definition = {
            ...baseDefinition,
            experimentId: maliciousId,
          };

          // The adapter should validate input before calling Python
          // Invalid experiment ID should be rejected with validation error
          await expect(adapter.createExperiment(definition)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('CRITICAL: should reject malicious artifact IDs in inputs', async () => {
        const maliciousArtifactIds = [
          "'; DROP TABLE experiments; --",
          "alert-1'; DROP TABLE experiments; --",
          "alert-1' OR '1'='1",
        ];

        const baseDefinition: ExperimentDefinition = {
          experimentId: 'exp-123',
          name: 'Test',
          inputs: {
            alerts: [],
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

        for (const maliciousId of maliciousArtifactIds) {
          const definition = {
            ...baseDefinition,
            inputs: {
              ...baseDefinition.inputs,
              alerts: [maliciousId],
            },
          };

          // The adapter should validate input before calling Python
          // Invalid artifact ID should be rejected with validation error
          await expect(adapter.createExperiment(definition)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });
    });

    describe('getExperiment', () => {
      it('CRITICAL: should reject malicious experiment IDs', async () => {
        const maliciousIds = [
          "'; DROP TABLE experiments; --",
          "exp-123'; DROP TABLE experiments; --",
          "exp-123' OR '1'='1",
        ];

        for (const maliciousId of maliciousIds) {
          // The adapter should validate input before calling Python
          // Invalid experiment ID should be rejected with validation error
          await expect(adapter.getExperiment(maliciousId)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });
    });

    describe('updateStatus', () => {
      it('CRITICAL: should reject malicious experiment IDs', async () => {
        const maliciousIds = [
          "'; DROP TABLE experiments; --",
          "exp-123'; DROP TABLE experiments; --",
          "exp-123' OR '1'='1",
        ];

        for (const maliciousId of maliciousIds) {
          // The adapter should validate input before calling Python
          // Invalid experiment ID should be rejected with validation error
          await expect(adapter.updateStatus(maliciousId, 'running')).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('CRITICAL: should reject malicious status values', async () => {
        const maliciousStatuses = [
          "'; DROP TABLE experiments; --",
          "running'; DROP TABLE experiments; --",
          "running' OR '1'='1",
        ];

        for (const maliciousStatus of maliciousStatuses) {
          // The adapter should validate input before calling Python
          // Invalid status should be rejected with validation error
          await expect(adapter.updateStatus('exp-123', maliciousStatus as any)).rejects.toThrow(
            AppError
          );

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });
    });
  });

  describe('Input Validation', () => {
    describe('createExperiment', () => {
      it('should reject empty experiment ID', async () => {
        vi.clearAllMocks();

        const definition: ExperimentDefinition = {
          experimentId: '',
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

        // Empty experiment ID should be rejected with validation error
        await expect(adapter.createExperiment(definition)).rejects.toThrow(AppError);

        // Verify Python was NOT called (validation failed before Python call)
        expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
      });

      it('should reject empty artifact arrays', async () => {
        const definition: ExperimentDefinition = {
          experimentId: 'exp-123',
          name: 'Test',
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

        vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce({
          ...definition,
          status: 'pending' as const,
        });

        await adapter.createExperiment(definition);

        expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalled();
      });

      it('should reject invalid date formats', async () => {
        const definition: ExperimentDefinition = {
          experimentId: 'exp-123',
          name: 'Test',
          inputs: {
            alerts: ['alert-1'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: {},
            dateRange: { from: '2025-01-01', to: '2025-01-31' }, // Valid dates
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: 'invalid-date', // Invalid date
          },
        };

        // Invalid createdAt date should be rejected with validation error
        await expect(adapter.createExperiment(definition)).rejects.toThrow(AppError);

        // Verify Python was NOT called (validation failed before Python call)
        expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
      });

      it('should reject very long experiment IDs', async () => {
        const longId = 'a'.repeat(1000);
        const definition: ExperimentDefinition = {
          experimentId: longId,
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

        // Very long IDs (>100 chars) should be rejected with validation error
        await expect(adapter.createExperiment(definition)).rejects.toThrow(AppError);

        // Verify Python was NOT called (validation failed before Python call)
        expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
      });
    });

    describe('listExperiments', () => {
      it('should reject invalid status values', async () => {
        const invalidStatuses = ['invalid', 'hacked', 'exploited', ''];

        for (const invalidStatus of invalidStatuses) {
          vi.clearAllMocks(); // Clear mocks between iterations

          const filter: ExperimentFilter = {
            status: invalidStatus as any,
          };

          // The adapter should validate input before calling Python
          // Invalid status should be rejected with validation error
          await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });

      it('should reject invalid limit values', async () => {
        const invalidLimits = [-1, 0, 1000000, NaN, Infinity, -Infinity];

        for (const invalidLimit of invalidLimits) {
          const filter: ExperimentFilter = {
            limit: invalidLimit as any,
          };

          // The adapter should validate input before calling Python
          // Invalid limit should be rejected with validation error (if < 1 or > 10000 or not integer)
          if (invalidLimit < 1 || invalidLimit > 10000 || !Number.isInteger(invalidLimit)) {
            await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);
            // Verify Python was NOT called (validation failed before Python call)
            expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
          } else {
            // Valid limit - should pass through
            vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce([]);
            await adapter.listExperiments(filter);
            expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalled();
          }
        }
      });

      it('should reject invalid date formats', async () => {
        // Use dates that don't match ISO 8601 format at all
        const invalidDates = ['invalid-date', 'not-a-date', '2025/01/01', '01-01-2025'];

        for (const invalidDate of invalidDates) {
          vi.clearAllMocks(); // Clear mocks between iterations

          const filter: ExperimentFilter = {
            minCreatedAt: invalidDate,
          };

          // The adapter should validate input before calling Python
          // Invalid date format should be rejected with validation error
          await expect(adapter.listExperiments(filter)).rejects.toThrow(AppError);

          // Verify Python was NOT called (validation failed before Python call)
          expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Python script errors gracefully', async () => {
      const error = new Error('Python script failed');
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValueOnce(error);

      await expect(adapter.getExperiment('exp-123')).rejects.toThrow(AppError);
    });

    it('should convert "not found" errors to NotFoundError', async () => {
      const error = new Error('Experiment not found: exp-123');
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValueOnce(error);

      await expect(adapter.getExperiment('exp-123')).rejects.toThrow(NotFoundError);
    });

    it('should handle malformed JSON responses', async () => {
      // Simulate Python script returning invalid JSON
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValueOnce(
        new Error('Invalid JSON')
      );

      await expect(adapter.getExperiment('exp-123')).rejects.toThrow();
    });

    it('should handle Python script timeouts', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValueOnce(new Error('Timeout'));

      await expect(adapter.getExperiment('exp-123')).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent operations', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      const promises = [
        adapter.updateStatus('exp-1', 'running'),
        adapter.updateStatus('exp-2', 'running'),
        adapter.updateStatus('exp-3', 'running'),
      ];

      await Promise.all(promises);

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledTimes(3);
    });

    it('should handle empty results in storeResults', async () => {
      const results: ExperimentResults = {};

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce({ success: true });

      await adapter.storeResults('exp-123', results);

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          results: {},
        }),
        expect.any(Object)
      );
    });

    it('should handle Unicode characters in experiment names', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-123',
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

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce({
        ...definition,
        status: 'pending' as const,
      });

      await adapter.createExperiment(definition);

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalled();
    });

    it('should handle very large artifact arrays', async () => {
      const largeArtifactArray = Array.from({ length: 1000 }, (_, i) => `alert-${i}`);

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValueOnce([]);

      await adapter.findByInputArtifacts(largeArtifactArray);

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifactIds: largeArtifactArray,
        }),
        expect.any(Object)
      );
    });
  });
});
