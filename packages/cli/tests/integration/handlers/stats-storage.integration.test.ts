/**
 * Integration Tests for storageStatsWorkflowHandler
 *
 * Uses REAL implementations:
 * - Real ClickHouse connections (test database)
 * - Real QueryPort adapter
 * - Real workflows (getStorageStats)
 *
 * This tests actual integration boundaries and enforces handler purity.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { storageStatsWorkflowHandler } from '../../../src/commands/storage/stats-workflow.js';
import { createCommandContext } from '../../../src/core/command-context.js';
import { initClickHouse, closeClickHouse } from '@quantbot/storage';
import { shouldRunDbStress } from '@quantbot/utils/test-helpers/test-gating';
import { getStorageStats } from '@quantbot/workflows';
import { vi } from 'vitest';

// Gate this test suite behind RUN_DB_STRESS=1
// These tests require real database connections (ClickHouse)
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)(
  'storageStatsWorkflowHandler - Integration Tests (Real Implementations)',
  () => {
    beforeAll(async () => {
      // Initialize ClickHouse (real database)
      await initClickHouse();
    });

    afterAll(async () => {
      // Close ClickHouse connection
      await closeClickHouse();
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('INTEGRATION: handler calls workflow with real ClickHouse connection', async () => {
      // Create real command context with real services
      const ctx = createCommandContext();

      // Use real workflow, but track calls to verify handler behavior
      const workflowSpy = vi.spyOn(await import('@quantbot/workflows'), 'getStorageStats');

      const args = {
        format: 'json' as const,
      };

      // Execute handler with real context
      // Note: This will call the real workflow, which will use real ClickHouse
      // We're testing that the handler correctly orchestrates the workflow call
      const result = await storageStatsWorkflowHandler(args, ctx);

      // Assert: Handler called workflow
      expect(workflowSpy).toHaveBeenCalledTimes(1);

      // Assert: Handler returns workflow result (pure function)
      expect(Array.isArray(result)).toBe(true);
      const rows = result as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
    });

    it('INTEGRATION: handler is pure function (no side effects)', async () => {
      // This test verifies handler purity - same inputs = same outputs
      const ctx = createCommandContext();

      const workflowSpy = vi.spyOn(await import('@quantbot/workflows'), 'getStorageStats');

      const args = {
        format: 'json' as const,
      };

      // Call handler twice with same inputs
      const result1 = await storageStatsWorkflowHandler(args, ctx);
      const result2 = await storageStatsWorkflowHandler(args, ctx);

      // Assert: Handler called workflow twice (deterministic)
      expect(workflowSpy).toHaveBeenCalledTimes(2);

      // Assert: Both calls produced same results (deterministic)
      expect(result1).toEqual(result2);
    });
  }
);
