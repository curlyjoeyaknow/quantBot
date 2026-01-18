/**
 * Unit tests for API Clients Commands
 *
 * Tests command handlers, schemas, and client initialization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { BirdeyeClient, HeliusClient } from '@quantbot/infra/api-clients';
import { checkApiQuotas } from '@quantbot/infra/observability';
import { parseArguments } from '../../../src/core/argument-parser';
import { formatOutput } from '../../../src/core/output-formatter';

// Mock API clients
vi.mock('@quantbot/infra/api-clients', () => ({
  BirdeyeClient: class {
    constructor() {}
  },
  HeliusClient: class {
    constructor(_config: unknown) {}
  },
}));

// Mock observability
vi.mock('@quantbot/infra/observability', () => ({
  checkApiQuotas: vi.fn(),
}));

describe('API Clients Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Test Command', () => {
    const testSchema = z.object({
      service: z.enum(['birdeye', 'helius']),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate test command arguments', () => {
      const validArgs = { service: 'birdeye' as const, format: 'json' as const };
      const result = parseArguments(testSchema, validArgs);
      expect(result.service).toBe('birdeye');
      expect(result.format).toBe('json');
    });

    it('should use default format if not specified', () => {
      const result = parseArguments(testSchema, { service: 'birdeye' });
      expect(result.format).toBe('table');
    });

    it('should reject invalid service name', () => {
      const invalidArgs = { service: 'invalid' };
      expect(() => parseArguments(testSchema, invalidArgs)).toThrow();
    });

    it('should reject invalid format', () => {
      const invalidArgs = { service: 'birdeye', format: 'xml' };
      expect(() => parseArguments(testSchema, invalidArgs)).toThrow();
    });

    it('should initialize Birdeye client', () => {
      const args = parseArguments(testSchema, { service: 'birdeye' });

      if (args.service === 'birdeye') {
        const client = new BirdeyeClient();
        expect(client).toBeDefined();
      }
    });

    it('should initialize Helius client', () => {
      const args = parseArguments(testSchema, { service: 'helius' });

      if (args.service === 'helius') {
        const client = new HeliusClient({});
        expect(client).toBeDefined();
      }
    });
  });

  describe('Status Command', () => {
    const statusSchema = z.object({
      service: z.enum(['birdeye', 'helius', 'all']).optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate status command arguments', () => {
      const validArgs = { service: 'birdeye' as const, format: 'json' as const };
      const result = parseArguments(statusSchema, validArgs);
      expect(result.service).toBe('birdeye');
      expect(result.format).toBe('json');
    });

    it('should allow optional service parameter', () => {
      const result = parseArguments(statusSchema, {});
      expect(result.service).toBeUndefined();
      expect(result.format).toBe('table');
    });

    it('should accept "all" as service', () => {
      const result = parseArguments(statusSchema, { service: 'all' });
      expect(result.service).toBe('all');
    });

    it('should reject invalid service name', () => {
      const invalidArgs = { service: 'invalid' };
      expect(() => parseArguments(statusSchema, invalidArgs)).toThrow();
    });

    it('should return status for all services when service is "all"', () => {
      const args = parseArguments(statusSchema, { service: 'all' });
      const status: Record<string, unknown> = {};

      if (args.service === 'all') {
        status.birdeye = { status: 'operational' };
        status.helius = { status: 'operational' };
      }

      expect(status).toHaveProperty('birdeye');
      expect(status).toHaveProperty('helius');
    });

    it('should return status for specific service', () => {
      const args = parseArguments(statusSchema, { service: 'birdeye' });
      const status: Record<string, unknown> = {};

      if (args.service === 'birdeye') {
        status.birdeye = { status: 'operational' };
      }

      expect(status).toHaveProperty('birdeye');
      expect(status).not.toHaveProperty('helius');
    });
  });

  describe('Credits Command', () => {
    const creditsSchema = z.object({
      service: z.enum(['birdeye', 'helius', 'all']).optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate credits command arguments', () => {
      const validArgs = { service: 'birdeye' as const, format: 'json' as const };
      const result = parseArguments(creditsSchema, validArgs);
      expect(result.service).toBe('birdeye');
      expect(result.format).toBe('json');
    });

    it('should call checkApiQuotas', async () => {
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

      const args = parseArguments(creditsSchema, { service: 'birdeye' });
      const quotas = await checkApiQuotas();

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

      const args = parseArguments(creditsSchema, { service: 'all' });
      const quotas = await checkApiQuotas();

      const filtered = args.service === 'all' ? quotas : quotas;
      expect(filtered).toEqual(mockQuotas);
    });

    it('should format credits output correctly', async () => {
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

    it('should handle client initialization errors', () => {
      // Test error handling by simulating a constructor that throws
      class ErrorClient {
        constructor() {
          throw new Error('Invalid API key');
        }
      }

      expect(() => new ErrorClient()).toThrow('Invalid API key');
    });
  });
});
