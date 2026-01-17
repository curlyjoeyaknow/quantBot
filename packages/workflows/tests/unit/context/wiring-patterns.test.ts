/**
 * Wiring Pattern Tests
 *
 * Verifies that workflows use WorkflowContext (no direct instantiation)
 * and that context factories properly wire dependencies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock API clients to avoid requiring API keys in tests
vi.mock('@quantbot/api-clients', () => ({
  getBirdeyeClient: vi.fn(() => ({
    fetchOhlcv: vi.fn(),
    fetchTokenCreationInfo: vi.fn(),
  })),
}));

import { createProductionContext } from '../../../src/context/createProductionContext.js';
import { createProductionContextWithPorts } from '../../../src/context/createProductionContext.js';
import type { WorkflowContext } from '../../../src/types.js';

describe('Workflow Context Wiring Patterns', () => {
  describe('createProductionContext', () => {
    it('should create context with all required properties', () => {
      const ctx = createProductionContext();

      // Verify context structure
      expect(ctx).toHaveProperty('clock');
      expect(ctx).toHaveProperty('ids');
      expect(ctx).toHaveProperty('logger');
      expect(ctx).toHaveProperty('repos');
      expect(ctx).toHaveProperty('ohlcv');
      expect(ctx).toHaveProperty('simulation');

      // Verify repos structure
      expect(ctx.repos).toHaveProperty('strategies');
      expect(ctx.repos).toHaveProperty('calls');
      expect(ctx.repos).toHaveProperty('simulationRuns');
      expect(ctx.repos).toHaveProperty('simulationResults');
    });

    it('should allow clock override for testing', () => {
      const mockClock = {
        nowISO: () => '2024-01-01T00:00:00.000Z',
      };

      const ctx = createProductionContext({ clock: mockClock });

      expect(ctx.clock.nowISO()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should allow logger override for testing', () => {
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const ctx = createProductionContext({ logger: mockLogger });

      ctx.logger.info('test');
      expect(mockLogger.info).toHaveBeenCalledWith('test');
    });

    it('should create fresh context instances (no singleton)', () => {
      const ctx1 = createProductionContext();
      const ctx2 = createProductionContext();

      // Should be different instances
      expect(ctx1).not.toBe(ctx2);
      expect(ctx1.repos).not.toBe(ctx2.repos);
    });
  });

  describe('createProductionContextWithPorts', () => {
    it('should create context with ports', async () => {
      const ctx = await createProductionContextWithPorts();

      // Verify ports are present
      expect(ctx).toHaveProperty('ports');
      expect(ctx.ports).toHaveProperty('marketData');
      expect(ctx.ports).toHaveProperty('execution');
      expect(ctx.ports).toHaveProperty('state');
      expect(ctx.ports).toHaveProperty('query');
      expect(ctx.ports).toHaveProperty('telemetry');
      expect(ctx.ports).toHaveProperty('clock');
    });

    it('should allow duckdb path override', async () => {
      const customPath = '/custom/path/to/duckdb';
      const ctx = await createProductionContextWithPorts({ duckdbPath: customPath });

      // Context should be created (path is used internally)
      expect(ctx).toHaveProperty('ports');
      expect(ctx.ports.state).toBeDefined();
    });
  });

  describe('Context Usage in Workflows', () => {
    it('should use context.repos instead of direct instantiation', () => {
      const ctx = createProductionContext();

      // Workflows should use ctx.repos, not new Repository()
      expect(ctx.repos.strategies.getByName).toBeDefined();
      expect(ctx.repos.calls.list).toBeDefined();
      expect(ctx.repos.simulationRuns.create).toBeDefined();
      expect(ctx.repos.simulationResults.insertMany).toBeDefined();
    });

    it('should use context.ohlcv instead of direct instantiation', () => {
      const ctx = createProductionContext();

      // Workflows should use ctx.ohlcv, not new OhlcvRepository()
      expect(ctx.ohlcv.causalAccessor).toBeDefined();
    });

    it('should use context.simulation instead of direct instantiation', () => {
      const ctx = createProductionContext();

      // Workflows should use ctx.simulation, not simulateStrategy() directly
      expect(ctx.simulation.run).toBeDefined();
    });
  });
});
