import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { ChatExtractionEngine, ExtractedToken, ChatMessage } from '../../src/services/chat-extraction-engine';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('chat-extraction-engine', () => {
  let engine: ChatExtractionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ChatExtractionEngine();
  });

  describe('isBot', () => {
    it('should identify bot senders', () => {
      expect(engine.isBot('rick')).toBe(true);
      expect(engine.isBot('phanes')).toBe(true);
      expect(engine.isBot('bot')).toBe(true);
      expect(engine.isBot('wenpresale')).toBe(true);
      expect(engine.isBot('presale')).toBe(true);
      expect(engine.isBot('gempad')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(engine.isBot('RICK')).toBe(true);
      expect(engine.isBot('Phanes')).toBe(true);
      expect(engine.isBot('BOT')).toBe(true);
    });

    it('should identify non-bot senders', () => {
      expect(engine.isBot('user123')).toBe(false);
      expect(engine.isBot('trader')).toBe(false);
      expect(engine.isBot('john')).toBe(false);
    });
  });

  describe('extract', () => {
    it('should extract Solana address from message', async () => {
      const message: ChatMessage = {
        sender: 'user123',
        text: 'Check out So11111111111111111111111111111111111111112',
        timestamp: DateTime.now(),
      };

      const results = await engine.extract(message);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].mint).toBe('So11111111111111111111111111111111111111112');
      expect(results[0].chain).toBe('solana');
      expect(results[0].source).toBe('original');
    });

    it('should extract Ethereum address from message', async () => {
      const message: ChatMessage = {
        sender: 'user123',
        text: 'Token: 0x1234567890123456789012345678901234567890',
        timestamp: DateTime.now(),
      };

      const results = await engine.extract(message);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].mint).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(results[0].chain).toBe('bsc'); // Default EVM chain
    });

    it('should handle case-insensitive addresses', async () => {
      const message: ChatMessage = {
        sender: 'user123',
        text: 'so11111111111111111111111111111111111111112',
        timestamp: DateTime.now(),
      };

      const results = await engine.extract(message);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].mint).toBe('so11111111111111111111111111111111111111112');
    });

    it('should return empty array when no address found', async () => {
      const message: ChatMessage = {
        sender: 'user123',
        text: 'This is just a regular message',
        timestamp: DateTime.now(),
      };

      const results = await engine.extract(message);

      expect(results).toEqual([]);
    });

    it('should extract from bot messages when provided', async () => {
      const originalMessage: ChatMessage = {
        sender: 'user123',
        text: 'Check this out',
        timestamp: DateTime.now(),
      };

      const botMessages: ChatMessage[] = [
        {
          sender: 'rick',
          text: 'Token: So11111111111111111111111111111111111111112',
          timestamp: DateTime.now(),
          isBot: true,
        },
      ];

      const results = await engine.extract(originalMessage, botMessages);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].mint).toBe('So11111111111111111111111111111111111111112');
      expect(results[0].source).toBe('bot');
      expect(results[0].botMessageIndex).toBe(0);
    });

    it('should extract metadata from bot messages', async () => {
      const originalMessage: ChatMessage = {
        sender: 'user123',
        text: 'Check this',
        timestamp: DateTime.now(),
      };

      const botMessages: ChatMessage[] = [
        {
          sender: 'rick',
          text: 'Token: So11111111111111111111111111111111111111112\n$TEST\nUSD: $0.001',
          timestamp: DateTime.now(),
          isBot: true,
        },
      ];

      const results = await engine.extract(originalMessage, botMessages, {
        extractMetadata: true,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata?.symbol).toBe('TEST');
    });
  });

  describe('extractFromMessage', () => {
    it('should extract tokens from a single message', async () => {
      const message: ChatMessage = {
        sender: 'user123',
        text: 'Token: So11111111111111111111111111111111111111112',
        timestamp: DateTime.now(),
      };

      const results = await engine.extractFromMessage(message);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('batchExtract', () => {
    it('should extract tokens from multiple messages', async () => {
      const messages: ChatMessage[] = [
        {
          sender: 'user1',
          text: 'Token1: So11111111111111111111111111111111111111112',
          timestamp: DateTime.now(),
        },
        {
          sender: 'user2',
          text: 'Token2: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          timestamp: DateTime.now(),
        },
      ];

      const results = await engine.batchExtract(messages);

      expect(results.size).toBeGreaterThan(0);
    });

    it('should return empty map when no tokens found', async () => {
      const messages: ChatMessage[] = [
        {
          sender: 'user1',
          text: 'No tokens here',
          timestamp: DateTime.now(),
        },
      ];

      const results = await engine.batchExtract(messages);

      expect(results.size).toBe(0);
    });
  });
});

