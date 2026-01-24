# Credentials Setup Guide

## Quick Setup Summary

### ✅ Already Configured

- **ClickHouse**: User `quantbot_app`, Password `00995598009P`
- **InfluxDB**: Username `admin`, Password `admin123456` (initial setup)

### 🔧 Setup Steps

#### 1. InfluxDB Token (Required)

After starting InfluxDB, you need to get the admin token:

```bash
# Start InfluxDB
docker-compose up -d influxdb

# Wait for it to be ready (about 10 seconds)
sleep 10

# Option 1: Get token from container logs
docker-compose logs influxdb | grep -i token

# Option 2: Visit UI and complete setup
# Open http://localhost:8086 in your browser
# Use credentials:
#   Username: admin
#   Password: admin123456
#   Organization: quantbot
#   Bucket: quantbot_metrics
# Copy the admin token and add to .env:
#   INFLUX_TOKEN=your_token_here
```

#### 2. API Keys (Required for Data Fetching)

Add these to your `.env` file:

```bash
# Birdeye API (for price data)
# Get from: https://birdeye.so/
BIRDEYE_API_KEY=your_key_here

# Helius API (for Solana blockchain)
# Get from: https://helius.dev/
HELIUS_API_KEY=your_key_here

# Shyft API (optional, for Yellowstone gRPC)
# Get from: https://shyft.to/
SHYFT_API_KEY=your_key_here
SHYFT_X_TOKEN=your_token_here
```

#### 3. Telegram Bot (Optional)

If you want Telegram notifications:

```bash
# Create bot via @BotFather on Telegram
# Get bot token and add to .env:
BOT_TOKEN=your_bot_token_here
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Update chat IDs with your actual Telegram IDs
TELEGRAM_DEFAULT_CHAT=your_chat_id
ADMIN_USERS=your_user_id
```

## Current Credentials

### InfluxDB
- **URL**: http://localhost:8086
- **Username**: admin
- **Password**: admin123456
- **Organization**: quantbot
- **Bucket**: quantbot_metrics
- **Token**: ⚠️ **Need to get after first setup**

### ClickHouse
- **Host**: localhost
- **Port**: 18123 (HTTP), 19000 (Native)
- **User**: quantbot_app
- **Password**: 00995598009P
- **Database**: quantbot

## Verification

Test your credentials:

```bash
# Test ClickHouse connection
curl "http://localhost:18123/?user=quantbot_app&password=00995598009P&query=SELECT 1"

# Test InfluxDB (after getting token)
curl -H "Authorization: Token YOUR_INFLUX_TOKEN" http://localhost:8086/api/v2/buckets
```

## Troubleshooting

### InfluxDB Token Not Working

1. Check if InfluxDB is running: `docker-compose ps influxdb`
2. Check logs: `docker-compose logs influxdb`
3. Reset InfluxDB (⚠️ deletes data):
   ```bash
   docker-compose down influxdb
   docker volume rm quantbot-consolidation-work_influxdb-data
   docker-compose up -d influxdb
   ```

### ClickHouse Connection Issues

1. Check if ClickHouse is running: `docker-compose ps clickhouse`
2. Verify port mapping: Should be accessible on port 18123
3. Check credentials match docker-compose.yml

## Security Notes

⚠️ **Important**: 
- Never commit `.env` file to git (it's in .gitignore)
- Use strong passwords in production
- Rotate API keys regularly
- Use environment-specific credentials for different environments

