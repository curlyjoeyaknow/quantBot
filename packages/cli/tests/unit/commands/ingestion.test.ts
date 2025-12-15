/**
 * Unit tests for Ingestion Commands
 *
 * Tests command handlers, schemas, and service initialization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { TelegramAlertIngestionService, OhlcvIngestionService } from '@quantbot/ingestion';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { parseArguments } from '../../../src/core/argument-parser';
import { formatOutput } from '../../../src/core/output-formatter';

// Mock ingestion services
vi.mock('@quantbot/ingestion', () => ({
  TelegramAlertIngestionService: class {
    constructor(
      _callersRepo: unknown,
      _tokensRepo: unknown,
      _alertsRepo: unknown,
      _callsRepo: unknown
    ) {}
    ingestExport = vi.fn();
  },
  OhlcvIngestionService: class {
    constructor(_callsRepo: unknown, _tokensRepo: unknown, _alertsRepo: unknown) {}
    ingestForCalls = vi.fn();
  },
}));

// Mock storage repositories
vi.mock('@quantbot/storage', () => ({
  CallersRepository: class {},
  TokensRepository: class {},
  AlertsRepository: class {},
  CallsRepository: class {},
}));

describe('Ingestion Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Telegram Command', () => {
    const telegramSchema = z.object({
      file: z.string().min(1),
      callerName: z.string().min(1),
      chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
      chatId: z.string().optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate telegram command arguments', () => {
      const validArgs = {
        file: 'data/messages.html',
        callerName: 'Brook',
        chain: 'solana' as const,
        format: 'json' as const,
      };
      const result = parseArguments(telegramSchema, validArgs);
      expect(result.file).toBe('data/messages.html');
      expect(result.callerName).toBe('Brook');
      expect(result.chain).toBe('solana');
    });

    it('should use default chain and format', () => {
      const result = parseArguments(telegramSchema, {
        file: 'data/messages.html',
        callerName: 'Brook',
      });
      expect(result.chain).toBe('solana');
      expect(result.format).toBe('table');
    });

    it('should reject empty file path', () => {
      const invalidArgs = { file: '', callerName: 'Brook' };
      expect(() => parseArguments(telegramSchema, invalidArgs)).toThrow();
    });

    it('should reject empty caller name', () => {
      const invalidArgs = { file: 'data/messages.html', callerName: '' };
      expect(() => parseArguments(telegramSchema, invalidArgs)).toThrow();
    });

    it('should reject invalid chain', () => {
      const invalidArgs = {
        file: 'data/messages.html',
        callerName: 'Brook',
        chain: 'invalid',
      };
      expect(() => parseArguments(telegramSchema, invalidArgs)).toThrow();
    });

    it('should accept optional chatId', () => {
      const result = parseArguments(telegramSchema, {
        file: 'data/messages.html',
        callerName: 'Brook',
        chatId: '123456',
      });
      expect(result.chatId).toBe('123456');
    });

    it('should initialize TelegramAlertIngestionService with repositories', () => {
      const service = new TelegramAlertIngestionService(
        new CallersRepository(),
        new TokensRepository(),
        new AlertsRepository(),
        new CallsRepository()
      );

      expect(service).toBeDefined();
      expect(service.ingestExport).toBeDefined();
    });
  });

  describe('OHLCV Command', () => {
    const ohlcvSchema = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      preWindow: z.number().int().positive().default(260),
      postWindow: z.number().int().positive().default(1440),
      interval: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate ohlcv command arguments', () => {
      const validArgs = {
        from: '2024-01-01',
        to: '2024-02-01',
        preWindow: 300,
        postWindow: 1500,
        interval: '5m' as const,
        format: 'json' as const,
      };
      const result = parseArguments(ohlcvSchema, validArgs);
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-02-01');
      expect(result.preWindow).toBe(300);
      expect(result.postWindow).toBe(1500);
    });

    it('should use default values', () => {
      const result = parseArguments(ohlcvSchema, {});
      expect(result.preWindow).toBe(260);
      expect(result.postWindow).toBe(1440);
      expect(result.interval).toBe('5m');
      expect(result.format).toBe('table');
    });

    it('should reject negative preWindow', () => {
      const invalidArgs = { preWindow: -1 };
      expect(() => parseArguments(ohlcvSchema, invalidArgs)).toThrow();
    });

    it('should reject negative postWindow', () => {
      const invalidArgs = { postWindow: -1 };
      expect(() => parseArguments(ohlcvSchema, invalidArgs)).toThrow();
    });

    it('should reject invalid interval', () => {
      const invalidArgs = { interval: '30m' };
      expect(() => parseArguments(ohlcvSchema, invalidArgs)).toThrow();
    });

    it('should accept valid intervals', () => {
      const intervals = ['1m', '5m', '15m', '1h'] as const;
      for (const interval of intervals) {
        const result = parseArguments(ohlcvSchema, { interval });
        expect(result.interval).toBe(interval);
      }
    });

    it('should initialize OhlcvIngestionService with repositories', () => {
      const service = new OhlcvIngestionService(
        new CallsRepository(),
        new TokensRepository(),
        new AlertsRepository()
      );

      expect(service).toBeDefined();
      expect(service.ingestForCalls).toBeDefined();
    });
  });

  describe('Window Parameters', () => {
    it('should accept large window values', () => {
      const ohlcvSchema = z.object({
        preWindow: z.number().int().positive().default(260),
        postWindow: z.number().int().positive().default(1440),
      });

      const result = parseArguments(ohlcvSchema, {
        preWindow: 10000,
        postWindow: 20000,
      });

      expect(result.preWindow).toBe(10000);
      expect(result.postWindow).toBe(20000);
    });

    it('should reject zero window values', () => {
      const ohlcvSchema = z.object({
        preWindow: z.number().int().positive(),
        postWindow: z.number().int().positive(),
      });

      expect(() => parseArguments(ohlcvSchema, { preWindow: 0, postWindow: 1440 })).toThrow();
      expect(() => parseArguments(ohlcvSchema, { preWindow: 260, postWindow: 0 })).toThrow();
    });
  });

  describe('Output Formatting', () => {
    it('should format ingestion results', () => {
      const result = {
        tokensIngested: 10,
        callsIngested: 50,
        alertsIngested: 25,
      };

      const jsonOutput = formatOutput(result, 'json');
      const tableOutput = formatOutput(result, 'table');

      expect(jsonOutput).toContain('tokensIngested');
      expect(tableOutput).toContain('tokensIngested');
    });
  });
});
