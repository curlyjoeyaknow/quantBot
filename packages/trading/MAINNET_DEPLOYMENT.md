# Mainnet Deployment with Dust Testing

**Strategy**: Mainnet-only deployment with ultra-small position sizes  
**Rationale**: Real market conditions, real liquidity, real slippage - just minimal capital at risk  
**Date**: December 5, 2025  

## Philosophy

**Why Skip Testnet:**
- Testnet tokens have no liquidity
- Testnet doesn't reflect real market conditions
- Testnet DEXes behave differently
- Mainnet with 0.001 SOL positions = real testing with minimal risk

**Risk Management:**
- Start with dust amounts (0.001-0.01 SOL)
- Gradually increase as confidence builds
- Real market feedback immediately
- Actual transaction costs and slippage

## Prerequisites

### 1. Environment Setup

Create `.env.production`:

```env
# Solana Network
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Helius API (Mainnet)
HELIUS_API_KEY=your_mainnet_helius_api_key
HELIUS_REGION=amsterdam

# Database (Production)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_secure_production_password
POSTGRES_DATABASE=quantbot_production

# Wallet Encryption
WALLET_ENCRYPTION_KEY=your_32_byte_hex_encryption_key_production

# Telegram Bot (Production)
TELEGRAM_BOT_TOKEN=your_production_bot_token

# Trading Limits - START CONSERVATIVE
MAX_POSITION_SIZE_SOL=0.01  # 0.01 SOL max per trade initially
MAX_TOTAL_EXPOSURE_SOL=0.05  # 0.05 SOL total exposure
DAILY_LOSS_LIMIT_SOL=0.02  # 0.02 SOL daily loss limit

# Feature Flags
LIVE_TRADING_ENABLED=false  # Start with dry-run
DRY_RUN_MODE=true  # Test dry-run first on mainnet
```

### 2. Production Database Setup

```bash
# Create production database
createdb quantbot_production

# Run migrations
psql -U quantbot -d quantbot_production -f scripts/migration/postgres/001_initial_schema.sql
psql -U quantbot -d quantbot_production -f scripts/migration/postgres/002_additional_tables.sql
psql -U quantbot -d quantbot_production -f scripts/migration/postgres/003_live_trading.sql

# Set conservative initial limits
psql -U quantbot -d quantbot_production <<EOF
INSERT INTO user_trading_configs (
  user_id, 
  is_live_trading_enabled, 
  risk_profile_json, 
  slippage_bps
) VALUES (
  YOUR_USER_ID, 
  false, 
  '{
    "maxPositionSize": 0.01,
    "maxTotalExposure": 0.05,
    "maxDailyLoss": 0.02
  }'::jsonb, 
  500  -- 5% slippage initially for dust trades
);
EOF
```

### 3. Trading Wallet Setup

```bash
# Generate production wallet OR import existing
solana-keygen new --no-passphrase -o mainnet-trading-wallet.json

# Get address
WALLET_ADDRESS=$(solana-keygen pubkey mainnet-trading-wallet.json)
echo "Trading wallet: $WALLET_ADDRESS"

# Fund with minimal SOL for testing
# Transfer 0.1 SOL to start (enough for ~10 dust trades + fees)
solana transfer $WALLET_ADDRESS 0.1 --url mainnet-beta

# Verify balance
solana balance $WALLET_ADDRESS --url mainnet-beta
```

## Deployment Phases

### Phase 1: Dry-Run on Mainnet (2-4 hours)

**Purpose**: Validate all systems work with real mainnet data, zero risk

```bash
# Set dry-run mode
export DRY_RUN_MODE=true
export LIVE_TRADING_ENABLED=false

# Build and start
cd /home/memez/quantBot
pnpm --filter @quantbot/trading build
cd packages/bot
pnpm start
```

**Test Cases**:
```
/livetrade status
# Should show: "Status: Disabled"

/livetrade enable
# Enables dry-run mode

# Test with real mainnet token (but dry-run)
/livetrade buy So11111111111111111111111111111111111111112 0.001
# Wrapped SOL, simulates but doesn't execute

/positions
# Should show simulated position

/livetrade sell <position_id> 100
# Simulates selling 100% of position
```

**Validation**:
- [ ] Mainnet RPC connection works
- [ ] Real token prices fetched
- [ ] Transaction simulation successful
- [ ] Dry-run trades logged correctly
- [ ] No actual blockchain transactions
- [ ] Database records marked `dry_run=true`

