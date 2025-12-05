# @quantbot/trading

Live trading execution engine for QuantBot.

## Overview

The trading package provides a comprehensive live trading system that integrates with Solana blockchain via Helius RPC, supporting multiple DEX protocols (Pump.fun, Raydium, Orca, Meteora) with advanced risk management and position tracking.

## Features

### Core Components

- **Helius RPC Client**: Optimized connections to Amsterdam/mainnet endpoints with connection pooling and failover
- **Transaction Builder**: Supports Pump.fun and Jupiter-based swaps with compute budget and priority fee management
- **Transaction Sender**: Reliable transaction submission with relayer support and retry logic
- **Strategy Executor**: Converts simulation strategies into live trade orders with position sizing
- **Trade Executor**: Executes buy/sell orders with stop-loss and take-profit logic

### Risk Management

- **Risk Manager**: Position size limits, daily loss limits, and slippage protection
- **Dry Run Executor**: Simulation mode for testing strategies without actual execution
- **Trade Logger**: Comprehensive logging and Telegram notifications

### Position & Wallet Management

- **Position Manager**: Track open positions in PostgreSQL
- **Position Monitor**: Real-time position tracking with auto-execution of stop-loss/take-profit
- **Wallet Manager**: Secure AES-256-GCM encrypted private key storage
- **Wallet Service**: Balance checking and transaction signing

### Alert Integration

- **Alert Trade Connector**: Listens to CA drops, Ichimoku signals, and live trade alerts to trigger trades

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Trading System                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │   Strategy   │───>│    Trade     │──>│ Transaction  │  │
│  │   Executor   │    │   Executor   │   │    Sender    │  │
│  └──────────────┘    └──────────────┘   └──────────────┘  │
│         │                   │                     │         │
│         │                   │                     ▼         │
│         │                   │             ┌──────────────┐  │
│         │                   │             │   Helius     │  │
│         │                   │             │     RPC      │  │
│         │                   │             └──────────────┘  │
│         │                   │                     │         │
│         ▼                   ▼                     ▼         │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │     Risk     │    │   Position   │   │   Solana     │  │
│  │   Manager    │    │   Manager    │   │  Blockchain  │  │
│  └──────────────┘    └──────────────┘   └──────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
pnpm install
```

## Configuration

### Environment Variables

```env
# Helius RPC
HELIUS_API_KEY=your_api_key_here
HELIUS_REGION=amsterdam  # or mainnet

# Wallet Encryption
WALLET_ENCRYPTION_KEY=your_32_byte_hex_key

# Database (managed by @quantbot/storage)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=quantbot
```

### Database Setup

Run the PostgreSQL migration:

```bash
psql -U quantbot -d quantbot -f ../../scripts/migration/postgres/003_live_trading.sql
```

## Usage

### Basic Trading

```typescript
import {
  HeliusRpcClient,
  TransactionBuilder,
  TransactionSender,
  TradeExecutor,
} from '@quantbot/trading';

// Initialize components
const rpcClient = new HeliusRpcClient({
  apiKey: process.env.HELIUS_API_KEY!,
  region: 'amsterdam',
});

const txBuilder = new TransactionBuilder({ rpcClient });
const txSender = new TransactionSender({ rpcClient });

const tradeExecutor = new TradeExecutor({
  transactionBuilder: txBuilder,
  transactionSender: txSender,
});

// Execute a buy order
const buyOrder = {
  type: 'buy' as const,
  tokenAddress: 'token_mint_address',
  amount: 0.5, // SOL
  slippageTolerance: 0.01, // 1%
  priorityFee: 0.0001,
  stopLoss: 0.1, // 10%
  takeProfit: 0.3, // 30%
};

const result = await tradeExecutor.executeBuy(buyOrder, userWalletKeypair, userId);
console.log('Trade result:', result);
```

### Dry Run Mode

```typescript
import { DryRunExecutor } from '@quantbot/trading';

const dryRunExecutor = new DryRunExecutor({ tradeExecutor });

// Simulate without execution
const result = await dryRunExecutor.executeTrade(buyOrder, userId);
console.log('Dry run result:', result);
```

### Position Management

```typescript
import { PositionManager, PositionMonitor } from '@quantbot/trading';

const positionManager = new PositionManager();
const positionMonitor = new PositionMonitor({
  positionManager,
  tradeExecutor,
  checkInterval: 10000, // 10 seconds
});

// Start monitoring positions
await positionMonitor.start();

// Get open positions
const positions = await positionManager.getOpenPositions(userId);
```

## Testing

### Unit Tests

```bash
pnpm test
```

### Integration Tests

```bash
pnpm test:integration
```

### Coverage

```bash
pnpm test:coverage
```

## Security

- **Private Key Encryption**: All wallet private keys are encrypted using AES-256-GCM with random IVs
- **Environment Isolation**: Uses environment variables for sensitive configuration
- **Input Validation**: All trade orders are validated before execution
- **Risk Limits**: Configurable position size, total exposure, and daily loss limits

## Known Issues

### TypeScript Build

Currently, there are TypeScript compilation issues related to:
1. `@quantbot/storage` package resolution
2. Missing type declarations
3. Solana web3.js API compatibility

**Workaround**: The runtime code is functional. Build issues will be addressed in the next iteration.

## Roadmap

- [ ] Fix TypeScript build issues
- [ ] Complete integration tests
- [ ] Testnet deployment
- [ ] Mainnet deployment with additional safeguards
- [ ] Multi-signature wallet support
- [ ] Advanced order types (limit, conditional)
- [ ] Portfolio rebalancing automation

## License

ISC

