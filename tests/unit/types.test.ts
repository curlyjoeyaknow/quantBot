/**
 * Type Definitions Tests
 * ======================
 * Tests for type guards and type utilities
 */

import { isCallbackQuery, isMessageUpdate, isTextMessage } from '../../src/types/telegram';
import type { Update, Message } from 'telegraf/types';

describe('Type Guards', () => {
  describe('isCallbackQuery', () => {
    it('should return true for callback query update', () => {
      const update: Update = {
        update_id: 1,
        callback_query: {
          id: '123',
          from: { id: 1, is_bot: false, first_name: 'Test' },
          data: 'test-data',
        } as any,
      };

      expect(isCallbackQuery(update)).toBe(true);
    });

    it('should return false for message update', () => {
      const update: Update = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Date.now(),
          chat: { id: 1, type: 'private' },
          text: 'test',
        } as any,
      };

      expect(isCallbackQuery(update)).toBe(false);
    });
  });

  describe('isMessageUpdate', () => {
    it('should return true for message update', () => {
      const update: Update = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Date.now(),
          chat: { id: 1, type: 'private' },
          text: 'test',
        } as any,
      };

      expect(isMessageUpdate(update)).toBe(true);
    });

    it('should return false for callback query update', () => {
      const update: Update = {
        update_id: 1,
        callback_query: {
          id: '123',
          from: { id: 1, is_bot: false, first_name: 'Test' },
        } as any,
      };

      expect(isMessageUpdate(update)).toBe(false);
    });
  });

  describe('isTextMessage', () => {
    it('should return true for text message', () => {
      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 1, type: 'private' },
        text: 'test message',
      } as Message.TextMessage;

      expect(isTextMessage(message)).toBe(true);
    });

    it('should return false for non-text message', () => {
      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 1, type: 'private' },
        photo: [],
      } as Message.PhotoMessage;

      expect(isTextMessage(message)).toBe(false);
    });
  });
});

