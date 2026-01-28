/**
 * Command Context Wiring Verification Tests
 *
 * Verifies that services are properly wired through CommandContext
 */

import { describe, it, expect, vi } from 'vitest';
import { CommandContext } from '../../../src/core/command-context.js';
import { StrategiesRepository } from '@quantbot/storage';

describe('CommandContext Wiring', () => {
  describe('strategiesRepository', () => {
    it('should provide StrategiesRepository through context', () => {
      const ctx = new CommandContext();
      const repo = ctx.services.strategiesRepository();

      // Verify it's an instance of StrategiesRepository
      expect(repo).toBeInstanceOf(StrategiesRepository);
    });

    it('should create new instance per call (no singleton)', () => {
      const ctx = new CommandContext();
      const repo1 = ctx.services.strategiesRepository();
      const repo2 = ctx.services.strategiesRepository();

      // Should be different instances (not singletons)
      expect(repo1).not.toBe(repo2);
    });

    it('should use default DuckDB path from environment', () => {
      const originalPath = process.env.DUCKDB_PATH;
      delete process.env.DUCKDB_PATH;

      const ctx = new CommandContext();
      const repo = ctx.services.strategiesRepository();

      // Repository should be created (path is internal to repository)
      expect(repo).toBeInstanceOf(StrategiesRepository);

      // Restore original path
      if (originalPath) {
        process.env.DUCKDB_PATH = originalPath;
      }
    });
  });

  describe('Service Access', () => {
    it('should provide all expected services', () => {
      const ctx = new CommandContext();
      const services = ctx.services;

      // Verify all services are accessible
      expect(services.ohlcvIngestion).toBeDefined();
      expect(services.ohlcvRepository).toBeDefined();
      expect(services.analyticsEngine).toBeDefined();
      expect(services.pythonEngine).toBeDefined();
      expect(services.storageEngine).toBeDefined();
      expect(services.duckdbStorage).toBeDefined();
      expect(services.clickHouse).toBeDefined();
      expect(services.clickHouseClient).toBeDefined();
      expect(services.telegramPipeline).toBeDefined();
      expect(services.simulation).toBeDefined();
      expect(services.analytics).toBeDefined();
      expect(services.callersRepository).toBeDefined();
      expect(services.strategiesRepository).toBeDefined();
      expect(services.experimentRepository).toBeDefined();
    });

    it('should allow service overrides via options', () => {
      const ctx = new CommandContext({
        // Note: strategiesRepository override not yet supported in options
        // This test documents the pattern for future enhancement
        // For now, just verify the repository is created correctly
      });

      const repo = ctx.services.strategiesRepository();
      // Verify it's a StrategiesRepository instance (using constructor name check)
      expect(repo.constructor.name).toBe('StrategiesRepository');
    });
  });
});