### Phase 2: Dust Trades on Mainnet (Day 1)

**Position Sizing**: 0.001 SOL per trade

```bash
# Enable live trading with dust amounts
export DRY_RUN_MODE=false
export LIVE_TRADING_ENABLED=true

# Restart bot
```

**First Live Trade**:
```
# In Telegram
/livetrade config
# Verify max position size = 0.01 SOL

# Execute first dust trade
/livetrade buy <LIQUID_TOKEN_ADDRESS> 0.001

# Expected:
# - Transaction submits to mainnet
# - ~0.001 SOL + fees (0.000005) deducted
# - Position opens in database
# - Transaction signature returned
# - Telegram notification sent
```

**Recommended Test Tokens** (High Liquidity):
- Wrapped SOL: `So11111111111111111111111111111111111111112`
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Any Pump.fun token with >$50k volume

**Day 1 Test Sequence**:
1. **Buy 0.001 SOL of liquid token** → Monitor for 5 minutes
2. **Sell 50%** → Verify partial close works
3. **Hold for 30 minutes** → Test position monitoring
4. **Close remaining** → Verify full position closure
5. **Repeat with different token** → Test multiple positions

**Monitoring**:
```bash
# Watch trades
watch -n 5 'psql -U quantbot -d quantbot_production -c "SELECT * FROM trades ORDER BY created_at DESC LIMIT 5;"'

# Monitor positions
watch -n 10 'psql -U quantbot -d quantbot_production -c "SELECT * FROM positions WHERE status = '\''open'\'';"'

# Check balances
watch -n 30 'solana balance YOUR_WALLET --url mainnet-beta'
```

### Phase 3: Small Trades (Day 2-3)

**Position Sizing**: 0.005-0.01 SOL per trade

```bash
# Update limits in database
psql -U quantbot -d quantbot_production <<EOF
UPDATE user_trading_configs 
SET risk_profile_json = '{
  "maxPositionSize": 0.01,
  "maxTotalExposure": 0.1,
  "maxDailyLoss": 0.05
}'::jsonb
WHERE user_id = YOUR_USER_ID;
EOF
```

**Test Scenarios**:
1. **Multiple Concurrent Positions** (3-5 positions of 0.01 SOL each)
2. **Stop-Loss Testing** (Set 10% stop-loss, monitor trigger)
3. **Take-Profit Testing** (Set 20% take-profit, monitor execution)
4. **Slippage Handling** (Try illiquid tokens, verify protection)
5. **Daily Loss Limit** (Execute losing trades, verify limit enforcement)

**Metrics to Track**:
- Transaction success rate (target: >95%)
- Average slippage (should match market)
- Fee costs (should be ~0.000005 SOL per tx)
- Position tracking accuracy
- Stop-loss trigger accuracy

### Phase 4: Normal Operation (Week 1)

**Position Sizing**: 0.05-0.1 SOL per trade (still conservative)

```bash
# Gradually increase limits based on confidence
psql -U quantbot -d quantbot_production <<EOF
UPDATE user_trading_configs 
SET risk_profile_json = '{
  "maxPositionSize": 0.1,
  "maxTotalExposure": 0.5,
  "maxDailyLoss": 0.2
}'::jsonb
WHERE user_id = YOUR_USER_ID;
EOF
```

**Automation Testing**:
- Enable alert-to-trade automation
- Test CA drop alerts → auto buy
- Test Ichimoku signals → auto buy/sell
- Monitor automated execution for 24-48 hours

**Performance Monitoring**:
```sql
-- Daily P&L
SELECT 
  DATE(created_at) as trade_date,
  COUNT(*) as num_trades,
  SUM(CASE WHEN type = 'buy' THEN cost_sol ELSE 0 END) as total_bought,
  SUM(CASE WHEN type = 'sell' THEN cost_sol ELSE 0 END) as total_sold,
  SUM(CASE WHEN type = 'sell' THEN cost_sol ELSE -cost_sol END) as net_pnl
FROM trades
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY trade_date DESC;
```

### Phase 5: Scale Up (Week 2+)

**Only after successful Week 1**:

```bash
# Increase to normal position sizes
psql -U quantbot -d quantbot_production <<EOF
UPDATE user_trading_configs 
SET risk_profile_json = '{
  "maxPositionSize": 1.0,
  "maxTotalExposure": 10.0,
  "maxDailyLoss": 5.0
}'::jsonb
WHERE user_id = YOUR_USER_ID;
EOF
```

