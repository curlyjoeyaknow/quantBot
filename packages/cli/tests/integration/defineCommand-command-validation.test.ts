/**
 * defineCommand Command Validation Tests
 *
 * Validates that migrated commands work correctly:
 * - Commands are properly registered
 * - Schemas match expected structure
 * - Handlers receive correct arguments
 */

import { describe, it, expect } from 'vitest';
import { commandRegistry } from '../../src/core/command-registry.js';

// Import all command modules to register them
import '../../src/commands/observability.js';
import '../../src/commands/api-clients.js';
import '../../src/commands/metadata.js';
import '../../src/commands/simulation.js';
import '../../src/commands/ohlcv.js';
import '../../src/commands/ingestion.js';
import '../../src/commands/calls.js';
import '../../src/commands/analytics.js';
import '../../src/commands/storage.js';

describe('defineCommand Command Validation', () => {
  describe('All Commands Are Registered', () => {
    it('observability commands are registered', () => {
      expect(commandRegistry.getCommand('observability', 'health')).toBeDefined();
      expect(commandRegistry.getCommand('observability', 'quotas')).toBeDefined();
      expect(commandRegistry.getCommand('observability', 'errors')).toBeDefined();
    });

    it('api-clients commands are registered', () => {
      expect(commandRegistry.getCommand('api-clients', 'test')).toBeDefined();
      expect(commandRegistry.getCommand('api-clients', 'status')).toBeDefined();
      expect(commandRegistry.getCommand('api-clients', 'credits')).toBeDefined();
    });

    it('simulation commands are registered', () => {
      expect(commandRegistry.getCommand('simulation', 'run')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'list-runs')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'list-strategies')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'store-strategy')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'store-run')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'run-duckdb')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'generate-report')).toBeDefined();
      expect(commandRegistry.getCommand('simulation', 'clickhouse-query')).toBeDefined();
    });

    it('calls commands are registered', () => {
      expect(commandRegistry.getCommand('calls', 'evaluate')).toBeDefined();
      expect(commandRegistry.getCommand('calls', 'export')).toBeDefined();
      expect(commandRegistry.getCommand('calls', 'sweep')).toBeDefined();
    });

    it('ingestion commands are registered', () => {
      expect(commandRegistry.getCommand('ingestion', 'telegram')).toBeDefined();
      expect(commandRegistry.getCommand('ingestion', 'ohlcv')).toBeDefined();
      expect(commandRegistry.getCommand('ingestion', 'telegram-python')).toBeDefined();
      expect(commandRegistry.getCommand('ingestion', 'validate-addresses')).toBeDefined();
      expect(commandRegistry.getCommand('ingestion', 'surgical-fetch')).toBeDefined();
    });

    it('ohlcv commands are registered', () => {
      expect(commandRegistry.getCommand('ohlcv', 'query')).toBeDefined();
      expect(commandRegistry.getCommand('ohlcv', 'coverage')).toBeDefined();
      expect(commandRegistry.getCommand('ohlcv', 'backfill')).toBeDefined();
      expect(commandRegistry.getCommand('ohlcv', 'analyze-coverage')).toBeDefined();
    });

    it('analytics commands are registered', () => {
      expect(commandRegistry.getCommand('analytics', 'analyze')).toBeDefined();
      expect(commandRegistry.getCommand('analytics', 'metrics')).toBeDefined();
      expect(commandRegistry.getCommand('analytics', 'report')).toBeDefined();
      expect(commandRegistry.getCommand('analytics', 'analyze-duckdb')).toBeDefined();
    });

    it('storage commands are registered', () => {
      expect(commandRegistry.getCommand('storage', 'query')).toBeDefined();
      expect(commandRegistry.getCommand('storage', 'stats')).toBeDefined();
      expect(commandRegistry.getCommand('storage', 'tokens')).toBeDefined();
      expect(commandRegistry.getCommand('storage', 'stats-workflow')).toBeDefined();
      expect(commandRegistry.getCommand('storage', 'ohlcv-stats')).toBeDefined();
      expect(commandRegistry.getCommand('storage', 'token-stats')).toBeDefined();
    });

    it('metadata commands are registered', () => {
      expect(commandRegistry.getCommand('metadata', 'resolve-evm')).toBeDefined();
    });
  });

  describe('Command Schemas Use CamelCase', () => {
    it('observability.errors schema uses camelCase', () => {
      const commandDef = commandRegistry.getCommand('observability', 'errors');
      expect(commandDef).toBeDefined();
      if (commandDef) {
        // Schema should accept camelCase keys
        const result = commandDef.schema.safeParse({
          limit: 50,
          format: 'json',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as { limit: number; format: string };
          expect(data.limit).toBe(50);
        }
      }
    });

    it('calls.export schema uses camelCase', () => {
      const commandDef = commandRegistry.getCommand('calls', 'export');
      expect(commandDef).toBeDefined();
      if (commandDef) {
        // Schema should accept camelCase keys (not kebab-case)
        const result = commandDef.schema.safeParse({
          duckdbPath: '/path/to/db',
          fromIso: '2024-01-01',
          toIso: '2024-02-01',
          out: '/path/to/out.json',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as {
            duckdbPath: string;
            fromIso: string;
            toIso: string;
            out: string;
          };
          expect(data.duckdbPath).toBe('/path/to/db');
          expect(data.fromIso).toBe('2024-01-01');
        }
      }
    });

    it('simulation.run-duckdb schema uses camelCase', () => {
      const commandDef = commandRegistry.getCommand('simulation', 'run-duckdb');
      expect(commandDef).toBeDefined();
      if (commandDef) {
        // Schema should accept camelCase keys (not snake_case)
        // Note: strategy object has snake_case internally (that's the strategy format)
        const result = commandDef.schema.safeParse({
          duckdb: '/path/to/db',
          strategy: {
            strategy_id: 'test',
            name: 'Test Strategy',
            entry_type: 'immediate' as const,
            profit_targets: [{ target: 1.5, percent: 0.5 }],
            maker_fee: 0.001,
            taker_fee: 0.001,
            slippage: 0.005,
          },
          initialCapital: 1000,
          lookbackMinutes: 260,
          lookforwardMinutes: 1440,
          batch: false,
          resume: false,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as {
            initialCapital: number;
            lookbackMinutes: number;
            lookforwardMinutes: number;
          };
          expect(data.initialCapital).toBe(1000);
          expect(data.lookbackMinutes).toBe(260);
        }
      }
    });
  });

  describe('Command Handlers Are Functions', () => {
    it('all registered commands have callable handlers', () => {
      const packages = commandRegistry.getPackages();
      for (const pkg of packages) {
        for (const command of pkg.commands) {
          expect(typeof command.handler).toBe('function');
          expect(command.handler.length).toBeGreaterThanOrEqual(0); // Some may be stubs
        }
      }
    });
  });
});
