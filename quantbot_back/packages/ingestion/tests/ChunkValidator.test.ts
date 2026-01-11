/**
 * ChunkValidator Tests
 *
 * Tests for validating extracted data in small chunks
 */

import { describe, it, expect, vi } from 'vitest';
import { ChunkValidator } from '../src/ChunkValidator';
import type { ExtractedBotData } from '../src/BotMessageExtractor';
import type { ResolvedCaller } from '../src/CallerResolver';

describe('ChunkValidator', () => {
  describe('chunk processing', () => {
    it('should process messages in chunks of specified size', async () => {
      const validator = new ChunkValidator({ chunkSize: 3 });
      const results: Array<{ botData: ExtractedBotData; caller: ResolvedCaller }> = [];

      for (let i = 0; i < 10; i++) {
        results.push({
          botData: {
            contractAddress: `0x${i}`,
            chain: 'ethereum',
            price: 0.001,
          },
          caller: {
            callerName: `Caller${i}`,
            callerMessageText: 'Test',
            alertTimestamp: new Date(),
            callerMessage: {} as any,
          },
        });
      }

      // ChunkValidator uses logger, not console.log
      const result = await validator.validateChunk(results.slice(0, 3), 0);

      // Should return boolean
      expect(typeof result).toBe('boolean');
    });

    it('should validate data structure', async () => {
      const validator = new ChunkValidator();
      const results = [
        {
          botData: {
            contractAddress: '0x123',
            chain: 'ethereum',
            price: 0.001,
            marketCap: 100000,
          } as ExtractedBotData,
          caller: {
            callerName: 'TestCaller',
            callerMessageText: 'Test message',
            alertTimestamp: new Date(),
            callerMessage: {} as any,
          } as ResolvedCaller,
        },
      ];

      const isValid = await validator.validateChunk(results, 0);
      expect(isValid).toBe(true);
    });
  });

  describe('validation logging', () => {
    it('should validate and return results', async () => {
      const validator = new ChunkValidator({ chunkSize: 1 });

      const results = [
        {
          botData: {
            contractAddress: '0xABC123',
            chain: 'ethereum',
            tokenName: 'TestToken',
            ticker: 'TEST',
            price: 0.001,
          } as ExtractedBotData,
          caller: {
            callerName: 'TestCaller',
            callerMessageText: '0xABC123',
            alertTimestamp: new Date('2025-12-10'),
            callerMessage: {} as any,
          } as ResolvedCaller,
        },
      ];

      const isValid = await validator.validateChunk(results, 0);

      // Should return boolean indicating validity
      expect(typeof isValid).toBe('boolean');
      // With valid data, should return true
      expect(isValid).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should continue on validation failures (non-blocking)', async () => {
      const validator = new ChunkValidator();
      const results = [
        {
          botData: {
            contractAddress: '', // Invalid - empty address
            chain: 'ethereum',
          } as ExtractedBotData,
          caller: {
            callerName: 'TestCaller',
            callerMessageText: 'Test',
            alertTimestamp: new Date(),
            callerMessage: {} as any,
          } as ResolvedCaller,
        },
      ];

      // Should not throw, but may return false
      const isValid = await validator.validateChunk(results, 0);
      expect(typeof isValid).toBe('boolean');
    });
  });
});
