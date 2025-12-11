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
import { Context } from 'telegraf';
/**
 * Forward message from Brook's channel to personal chat
 */
declare function forwardMessage(ctx: Context, message: any): Promise<void>;
/**
 * Start the bot
 */
declare function start(): Promise<void>;
export { forwardMessage, start };
//# sourceMappingURL=forward-brook-channel.d.ts.map