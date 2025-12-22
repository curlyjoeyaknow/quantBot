/**
 * MessageIndex Tests
 *
 * Tests for building and querying message index for fast lookup
 */

import { describe, it, expect } from 'vitest';
import { MessageIndex } from '../src/MessageIndex';
import type { ParsedMessage } from '../src/TelegramExportParser';

describe('MessageIndex', () => {
  describe('single-file indexing', () => {
    it('should index messages by messageId', () => {
      const messages: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T04:37:21Z'),
          text: 'Caller message',
          from: 'AnnaGems',
        },
        {
          messageId: '149470',
          timestamp: new Date('2025-12-10T04:37:22Z'),
          text: 'Bot response',
          from: 'Rick',
          replyToMessageId: '149468',
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages48.html', messages);

      const found = index.getMessage('149468', 'messages48.html');
      expect(found).toBeDefined();
      expect(found?.from).toBe('AnnaGems');
      expect(found?.text).toBe('Caller message');
    });

    it('should find message without file specified (same file)', () => {
      const messages: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T04:37:21Z'),
          text: 'Caller message',
          from: 'AnnaGems',
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages48.html', messages);

      const found = index.getMessage('149468');
      expect(found).toBeDefined();
      expect(found?.from).toBe('AnnaGems');
    });
  });

  describe('cross-file message resolution', () => {
    it('should resolve message from different file', () => {
      const messages1: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T04:37:21Z'),
          text: 'Caller message from file 1',
          from: 'AnnaGems',
        },
      ];

      const messages2: ParsedMessage[] = [
        {
          messageId: '149470',
          timestamp: new Date('2025-12-10T04:37:22Z'),
          text: 'Bot response',
          from: 'Rick',
          replyToMessageId: '149468',
          replyToFile: 'messages47.html',
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages47.html', messages1);
      index.addMessages('messages48.html', messages2);

      // Resolve reply_to from messages48.html pointing to messages47.html
      const found = index.resolveReplyTo(messages2[0]);
      expect(found).toBeDefined();
      expect(found?.from).toBe('AnnaGems');
      expect(found?.text).toBe('Caller message from file 1');
    });

    it('should resolve same-file reply_to', () => {
      const messages: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T04:37:21Z'),
          text: 'Caller message',
          from: 'AnnaGems',
        },
        {
          messageId: '149470',
          timestamp: new Date('2025-12-10T04:37:22Z'),
          text: 'Bot response',
          from: 'Rick',
          replyToMessageId: '149468',
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages48.html', messages);

      const found = index.resolveReplyTo(messages[1]);
      expect(found).toBeDefined();
      expect(found?.from).toBe('AnnaGems');
    });
  });

  describe('duplicate message ID handling', () => {
    it('should handle duplicate message IDs across files', () => {
      const messages1: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T04:37:21Z'),
          text: 'Message from file 1',
          from: 'User1',
        },
      ];

      const messages2: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T05:37:21Z'),
          text: 'Message from file 2',
          from: 'User2',
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages47.html', messages1);
      index.addMessages('messages48.html', messages2);

      // Should find the one from the specified file
      const found1 = index.getMessage('149468', 'messages47.html');
      expect(found1?.from).toBe('User1');

      const found2 = index.getMessage('149468', 'messages48.html');
      expect(found2?.from).toBe('User2');
    });

    it('should prefer file-specific lookup when file is specified', () => {
      const messages1: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T04:37:21Z'),
          text: 'Message from file 1',
          from: 'User1',
        },
      ];

      const messages2: ParsedMessage[] = [
        {
          messageId: '149468',
          timestamp: new Date('2025-12-10T05:37:21Z'),
          text: 'Message from file 2',
          from: 'User2',
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages47.html', messages1);
      index.addMessages('messages48.html', messages2);

      // When file is specified, should get that file's message
      const found = index.getMessage('149468', 'messages47.html');
      expect(found?.from).toBe('User1');
    });
  });

  describe('missing message handling', () => {
    it('should return undefined for non-existent message', () => {
      const index = new MessageIndex();
      const found = index.getMessage('999999');
      expect(found).toBeUndefined();
    });

    it('should return undefined for reply_to with no matching message', () => {
      const messages: ParsedMessage[] = [
        {
          messageId: '149470',
          timestamp: new Date('2025-12-10T04:37:22Z'),
          text: 'Bot response',
          from: 'Rick',
          replyToMessageId: '999999', // Non-existent
        },
      ];

      const index = new MessageIndex();
      index.addMessages('messages48.html', messages);

      const found = index.resolveReplyTo(messages[0]);
      expect(found).toBeUndefined();
    });
  });
});
