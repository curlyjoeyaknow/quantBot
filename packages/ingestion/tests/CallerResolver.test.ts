/**
 * CallerResolver Tests
 *
 * Tests for resolving reply_to references to caller messages
 */

import { describe, it, expect } from 'vitest';
import { CallerResolver } from '../src/CallerResolver';
import { MessageIndex } from '../src/MessageIndex';
import type { ParsedMessage } from '../src/TelegramExportParser';

describe('CallerResolver', () => {
  describe('same-file resolution', () => {
    it('should resolve caller message from same file', () => {
      const callerMessage: ParsedMessage = {
        messageId: '149468',
        timestamp: new Date('2025-12-10T04:37:21Z'),
        text: '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump',
        from: 'AnnaGems️ (multi-chain)',
      };

      const botMessage: ParsedMessage = {
        messageId: '149470',
        timestamp: new Date('2025-12-10T04:37:22Z'),
        text: 'Bot response',
        from: 'Rick',
        replyToMessageId: '149468',
      };

      const index = new MessageIndex();
      index.addMessages('messages48.html', [callerMessage, botMessage]);

      const resolver = new CallerResolver(index);
      const resolved = resolver.resolveCaller(botMessage, 'messages48.html');

      expect(resolved).toBeDefined();
      expect(resolved?.callerName).toBe('AnnaGems️ (multi-chain)');
      expect(resolved?.callerMessageText).toBe('7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump');
      expect(resolved?.alertTimestamp).toEqual(callerMessage.timestamp);
    });
  });

  describe('cross-file resolution', () => {
    it('should resolve caller message from different file', () => {
      const callerMessage: ParsedMessage = {
        messageId: '149468',
        timestamp: new Date('2025-12-10T04:37:21Z'),
        text: 'Contract address drop',
        from: 'CallerName',
      };

      const botMessage: ParsedMessage = {
        messageId: '149470',
        timestamp: new Date('2025-12-10T04:37:22Z'),
        text: 'Bot response',
        from: 'Rick',
        replyToMessageId: '149468',
        replyToFile: 'messages47.html',
      };

      const index = new MessageIndex();
      index.addMessages('messages47.html', [callerMessage]);
      index.addMessages('messages48.html', [botMessage]);

      const resolver = new CallerResolver(index);
      const resolved = resolver.resolveCaller(botMessage, 'messages48.html');

      expect(resolved).toBeDefined();
      expect(resolved?.callerName).toBe('CallerName');
      expect(resolved?.callerMessageText).toBe('Contract address drop');
      expect(resolved?.alertTimestamp).toEqual(callerMessage.timestamp);
    });
  });

  describe('missing caller message handling', () => {
    it('should return undefined when caller message not found', () => {
      const botMessage: ParsedMessage = {
        messageId: '149470',
        timestamp: new Date('2025-12-10T04:37:22Z'),
        text: 'Bot response',
        from: 'Rick',
        replyToMessageId: '999999', // Non-existent
      };

      const index = new MessageIndex();
      index.addMessages('messages48.html', [botMessage]);

      const resolver = new CallerResolver(index);
      const resolved = resolver.resolveCaller(botMessage, 'messages48.html');

      expect(resolved).toBeUndefined();
    });

    it('should return undefined when no reply_to reference', () => {
      const botMessage: ParsedMessage = {
        messageId: '149470',
        timestamp: new Date('2025-12-10T04:37:22Z'),
        text: 'Bot response',
        from: 'Rick',
        // No replyToMessageId
      };

      const index = new MessageIndex();
      const resolver = new CallerResolver(index);
      const resolved = resolver.resolveCaller(botMessage, 'messages48.html');

      expect(resolved).toBeUndefined();
    });
  });

  describe('timestamp extraction', () => {
    it('should use caller message timestamp, not bot message timestamp', () => {
      const callerMessage: ParsedMessage = {
        messageId: '149468',
        timestamp: new Date('2025-12-10T04:37:21Z'), // Caller timestamp
        text: 'Caller message',
        from: 'Caller',
      };

      const botMessage: ParsedMessage = {
        messageId: '149470',
        timestamp: new Date('2025-12-10T04:37:25Z'), // Bot timestamp (later)
        text: 'Bot response',
        from: 'Rick',
        replyToMessageId: '149468',
      };

      const index = new MessageIndex();
      index.addMessages('messages48.html', [callerMessage, botMessage]);

      const resolver = new CallerResolver(index);
      const resolved = resolver.resolveCaller(botMessage, 'messages48.html');

      expect(resolved).toBeDefined();
      // Alert timestamp should be from caller, not bot
      expect(resolved?.alertTimestamp).toEqual(callerMessage.timestamp);
      expect(resolved?.alertTimestamp).not.toEqual(botMessage.timestamp);
    });
  });
});
