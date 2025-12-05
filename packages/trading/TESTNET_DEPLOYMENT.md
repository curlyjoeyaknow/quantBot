# Testnet Deployment Guide

**Status**: Ready for Deployment  
**Target**: Solana Devnet  
**Date**: December 5, 2025  

## Prerequisites

### 1. Environment Setup

Create a `.env.testnet` file:

```env
# Solana Network
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com

# Helius API
HELIUS_API_KEY=your_helius_testnet_api_key
HELIUS_REGION=mainnet

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DATABASE=quantbot_testnet

# Wallet Encryption
WALLET_ENCRYPTION_KEY=your_32_byte_hex_encryption_key

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_testnet_bot_token

# Feature Flags
LIVE_TRADING_ENABLED=false  # Start with dry-run mode
DRY_RUN_MODE=true
```

### 2. Database Setup

#### Create Testnet Database

```bash
createdb quantbot_testnet
```

#### Run Migrations

```bash
# Run all migrations in order
psql -U quantbot -d quantbot_testnet -f scripts/migration/postgres/001_initial_schema.sql
psql -U quantbot -d quantbot_testnet -f scripts/migration/postgres/002_additional_tables.sql
psql -U quantbot -d quantbot_testnet -f scripts/migration/postgres/003_live_trading.sql
```

#### Verify Schema

```bash
psql -U quantbot -d quantbot_testnet -c "\dt"
```

Expected tables:
- user_trading_configs
- wallets
- positions
- trades
- (plus existing tables)

### 3. Test Wallet Setup

#### Generate Test Wallet

```bash
solana-keygen new --no-passphrase -o testnet-wallet.json
```

#### Get Wallet Address

```bash
solana-keygen pubkey testnet-wallet.json
```

#### Request Airdrop

```bash
solana airdrop 5 <WALLET_ADDRESS> --url devnet
```

#### Verify Balance

```bash
solana balance <WALLET_ADDRESS> --url devnet
```

## Deployment Steps

### Step 1: Build All Packages

```bash
cd /path/to/quantBot

# Install dependencies
pnpm install

# Build packages in order
pnpm --filter @quantbot/utils build
pnpm --filter @quantbot/storage build
pnpm --filter @quantbot/simulation build
pnpm --filter @quantbot/monitoring build
pnpm --filter @quantbot/services build
pnpm --filter @quantbot/trading build
pnpm --filter @quantbot/bot build
```

### Step 2: Run Unit Tests

```bash
# Test trading package
cd packages/trading
pnpm test

# Verify all tests pass
```

### Step 3: Run Integration Tests

```bash
# Set environment variables
export HELIUS_API_KEY=your_testnet_key

# Run integration tests
pnpm test:integration

# Expected: All tests should pass
```

### Step 4: Initialize Database

```bash
# Create test user configuration
psql -U quantbot -d quantbot_testnet <<EOF
INSERT INTO user_trading_configs (user_id, is_live_trading_enabled, risk_profile_json, slippage_bps)
VALUES (123456789, false, '{"maxPositionSize": 0.1, "maxDailyLoss": 0.5}'::jsonb, 100);
EOF
```

### Step 5: Start Bot in Dry-Run Mode

```bash
# Set dry-run mode
export DRY_RUN_MODE=true
export LIVE_TRADING_ENABLED=false

# Start bot
cd packages/bot
pnpm start
```

### Step 6: Test Bot Commands

#### Test Wallet Commands

```
/wallet - Should list wallets (empty initially)
/wallet add - Should prompt for wallet import
```

#### Test Live Trade Commands

```
/livetrade status - Should show "Disabled"
/livetrade config - Should show current configuration
```

#### Test Position Commands

```
/positions - Should show "No open positions"
```

### Step 7: Enable Dry-Run Trading

```bash
# In Telegram bot
/livetrade enable

# Verify dry-run mode is active
/livetrade status
# Should show: "Status: Enabled (Dry Run Mode)"
```

### Step 8: Execute Test Trades

#### Test Buy Order (Dry Run)

```
/livetrade buy <TESTNET_TOKEN_ADDRESS> 0.1
```

Expected:
- Transaction simulation runs
- No actual blockchain transaction
- Trade logged in database with `dry_run=true`

#### Test Sell Order (Dry Run)

```
/livetrade sell <TESTNET_TOKEN_ADDRESS> 0.05
```

Expected:
- Dry run simulation
- Position update in database

### Step 9: Verify Logging

```bash
# Check trade logs
psql -U quantbot -d quantbot_testnet -c "SELECT * FROM trades ORDER BY created_at DESC LIMIT 5;"

# Verify dry_run flag is true
# Verify no transaction signatures
```

### Step 10: Enable Live Trading (When Ready)

**⚠️ CAUTION: This will execute real transactions on devnet**

```bash
# Update environment
export DRY_RUN_MODE=false
export LIVE_TRADING_ENABLED=true

# Restart bot
```

```
# In Telegram
/livetrade config
# Set dry_run=false

/livetrade status
# Should show: "Status: Enabled (Live Mode)"
```

