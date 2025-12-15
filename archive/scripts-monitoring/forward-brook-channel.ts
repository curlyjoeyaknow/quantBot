#!/usr/bin/env ts-node
/**
 * Brook Channel Forwarder
 * =======================
 * Monitors Brook's Telegram channel and forwards messages to your personal Telegram.
 *
 * Usage:
 *   BROOK_CHANNEL_ID=<channel_id> PERSONAL_CHAT_ID=<your_chat_id> ts-node scripts/monitoring/forward-brook-channel.ts
 *
 * Environment Variables:
 *   - BROOK_CHANNEL_ID: Telegram channel ID or username (e.g., @brookchannel or -1001234567890)
 *   - PERSONAL_CHAT_ID: Your personal Telegram chat ID to forward messages to
 *   - TELEGRAM_BOT_TOKEN: Bot token for the forwarding bot
 */

import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { logger } from '../../src/utils/logger';

const BROOK_CHANNEL_ID = process.env.BROOK_CHANNEL_ID || '';
const PERSONAL_CHAT_ID = process.env.PERSONAL_CHAT_ID || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';

if (!BROOK_CHANNEL_ID) {
  logger.error('BROOK_CHANNEL_ID environment variable is required');
  process.exit(1);
}

if (!PERSONAL_CHAT_ID) {
  logger.error('PERSONAL_CHAT_ID environment variable is required');
  process.exit(1);
}

if (!BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN or BOT_TOKEN environment variable is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Track forwarded message IDs to avoid duplicates
const forwardedMessageIds = new Set<number>();

/**
 * Forward message from Brook's channel to personal chat
 */
async function forwardMessage(ctx: Context, message: any): Promise<void> {
  try {
    const chatId = ctx.chat?.id;
    const messageId = message.message_id;

    if (!chatId || !messageId) {
      return;
    }

    // Check if this is from the Brook channel
    // Handle both numeric IDs and usernames
    let channelId: string | number = BROOK_CHANNEL_ID;
    if (!BROOK_CHANNEL_ID.startsWith('@') && !isNaN(parseInt(BROOK_CHANNEL_ID))) {
      channelId = parseInt(BROOK_CHANNEL_ID);
    }

    // Compare chat IDs (handle both string and number comparisons)
    const chatIdStr = String(chatId);
    const channelIdStr = String(channelId);

    if (chatIdStr !== channelIdStr && chatId !== channelId) {
      // Not from Brook's channel, skip
      return;
    }

    // Avoid duplicate forwards
    if (forwardedMessageIds.has(messageId)) {
      logger.debug('Message already forwarded', { messageId });
      return;
    }

    // Forward the message
    await bot.telegram.forwardMessage(PERSONAL_CHAT_ID, chatId!, messageId, {
      disable_notification: false,
    });

    forwardedMessageIds.add(messageId);
    logger.info('Forwarded message from Brook channel', {
      messageId,
      text: message.text?.substring(0, 100) || 'no text',
    });

    // Clean up old message IDs (keep last 1000)
    if (forwardedMessageIds.size > 1000) {
      const oldestIds = Array.from(forwardedMessageIds).slice(0, 100);
      oldestIds.forEach((id) => forwardedMessageIds.delete(id));
    }
  } catch (error) {
    logger.error('Error forwarding message', error as Error, {
      messageId: message.message_id,
    });
  }
}

/**
 * Handle text messages
 */
bot.on('text', async (ctx) => {
  const message = ctx.message;
  if (message) {
    await forwardMessage(ctx, message);
  }
});

/**
 * Handle photo messages (often contain token addresses in captions)
 */
bot.on('photo', async (ctx) => {
  const message = ctx.message;
  if (message) {
    await forwardMessage(ctx, message);
  }
});

/**
 * Handle document messages
 */
bot.on('document', async (ctx) => {
  const message = ctx.message;
  if (message) {
    await forwardMessage(ctx, message);
  }
});

/**
 * Handle channel posts (if bot is added to channel)
 */
bot.on('channel_post', async (ctx) => {
  const message = ctx.channelPost;
  if (message) {
    await forwardMessage(ctx, message);
  }
});

/**
 * Handle edited messages
 */
bot.on('edited_message', async (ctx) => {
  const message = ctx.editedMessage;
  if (message && 'message_id' in message) {
    await forwardMessage(ctx, message);
  }
});

/**
 * Start the bot
 */
async function start(): Promise<void> {
  try {
    logger.info('Starting Brook channel forwarder', {
      channelId: BROOK_CHANNEL_ID,
      personalChatId: PERSONAL_CHAT_ID,
    });

    // Get bot info
    const botInfo = await bot.telegram.getMe();
    logger.info('Bot initialized', { username: botInfo.username });

    // Start polling
    await bot.launch();
    logger.info('Brook channel forwarder started successfully');

    // Graceful shutdown
    process.once('SIGINT', () => {
      logger.info('Received SIGINT, shutting down...');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down...');
      bot.stop('SIGTERM');
    });
  } catch (error) {
    logger.error('Failed to start forwarder', error as Error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  start().catch((error) => {
    logger.error('Unhandled error', error as Error);
    process.exit(1);
  });
}

export { forwardMessage, start };
