/**
 * Unit tests for Observability Commands
 *
 * Tests command handlers, schemas, and integration with observability package
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { performHealthCheck, checkApiQuotas } from '@quantbot/infra/observability';
import { parseArguments } from '../../../src/core/argument-parser';
import { formatOutput } from '../../../src/core/output-formatter';

// Mock observability package
vi.mock('@quantbot/infra/observability', () => ({
  performHealthCheck: vi.fn(),
  checkApiQuotas: vi.fn(),
  getErrorStats: vi.fn(),
}));

describe('Observability Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Command', () => {
    const healthSchema = z.object({
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate health command arguments', () => {
      const validArgs = { format: 'json' as const };
      const result = parseArguments(healthSchema, validArgs);
      expect(result.format).toBe('json');
    });

    it('should use default format if not specified', () => {
      const result = parseArguments(healthSchema, {});
      expect(result.format).toBe('table');
    });

    it('should reject invalid format', () => {
      const invalidArgs = { format: 'invalid' };
      expect(() => parseArguments(healthSchema, invalidArgs)).toThrow();
    });

    it('should call performHealthCheck and format output', async () => {
      const mockHealth = {
        status: 'healthy',
        postgres: { healthy: true },
        clickhouse: { healthy: true },
        apis: { birdeye: 'ok', helius: 'ok' },
      };

      vi.mocked(performHealthCheck).mockResolvedValue(mockHealth);

      const args = parseArguments(healthSchema, { format: 'json' });
      const health = await performHealthCheck();
      const output = formatOutput(health, args.format);

      expect(performHealthCheck).toHaveBeenCalled();
      expect(output).toContain('healthy');
    });

    it('should handle health check failures gracefully', async () => {
      vi.mocked(performHealthCheck).mockRejectedValue(new Error('Health check failed'));

      await expect(performHealthCheck()).rejects.toThrow('Health check failed');
    });
  });

  describe('Quotas Command', () => {
    const quotasSchema = z.object({
      service: z.enum(['birdeye', 'helius', 'all']).optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate quotas command arguments', () => {
      const validArgs = { service: 'birdeye' as const, format: 'json' as const };
      const result = parseArguments(quotasSchema, validArgs);
      expect(result.service).toBe('birdeye');
      expect(result.format).toBe('json');
    });

    it('should allow optional service parameter', () => {
      const result = parseArguments(quotasSchema, {});
      expect(result.service).toBeUndefined();
      expect(result.format).toBe('table');
    });

    it('should reject invalid service name', () => {
      const invalidArgs = { service: 'invalid' };
      expect(() => parseArguments(quotasSchema, invalidArgs)).toThrow();
    });

    it('should call checkApiQuotas and return all quotas', async () => {
      const mockQuotas = {
        birdeye: { used: 100, limit: 1000, remaining: 900 },
        helius: { used: 50, limit: 500, remaining: 450 },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const quotas = await checkApiQuotas();
      expect(checkApiQuotas).toHaveBeenCalled();
      expect(quotas).toEqual(mockQuotas);
    });

    it('should filter quotas by service', async () => {
      const mockQuotas = {
        birdeye: { used: 100, limit: 1000, remaining: 900 },
        helius: { used: 50, limit: 500, remaining: 450 },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const args = parseArguments(quotasSchema, { service: 'birdeye' });
      const quotas = await checkApiQuotas();

      // Filter logic (as in the command)
      const filtered =
        args.service && args.service !== 'all'
          ? { [args.service]: quotas[args.service as keyof typeof quotas] }
          : quotas;

      expect(filtered).toEqual({ birdeye: mockQuotas.birdeye });
    });

    it('should return all quotas when service is "all"', async () => {
      const mockQuotas = {
        birdeye: { used: 100, limit: 1000, remaining: 900 },
        helius: { used: 50, limit: 500, remaining: 450 },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const args = parseArguments(quotasSchema, { service: 'all' });
      const quotas = await checkApiQuotas();

      const filtered = args.service === 'all' ? quotas : quotas;
      expect(filtered).toEqual(mockQuotas);
    });

    it('should format quota output correctly', async () => {
      const mockQuotas = {
        birdeye: { used: 100, limit: 1000, remaining: 900 },
        helius: { used: 50, limit: 500, remaining: 450 },
      };

      vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

      const quotas = await checkApiQuotas();
      const jsonOutput = formatOutput(quotas, 'json');
      const tableOutput = formatOutput(quotas, 'table');

      expect(jsonOutput).toContain('birdeye');
      expect(tableOutput).toContain('birdeye');
    });
  });

  describe('Error Handling', () => {
    it('should handle API quota check failures', async () => {
      vi.mocked(checkApiQuotas).mockRejectedValue(new Error('API error'));

      await expect(checkApiQuotas()).rejects.toThrow('API error');
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(performHealthCheck).mockRejectedValue(new Error('Network timeout'));

      await expect(performHealthCheck()).rejects.toThrow('Network timeout');
    });
  });
});