## Testing Checklist

### Pre-Deployment

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Database schema is created
- [ ] Environment variables are set
- [ ] Test wallet has sufficient SOL

### Dry-Run Testing

- [ ] Bot starts successfully
- [ ] Commands respond correctly
- [ ] Wallet commands work
- [ ] Dry-run buy executes
- [ ] Dry-run sell executes
- [ ] Trades logged correctly
- [ ] No blockchain transactions sent

### Live Testing (Devnet)

- [ ] Switch to live mode
- [ ] Execute small buy order
- [ ] Verify blockchain transaction
- [ ] Check position created
- [ ] Execute sell order
- [ ] Verify position closed
- [ ] Check trade history
- [ ] Verify fees calculated

### Safety Features

- [ ] Risk manager blocks oversized positions
- [ ] Daily loss limit enforced
- [ ] Slippage protection works
- [ ] Stop-loss triggers correctly
- [ ] Take-profit executes

## Monitoring

### Real-Time Monitoring

```bash
# Watch logs
tail -f logs/quantbot.log

# Monitor database
watch -n 5 'psql -U quantbot -d quantbot_testnet -c "SELECT COUNT(*) FROM trades;"'

# Check positions
watch -n 10 'psql -U quantbot -d quantbot_testnet -c "SELECT * FROM positions WHERE status = '\''open'\'';"'
```

### Health Checks

```bash
# Check bot process
ps aux | grep quantbot

# Check database connection
psql -U quantbot -d quantbot_testnet -c "SELECT 1;"

# Check RPC connectivity
curl https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

## Troubleshooting

### Bot Won't Start

```bash
# Check logs
cat logs/quantbot-error.log

# Verify environment variables
env | grep QUANTBOT

# Test database connection
psql -U quantbot -d quantbot_testnet -c "SELECT 1;"
```

### Trades Not Executing

1. Check dry-run mode is disabled
2. Verify wallet has sufficient SOL
3. Check RPC connection
4. Verify token address is valid
5. Check slippage settings

### Database Errors

```bash
# Check migrations
psql -U quantbot -d quantbot_testnet -c "\dt"

# Verify foreign keys
psql -U quantbot -d quantbot_testnet -c "SELECT * FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY';"
```

### Transaction Failures

1. Check devnet status: https://status.solana.com/
2. Verify wallet balance
3. Check transaction logs
4. Increase priority fee
5. Adjust slippage tolerance

## Rollback Procedure

### Emergency Stop

```bash
# Stop bot immediately
pkill -f quantbot

# Disable trading in database
psql -U quantbot -d quantbot_testnet -c "UPDATE user_trading_configs SET is_live_trading_enabled = false;"
```

### Close All Positions

```sql
-- List open positions
SELECT * FROM positions WHERE status = 'open';

-- Manually close if needed
UPDATE positions SET status = 'closed', updated_at = NOW() WHERE status = 'open';
```

### Database Rollback

```bash
# If needed, restore from backup
psql -U quantbot -d quantbot_testnet < backup_before_deployment.sql
```

## Performance Metrics

### Expected Performance (Devnet)

- Transaction Confirmation: ~5-30 seconds
- RPC Latency: <200ms
- Position Update: <100ms
- Trade Logging: <50ms

### Monitoring Metrics

```sql
-- Average trade execution time
SELECT AVG(EXTRACT(EPOCH FROM (executed_at - created_at))) as avg_execution_seconds
FROM trades
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Success rate
SELECT 
  COUNT(CASE WHEN status = 'executed' THEN 1 END) * 100.0 / COUNT(*) as success_rate
FROM trades
WHERE created_at > NOW() - INTERVAL '1 day';

-- Position turnover
SELECT COUNT(*) as positions_opened_today
FROM positions
WHERE created_at > CURRENT_DATE;
```

## Security Considerations

### Testnet vs Mainnet

- Testnet tokens have NO REAL VALUE
- Test all features thoroughly before mainnet
- Never use mainnet private keys on testnet

### Access Control

- Limit who can execute live trades
- Use separate Telegram bot for testnet
- Implement admin-only commands

### Data Protection

- Encrypt sensitive data in database
- Use secure RPC endpoints
- Rotate API keys regularly

## Next Steps

After successful testnet deployment:

1. Run extended testing (24-48 hours)
2. Monitor for any errors or issues
3. Collect performance metrics
4. Get user feedback
5. Prepare mainnet deployment plan
6. Security audit (recommended)
7. Gradual mainnet rollout

## Support

For issues during deployment:
- Check logs: `logs/quantbot.log`
- Review documentation: `LIVE_TRADING_IMPLEMENTATION.md`
- Integration tests: `packages/trading/tests/integration/README.md`

## Checklist Summary

- [ ] Environment configured
- [ ] Database migrated
- [ ] Packages built
- [ ] Tests passing
- [ ] Dry-run tested
- [ ] Live tested (devnet)
- [ ] Monitoring setup
- [ ] Rollback plan ready
- [ ] Team trained
- [ ] Documentation reviewed

**Deployment Status**: ✅ Ready for Testnet

