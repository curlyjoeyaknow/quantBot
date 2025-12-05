# Brook Channel Live Monitoring Setup

This guide explains how to set up live monitoring for Brook's Telegram channel, including automatic forwarding and ingestion into the monitoring system.

## Overview

The Brook channel monitoring system listens to your personal Telegram chat for manually forwarded messages from Brook's channel:

1. **Manual Forwarding** - You forward messages from Brook's invite-only channel to your personal Telegram chat
2. **Automatic Processing** - Bot listens to your personal chat and automatically processes forwarded messages
3. **Ingestion Module** - Parses messages, extracts token addresses, stores them in the database, and adds them to live monitoring services

**Why manual forwarding?** Brook's channel is invite-only and highly restricted, so bots cannot be added. You must use your personal Telegram account to forward messages.

## Prerequisites

1. **Telegram Bot Token** - Create a bot via [@BotFather](https://t.me/botfather)
2. **Personal Chat ID** - Your personal Telegram chat ID (get it from [@userinfobot](https://t.me/userinfobot))
3. **Access to Brook's Channel** - You must have access to Brook's invite-only channel via your personal Telegram account
4. **Birdeye API Key** - Required for token metadata fetching
5. **Optional**: Helius API Key (for live price monitoring)
6. **Optional**: Shyft X Token (for Tenkan/Kijun service)

## Setup Steps

### 1. Get Brook Channel ID

If the channel is public:

- Use the username format: `@brookchannel`

If the channel is private:

- **Add your bot to the channel as an administrator** (required!)
- Use the numeric ID format: `-1001234567890`
- You can get the ID by forwarding a message from the channel to [@userinfobot](https://t.me/userinfobot)

### 2. Add Bot to Channel

**Important**: For the bot to receive messages from Brook's channel, you must:

1. Add the bot to the channel as an administrator
2. Give it permission to read messages
3. For public channels, the bot can be added as a member

### 3. Configure Environment Variables

Add to your `.env` file:

```bash
# Required
PERSONAL_CHAT_ID=123456789  # Your personal Telegram chat ID
TELEGRAM_BOT_TOKEN=your_bot_token_here
BIRDEYE_API_KEY=your_birdeye_key_here

# Optional - for live monitoring
HELIUS_API_KEY=your_helius_key_here
SHYFT_X_TOKEN=your_shyft_token_here

# Optional - enable specific services
ENABLE_LIVE_TRADE_ALERTS=true
ENABLE_TENKAN_KIJUN_ALERTS=true
```

### 4. Start the Monitoring System

#### Start Monitoring

```bash
npm run monitor:brook
```

Or directly:

```bash
PERSONAL_CHAT_ID=123456789 \
TELEGRAM_BOT_TOKEN=your_token \
BIRDEYE_API_KEY=your_key \
ts-node scripts/monitoring/start-brook-monitoring.ts
```

**Note**: The bot listens to your personal Telegram chat. You need to manually forward messages from Brook's channel to your personal chat.

## How It Works

### Manual Forwarding Flow

1. You manually forward messages from Brook's invite-only channel to your personal Telegram chat
2. Bot listens to your personal chat for forwarded messages
3. When a forwarded message is detected, it's automatically processed
4. Duplicate detection prevents processing the same message twice

### Ingestion Flow

1. Bot listens for messages in your personal chat
2. When a message is received (including forwarded messages), it extracts token addresses
3. For each token address found:
   - Fetches token metadata from Birdeye API
   - Determines chain (Solana/EVM) from address format
   - Stores call in `caller_alerts` database
   - Adds token to live monitoring services (if enabled)
   - Sends confirmation message to your chat

### Token Address Extraction

The ingestion module extracts token addresses using multiple methods:

- Solana base58 addresses (32-44 characters)
- EVM addresses (0x + 40 hex characters)
- Addresses in code blocks (backticks)
- Phanes bot format (`├ ADDRESS└`)
- Various other common formats

## Monitoring Services

### Live Trade Alert Service

Monitors tokens for entry signals based on:

- Initial entry (10% drop from alert price)
- Trailing entry (5% rebound from low)
- Ichimoku signals (Tenkan/Kijun crosses)

**Enable with:** `ENABLE_LIVE_TRADE_ALERTS=true`

### Tenkan/Kijun Alert Service

Monitors tokens for Tenkan/Kijun cross signals:

- Bullish crosses (buy signals)
- Bearish crosses (sell signals)

**Enable with:** `ENABLE_TENKAN_KIJUN_ALERTS=true`

## Troubleshooting

### Bot Not Receiving Messages

1. **Check personal chat ID**: Verify your personal chat ID is correct
2. **Check bot token**: Ensure the bot token is valid
3. **Make sure you're forwarding**: The bot only processes messages you forward to your personal chat
4. **Check message format**: Make sure the forwarded message contains text (not just media without captions)
5. **Start chat with bot**: Send `/start` to your bot in your personal chat to ensure it can message you

### No Token Addresses Found

1. **Check message format**: The extraction looks for standard address formats
2. **Check logs**: Look for extraction debug messages
3. **Manual test**: Try sending a message with a token address directly to your personal chat

### Database Errors

1. **Check database path**: Ensure `CALLER_DB_PATH` is set correctly
2. **Check permissions**: Ensure the bot has write permissions to the database file
3. **Check database schema**: Run migrations if needed

### Monitoring Services Not Starting

1. **Check API keys**: Ensure required API keys are set
2. **Check logs**: Look for service initialization errors
3. **Check dependencies**: Ensure all npm packages are installed

## Logs

The system logs important events:

- `Forwarded message from Brook channel` - Message successfully forwarded
- `Processing Brook call` - Token address found in message
- `Stored Brook call in database` - Call saved to database
- `Added token to live trade service` - Token added to monitoring

Check logs for detailed error messages if something isn't working.

## Advanced Configuration

### Custom Caller Name

To use a different caller name (not "Brook"), modify the `CALLER_NAME` constant in `src/monitoring/brook-call-ingestion.ts`.

### Custom Entry Configuration

Modify the `DEFAULT_ENTRY_CONFIG` in `src/monitoring/live-trade-alert-service.ts` to change entry conditions.

### Multiple Channels

To monitor multiple channels, you can:

1. Run multiple forwarding scripts with different channel IDs
2. Modify the ingestion service to detect which channel a message came from
3. Use different caller names for each channel

## Security Notes

- **Never commit your `.env` file** - It contains sensitive API keys
- **Use environment variables** - Don't hardcode tokens in scripts
- **Limit bot permissions** - Only give the bot necessary permissions
- **Monitor logs** - Regularly check logs for suspicious activity

## Support

For issues or questions:

1. Check the logs for error messages
2. Verify all environment variables are set correctly
3. Ensure all dependencies are installed (`npm install`)
4. Check that the bot has proper permissions
