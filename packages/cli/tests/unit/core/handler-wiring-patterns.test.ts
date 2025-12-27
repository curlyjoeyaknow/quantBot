/**
 * Handler Wiring Pattern Tests
 *
 * Verifies that handlers use CommandContext services (no direct instantiation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandContext } from '../../../src/core/command-context.js';
import { listStrategiesHandler } from '../../../src/commands/simulation/list-strategies.js';
import type { ListStrategiesArgs } from '../../../src/command-defs/simulation.js';

describe('Handler Wiring Patterns', () => {
  describe('Handlers use CommandContext', () => {
    it('should use context.services instead of direct instantiation', async () => {
      const ctx = new CommandContext();
      const args: ListStrategiesArgs = {
        format: 'json',
      };

      // Mock the repository to verify it's called through context
      const mockList = vi.fn().mockResolvedValue([]);
      const originalRepo = ctx.services.strategiesRepository();
      vi.spyOn(ctx.services, 'strategiesRepository').mockReturnValue({
        ...originalRepo,
        list: mockList,
      } as any);

      await listStrategiesHandler(args, ctx);

      // Verify handler used context service
      expect(mockList).toHaveBeenCalled();
    });

    it.skip('should handle custom duckdb path when provided', async () => {
      // Skipped: Requires real DuckDB file
      // This test verifies that handlers can accept custom duckdb paths
      // Direct instantiation is acceptable in composition roots (handlers)
      const ctx = new CommandContext();
      const args: ListStrategiesArgs = {
        duckdb: 'data/tele.duckdb',
        format: 'json',
      };

      // When custom path is provided, handler creates new instance
      // This is acceptable in composition roots
      const result = await listStrategiesHandler(args, ctx);

      expect(result).toHaveProperty('strategies');
      expect(result).toHaveProperty('count');
    });
  });

  describe('Service Access Patterns', () => {
    it('should access services through ctx.services', () => {
      const ctx = new CommandContext();

      // All services should be accessible through context
      expect(() => ctx.services.ohlcvIngestion()).not.toThrow();
      expect(() => ctx.services.ohlcvRepository()).not.toThrow();
      expect(() => ctx.services.analyticsEngine()).not.toThrow();
      expect(() => ctx.services.pythonEngine()).not.toThrow();
      expect(() => ctx.services.storageEngine()).not.toThrow();
      expect(() => ctx.services.duckdbStorage()).not.toThrow();
      expect(() => ctx.services.clickHouse()).not.toThrow();
      expect(() => ctx.services.telegramPipeline()).not.toThrow();
      expect(() => ctx.services.simulation()).not.toThrow();
      expect(() => ctx.services.analytics()).not.toThrow();
      expect(() => ctx.services.callersRepository()).not.toThrow();
      expect(() => ctx.services.strategiesRepository()).not.toThrow();
      expect(() => ctx.services.experimentRepository()).not.toThrow();
    });

    it('should create new service instances per call (no singleton)', () => {
      const ctx = new CommandContext();

      const service1 = ctx.services.ohlcvRepository();
      const service2 = ctx.services.ohlcvRepository();

      // Should be different instances
      expect(service1).not.toBe(service2);
    });
  });
});
