#!/usr/bin/env ts-node
/**
 * Start Brook Channel Monitoring
 * ==============================
 * Complete monitoring setup for Brook's channel:
 * 1. Forwards messages from Brook's channel to your personal Telegram
 * 2. Ingests forwarded calls into database and live monitoring
 *
 * Usage:
 *   BROOK_CHANNEL_ID=<channel_id> \
 *   PERSONAL_CHAT_ID=<your_chat_id> \
 *   TELEGRAM_BOT_TOKEN=<bot_token> \
 *   ts-node scripts/monitoring/start-brook-monitoring.ts
 *
 * Environment Variables:
 *   - BROOK_CHANNEL_ID: Telegram channel ID or username (e.g., @brookchannel or -1001234567890)
 *   - PERSONAL_CHAT_ID: Your personal Telegram chat ID to forward messages to
 *   - TELEGRAM_BOT_TOKEN: Bot token for the monitoring bot
 *   - HELIUS_API_KEY: (Optional) For live price monitoring
 *   - BIRDEYE_API_KEY: (Required) For token metadata
 *   - SHYFT_X_TOKEN: (Optional) For Tenkan/Kijun service
 */
import 'dotenv/config';
declare function main(): Promise<void>;
export { main };
//# sourceMappingURL=start-brook-monitoring.d.ts.map