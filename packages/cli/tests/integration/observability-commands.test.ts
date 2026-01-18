/**
 * Integration tests for Observability command handlers
 *
 * Tests the actual command execution through the command registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry } from '../../src/core/command-registry';
import { performHealthCheck, checkApiQuotas } from '@quantbot/infra/observability';
import { z } from 'zod';

// Mock observability package
vi.mock('@quantbot/infra/observability', () => ({
  performHealthCheck: vi.fn(),
  checkApiQuotas: vi.fn(),
  getErrorStats: vi.fn(),
}));

describe('Observability Commands - Integration', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new CommandRegistry();

    registry.registerPackage({
      packageName: 'observability',
      description: 'System observability and health checks',
      commands: [
        {
          name: 'health',
          description: 'Check system health',
          schema: z.object({ format: z.enum(['json', 'table', 'csv']).default('table') }),
          handler: async () => await performHealthCheck(),
        },
        {
          name: 'quotas',
          description: 'Check API quotas',
          schema: z.object({
            service: z.enum(['birdeye', 'helius', 'all']).optional(),
            format: z.enum(['json', 'table', 'csv']).default('table'),
          }),
          handler: async (args: unknown) => {
            const typedArgs = args as { service?: 'birdeye' | 'helius' | 'all' };
            const quotas = await checkApiQuotas();
            if (typedArgs.service && typedArgs.service !== 'all') {
              return { [typedArgs.service]: quotas[typedArgs.service as keyof typeof quotas] };
            }
            return quotas;
          },
        },
      ],
    });
  });

  describe('Health Command Handler', () => {
    it('should execute health command and return status', async () => {
      const mockHealth = {
        status: 'healthy',
        postgres: { healthy: true, latency: 5 },
        clickhouse: { healthy: true, latency: 10 },
        apis: {
          birdeye: { status: 'ok', latency: 100 },
          helius: { status: 'ok', latency: 50 },
        },
      };

      vi.mocked(performHealthCheck).mockResolvedValue(mockHealth);

      const command = registry.getCommand('observability', 'health');
      expect(command).toBeDefined();

      if (command) {
        const args = { format: 'json' };
        const result = await command.handler(args);

        expect(performHealthCheck).toHaveBeenCalled();
        expect(result).toEqual(mockHealth);
        expect(result.status).toBe('healthy');
      }
    });

    it('should handle unhealthy status', async () => {
      const mockHealth = {
        status: 'unhealthy',
        postgres: { healthy: false, error: 'Connection timeout' },
        clickhouse: { healthy: true },
        apis: {
          birdeye: { status: 'error', error: 'Rate limited' },
          helius: { status: 'ok' },
        },
      };

      vi.mocked(performHealthCheck).mockResolvedValue(mockHealth);

      const command = registry.getCommand('observability', 'health');

      if (command) {
        const result = await command.handler({ format: 'json' });
        expect(result.status).toBe('unhealthy');
        expect(result.postgres.healthy).toBe(false);
      }
    });

    it('should handle health check failures', async () => {
      vi.mocked(performHealthCheck).mockRejectedValue(new Error('Health check failed'));

      const command = registry.getCommand('observability', 'health');

      if (command) {
        await expect(command.handler({ format: 'json' })).rejects.toThrow('Health check failed');
      }
    });
  });

  describe('Quotas Command Handler', () => {
    it('should execute quotas command and return all quotas', async () => {
      const mockQuotas = {
        birdeye: {
          used: 1500,
          limit: 10000,
          remaining: 8500,
          resetAt: '2024-01-02T00:00:00Z',
        },
        helius: {
          used: 500,
          limit: 5000,
          remaining: 4500,
          resetAt: '2024-01-02T00:00:00Z',
        },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const command = registry.getCommand('observability', 'quotas');
      expect(command).toBeDefined();

      if (command) {
        const args = { format: 'json' };
        const result = await command.handler(args);

        expect(checkApiQuotas).toHaveBeenCalled();
        expect(result).toEqual(mockQuotas);
      }
    });

    it('should filter quotas by service', async () => {
      const mockQuotas = {
        birdeye: {
          used: 1500,
          limit: 10000,
          remaining: 8500,
        },
        helius: {
          used: 500,
          limit: 5000,
          remaining: 4500,
        },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const command = registry.getCommand('observability', 'quotas');

      if (command) {
        const args = { service: 'birdeye', format: 'json' };
        const result = await command.handler(args);

        expect(result).toHaveProperty('birdeye');
        expect(result).not.toHaveProperty('helius');
      }
    });

    it('should return all quotas when service is "all"', async () => {
      const mockQuotas = {
        birdeye: { used: 1500, limit: 10000, remaining: 8500 },
        helius: { used: 500, limit: 5000, remaining: 4500 },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const command = registry.getCommand('observability', 'quotas');

      if (command) {
        const args = { service: 'all', format: 'json' };
        const result = await command.handler(args);

        expect(result).toEqual(mockQuotas);
      }
    });

    it('should handle API quota check failures', async () => {
      vi.mocked(checkApiQuotas).mockRejectedValue(new Error('API unavailable'));

      const command = registry.getCommand('observability', 'quotas');

      if (command) {
        await expect(command.handler({ format: 'json' })).rejects.toThrow('API unavailable');
      }
    });
  });
});
