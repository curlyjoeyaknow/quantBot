/**
 * Telegram Bot Types
 * ==================
 * Type definitions for Telegram bot interactions.
 */

import { Context } from 'telegraf';
import type { CallbackQuery, Message, Update } from 'telegraf/types';

/**
 * Extended Telegram context with typed callback query
 */
export interface TypedCallbackQuery {
  data?: string;
  message?: Message;
  [key: string]: any;
}

/**
 * Extended Telegram context with typed message
 */
export interface TypedMessage {
  text?: string;
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Extended Telegram context
 */
export type TypedContext = Context & {
  callbackQuery?: TypedCallbackQuery;
  message?: TypedMessage;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    is_bot?: boolean;
    [key: string]: any;
  };
  chat?: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    [key: string]: any;
  };
}

/**
 * Type guard for callback query
 */
export function isCallbackQuery(update: Update): update is Update.CallbackQueryUpdate {
  return 'callback_query' in update;
}

/**
 * Type guard for message update
 */
export function isMessageUpdate(update: Update): update is Update.MessageUpdate {
  return 'message' in update;
}

/**
 * Type guard for text message
 */
export function isTextMessage(message: Message): message is Message.TextMessage {
  return 'text' in message && typeof message.text === 'string';
}

