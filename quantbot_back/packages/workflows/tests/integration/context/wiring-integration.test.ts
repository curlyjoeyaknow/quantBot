/**
 * Wiring Integration Tests
 *
 * Tests that verify wiring paths work end-to-end
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createProductionContext } from '../../../src/context/createProductionContext.js';
import { createProductionContextWithPorts } from '../../../src/context/createProductionContext.js';
import { createDuckdbSimulationContext } from '../../../src/context/createDuckdbSimulationContext.js';
import type { WorkflowContext } from '../../../src/types.js';

describe('Context Factory Integration', () => {
  describe('createProductionContext', () => {
    it('should create fully functional context', () => {
      const ctx = createProductionContext();

      // Verify all context methods are callable
      expect(typeof ctx.clock.nowISO).toBe('function');
      expect(typeof ctx.ids.newRunId).toBe('function');
      expect(typeof ctx.logger.info).toBe('function');
      expect(typeof ctx.repos.strategies.getByName).toBe('function');
      expect(typeof ctx.repos.calls.list).toBe('function');
      expect(typeof ctx.repos.simulationRuns.create).toBe('function');
      expect(typeof ctx.repos.simulationResults.insertMany).toBe('function');
      expect(ctx.ohlcv.causalAccessor).toBeDefined();
      expect(typeof ctx.simulation.run).toBe('function');
    });

    it('should allow config overrides', () => {
      const mockClock = {
        nowISO: () => '2024-01-01T00:00:00.000Z',
      };

      const ctx = createProductionContext({ clock: mockClock });

      expect(ctx.clock.nowISO()).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('createProductionContextWithPorts', () => {
    it('should create context with ports', async () => {
      const ctx = await createProductionContextWithPorts();

      // Verify ports are present and functional
      expect(ctx.ports).toBeDefined();
      expect(ctx.ports.marketData).toBeDefined();
      expect(ctx.ports.execution).toBeDefined();
      expect(ctx.ports.state).toBeDefined();
      expect(ctx.ports.query).toBeDefined();
      expect(ctx.ports.telemetry).toBeDefined();
      expect(ctx.ports.clock).toBeDefined();
    });

    it('should preserve base context functionality', async () => {
      const ctx = await createProductionContextWithPorts();

      // Base context should still work
      expect(ctx.clock).toBeDefined();
      expect(ctx.ids).toBeDefined();
      expect(ctx.logger).toBeDefined();
      expect(ctx.repos).toBeDefined();
      expect(ctx.ohlcv).toBeDefined();
      expect(ctx.simulation).toBeDefined();
    });
  });

  describe('Context Factory Patterns', () => {
    it('should create independent context instances', () => {
      const ctx1 = createProductionContext();
      const ctx2 = createProductionContext();

      // Each context should be independent
      expect(ctx1).not.toBe(ctx2);
      expect(ctx1.repos).not.toBe(ctx2.repos);
      expect(ctx1.ohlcv).not.toBe(ctx2.ohlcv);
      expect(ctx1.simulation).not.toBe(ctx2.simulation);
    });

    it('should allow context composition', async () => {
      const baseCtx = createProductionContext();
      const ctxWithPorts = await createProductionContextWithPorts();

      // Both should be valid WorkflowContext instances
      expect(baseCtx).toHaveProperty('clock');
      expect(baseCtx).toHaveProperty('repos');
      expect(ctxWithPorts).toHaveProperty('clock');
      expect(ctxWithPorts).toHaveProperty('repos');
      expect(ctxWithPorts).toHaveProperty('ports');
    });
  });
});
