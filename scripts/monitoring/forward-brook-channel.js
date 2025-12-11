#!/usr/bin/env ts-node
"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.forwardMessage = forwardMessage;
exports.start = start;
require("dotenv/config");
const telegraf_1 = require("telegraf");
const logger_1 = require("../../src/utils/logger");
const BROOK_CHANNEL_ID = process.env.BROOK_CHANNEL_ID || '';
const PERSONAL_CHAT_ID = process.env.PERSONAL_CHAT_ID || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
if (!BROOK_CHANNEL_ID) {
    logger_1.logger.error('BROOK_CHANNEL_ID environment variable is required');
    process.exit(1);
}
if (!PERSONAL_CHAT_ID) {
    logger_1.logger.error('PERSONAL_CHAT_ID environment variable is required');
    process.exit(1);
}
if (!BOT_TOKEN) {
    logger_1.logger.error('TELEGRAM_BOT_TOKEN or BOT_TOKEN environment variable is required');
    process.exit(1);
}
const bot = new telegraf_1.Telegraf(BOT_TOKEN);
// Track forwarded message IDs to avoid duplicates
const forwardedMessageIds = new Set();
/**
 * Forward message from Brook's channel to personal chat
 */
async function forwardMessage(ctx, message) {
    try {
        const chatId = ctx.chat?.id;
        const messageId = message.message_id;
        if (!chatId || !messageId) {
            return;
        }
        // Check if this is from the Brook channel
        // Handle both numeric IDs and usernames
        let channelId = BROOK_CHANNEL_ID;
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
            logger_1.logger.debug('Message already forwarded', { messageId });
            return;
        }
        // Forward the message
        await bot.telegram.forwardMessage(PERSONAL_CHAT_ID, chatId, messageId, {
            disable_notification: false,
        });
        forwardedMessageIds.add(messageId);
        logger_1.logger.info('Forwarded message from Brook channel', {
            messageId,
            text: message.text?.substring(0, 100) || 'no text',
        });
        // Clean up old message IDs (keep last 1000)
        if (forwardedMessageIds.size > 1000) {
            const oldestIds = Array.from(forwardedMessageIds).slice(0, 100);
            oldestIds.forEach(id => forwardedMessageIds.delete(id));
        }
    }
    catch (error) {
        logger_1.logger.error('Error forwarding message', error, {
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
async function start() {
    try {
        logger_1.logger.info('Starting Brook channel forwarder', {
            channelId: BROOK_CHANNEL_ID,
            personalChatId: PERSONAL_CHAT_ID,
        });
        // Get bot info
        const botInfo = await bot.telegram.getMe();
        logger_1.logger.info('Bot initialized', { username: botInfo.username });
        // Start polling
        await bot.launch();
        logger_1.logger.info('Brook channel forwarder started successfully');
        // Graceful shutdown
        process.once('SIGINT', () => {
            logger_1.logger.info('Received SIGINT, shutting down...');
            bot.stop('SIGINT');
        });
        process.once('SIGTERM', () => {
            logger_1.logger.info('Received SIGTERM, shutting down...');
            bot.stop('SIGTERM');
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start forwarder', error);
        process.exit(1);
    }
}
// Run if executed directly
if (require.main === module) {
    start().catch((error) => {
        logger_1.logger.error('Unhandled error', error);
        process.exit(1);
    });
}
//# sourceMappingURL=forward-brook-channel.js.map