**Conditions for Scale-Up**:
- [ ] >100 successful dust trades executed
- [ ] >95% transaction success rate
- [ ] Stop-loss and take-profit working correctly
- [ ] No critical bugs discovered
- [ ] Monitoring and alerts functioning
- [ ] Comfortable with system behavior

## Safety Features

### Circuit Breakers

**Automatic Trading Halt If**:
- Daily loss limit reached
- >3 consecutive failed transactions
- Wallet balance < 0.01 SOL
- >10% slippage on any trade
- Database connection lost

**Manual Override**:
```sql
-- Emergency stop all trading
UPDATE user_trading_configs 
SET is_live_trading_enabled = false;

-- Close all positions
UPDATE positions 
SET status = 'closed' 
WHERE status = 'open';
```

### Risk Limits (Conservative Start)

| Limit Type | Initial | After Week 1 | Production |
|------------|---------|--------------|------------|
| Max Position | 0.01 SOL | 0.1 SOL | 1.0 SOL |
| Total Exposure | 0.05 SOL | 0.5 SOL | 10.0 SOL |
| Daily Loss | 0.02 SOL | 0.2 SOL | 5.0 SOL |
| Slippage | 5% | 2% | 1% |

### Wallet Security

**Private Key Management**:
```bash
# Encrypt wallet before storing
WALLET_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Store encrypted key in database (done by WalletManager)
# NEVER log or expose private key

# Backup encrypted wallet
pg_dump quantbot_production -t wallets > wallet_backup_$(date +%Y%m%d).sql
```

**Multi-Wallet Strategy** (Recommended):
1. **Trading Wallet**: Hot wallet with 1-5 SOL
2. **Holding Wallet**: Cold wallet for profits
3. **Fee Wallet**: Separate for transaction fees

## Monitoring & Alerts

### Real-Time Dashboard

```bash
# Setup tmux with multiple panes

# Pane 1: Bot logs
tail -f logs/quantbot.log

# Pane 2: Live trades
watch -n 2 'psql -U quantbot -d quantbot_production -c "SELECT id, type, amount, price, status, created_at FROM trades ORDER BY created_at DESC LIMIT 10;"'

# Pane 3: Open positions
watch -n 5 'psql -U quantbot -d quantbot_production -c "SELECT id, token_id, entry_price, current_amount, status FROM positions WHERE status = '\''open'\'';"'

# Pane 4: Wallet balance
watch -n 30 'solana balance YOUR_WALLET --url mainnet-beta'
```

### Telegram Notifications

Configure alerts for:
- Trade executions
- Stop-loss/take-profit triggers
- Errors and failures
- Daily P&L summary
- Wallet balance warnings

### Critical Alerts

**Immediate Notification Required**:
- Transaction failure rate >10%
- Daily loss limit approaching (>80%)
- Wallet balance <0.01 SOL
- Database errors
- RPC connection failures

## Cost Analysis

### Transaction Costs (Mainnet)

**Per Trade**:
- Base transaction fee: ~0.000005 SOL
- Priority fee (optional): 0.00001-0.0001 SOL
- DEX fees (Pump.fun): 1% of trade value

**Example with 0.01 SOL trade**:
- Trade amount: 0.01 SOL
- DEX fee (1%): 0.0001 SOL
- Transaction fee: 0.000005 SOL
- **Total cost**: ~0.0101 SOL

### Expected Costs (First Week)

**Conservative Estimate** (50 trades @ 0.01 SOL avg):
- Trading capital: 0.5 SOL
- Transaction fees: 0.00025 SOL (50 * 0.000005)
- DEX fees: 0.005 SOL (1% of 0.5)
- **Total capital needed**: ~0.51 SOL

**Recommended Starting Balance**: 1.0 SOL
- Leaves buffer for fees and losses
- Enough for ~100 dust trades

## Rollback Procedures

### Emergency Stop

```bash
# Stop bot immediately
pkill -f quantbot

# Disable trading
psql -U quantbot -d quantbot_production -c "UPDATE user_trading_configs SET is_live_trading_enabled = false;"

# Check open positions
psql -U quantbot -d quantbot_production -c "SELECT * FROM positions WHERE status = 'open';"
```

### Position Closure (Manual)

If you need to manually close positions:

```bash
# Get open positions
psql -U quantbot -d quantbot_production -c "SELECT id, token_id, current_amount FROM positions WHERE status = 'open';"

# Close via bot
/positions close <POSITION_ID>

# Or close via direct transaction
solana transfer <TOKEN_ADDRESS> <AMOUNT> <RECIPIENT> --url mainnet-beta
```

### Database Rollback

```bash
# Backup before deployment
pg_dump quantbot_production > backup_before_live_$(date +%Y%m%d).sql

# Restore if needed
psql -U quantbot -d quantbot_production < backup_before_live_YYYYMMDD.sql
```

## Performance Benchmarks

### Week 1 Targets (Dust Trading)

- **Trades Executed**: 50-100
- **Success Rate**: >95%
- **Average Slippage**: <3%
- **System Uptime**: >99%
- **Response Time**: <2s per command

### Acceptable Metrics

- **Failed Transactions**: <5%
- **Stop-Loss Accuracy**: ±2%
- **Position Tracking**: 100% accurate
- **Database Consistency**: 100%

## Troubleshooting

### Common Issues

**1. Transaction Failing**
```bash
# Check RPC health
curl https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Verify wallet balance
solana balance YOUR_WALLET --url mainnet-beta

# Check recent blockhash
solana block-time --url mainnet-beta
```

**2. High Slippage**
- Use more liquid tokens (>$100k daily volume)
- Reduce position size
- Increase slippage tolerance temporarily
- Check DEX liquidity before trade

**3. Position Not Updating**
```bash
# Check position monitor status
ps aux | grep position-monitor

# Manual position update
psql -U quantbot -d quantbot_production -c "SELECT * FROM positions WHERE id = <POSITION_ID>;"
```

## Gradual Scale-Up Plan

### Week 1: Dust Testing (0.001-0.01 SOL)
- Focus: System stability
- Trades: 50-100 small trades
- Risk: Minimal (~0.5 SOL total)

### Week 2: Small Trading (0.01-0.1 SOL)
- Focus: Strategy validation  
- Trades: 100-200 trades
- Risk: Low (~5 SOL total)

### Week 3-4: Normal Trading (0.1-1.0 SOL)
- Focus: Performance optimization
- Trades: 200+ trades
- Risk: Moderate (~20 SOL total)

### Month 2+: Full Operation (1.0-10.0 SOL)
- Focus: Profit maximization
- Trades: Unlimited
- Risk: Managed by daily limits

## Success Criteria

### Day 1 Success
- [ ] 5+ dust trades executed successfully
- [ ] All transactions confirmed on-chain
- [ ] Position tracking accurate
- [ ] No critical errors
- [ ] Monitoring functioning

### Week 1 Success
- [ ] 50+ trades executed
- [ ] >95% success rate
- [ ] Stop-loss/take-profit working
- [ ] Automation tested
- [ ] Comfortable with system

### Ready for Scale-Up
- [ ] 100+ successful trades
- [ ] Week of stable operation
- [ ] All safety features validated
- [ ] Monitoring and alerts working
- [ ] Confident in system reliability

## Quick Start Commands

```bash
# 1. Build everything
cd /home/memez/quantBot && pnpm --filter @quantbot/trading build

# 2. Setup database
createdb quantbot_production
psql -U quantbot -d quantbot_production -f scripts/migration/postgres/003_live_trading.sql

# 3. Fund wallet
solana transfer <YOUR_WALLET> 1.0 --url mainnet-beta

# 4. Start dry-run
export DRY_RUN_MODE=true
cd packages/bot && pnpm start

# 5. After dry-run success, go live with dust
export DRY_RUN_MODE=false
export LIVE_TRADING_ENABLED=true
# Restart bot

# 6. Execute first trade
/livetrade buy <TOKEN> 0.001
```

## Final Notes

**Philosophy**: Better to test with $0.05 of real capital than $500 of fake testnet tokens.

**Advantages of Mainnet Dust Testing**:
- ✅ Real market conditions
- ✅ Real liquidity
- ✅ Real slippage
- ✅ Real transaction costs
- ✅ Real DEX behavior
- ✅ Minimal capital at risk

**Start Small, Scale Smart**: The 0.001 SOL trades cost almost nothing but give you complete confidence in the system before scaling up.

---

**You're Ready**: System is production-ready. Start with dust, prove it works, scale gradually.

