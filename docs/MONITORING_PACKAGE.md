# @quantbot/monitoring Package - Complete Overview

## Purpose

The **@quantbot/monitoring** package provides **real-time, live monitoring** of cryptocurrency tokens on Solana. It handles:

1. **Live price streaming** via WebSocket/gRPC
2. **Real-time alerts** for entry/exit signals
3. **Telegram call ingestion** from trading channels
4. **Technical indicator monitoring** (Ichimoku, Tenkan/Kijun)
5. **Pump.fun lifecycle tracking** (token creation → graduation)

**Key Distinction:** This package is for **real-time/live** monitoring. For historical analytics and performance metrics, see `@quantbot/analytics`.

---

## Core Responsibilities

### 1. Real-Time Price Monitoring

**Components:**

- `HeliusMonitor` - WebSocket-based price monitoring via Helius API
- `CAMonitoringService` - Business logic for tracking Custom Assets (tokens)
- `PumpfunLifecycleTracker` - Tracks Pump.fun token lifecycle (creation → graduation)

**What it does:**

- Maintains persistent WebSocket connections to Helius/Yellowstone
- Subscribes to price updates for tracked tokens
- Aggregates price data into OHLCV candles in real-time
- Handles reconnection logic and connection failures

**Data Flow:**

```
Helius WebSocket / Yellowstone gRPC
    ↓
Price Updates (real-time)
    ↓
OHLCV Aggregation
    ↓
StorageEngine (ClickHouse)
```

### 2. Live Trade Alerts

**Component:** `LiveTradeAlertService`

**What it does:**

- Monitors tokens from `caller_alerts` database (tokens called by traders)
- Detects entry conditions using strategy logic (Ichimoku, entry config)
- Sends real-time Telegram alerts when entry/exit conditions are met
- Tracks position status (entry price, entry time, in-position flag)

**Entry Detection:**

- Waits for initial drop (default: 10% from alert price)
- Monitors for rebound (default: 5% from low)
- Requires minimum candles (52 for Ichimoku calculation)
- Sends entry alert when conditions are met

**Exit Detection:**

- Monitors profit targets
- Tracks stop-loss levels
- Sends exit alerts when targets are hit

### 3. Technical Indicator Alerts

**Component:** `TenkanKijunAlertService`

**What it does:**

- Monitors Tenkan/Kijun cross signals (Ichimoku indicator)
- Detects bullish crosses (Tenkan crosses above Kijun = BUY signal)
- Detects bearish crosses (Tenkan crosses below Kijun = SELL signal)
- Sends real-time alerts to Telegram

**Signal Detection:**

- Calculates Ichimoku indicators in real-time
- Tracks Tenkan and Kijun lines
- Detects crossovers
- Prevents duplicate alerts

### 4. Telegram Call Ingestion

**Components:**

- `BrookCallIngestion` - Ingests calls from Brook's Telegram channel
- `CurlyJoeCallIngestion` - Ingests calls from CurlyJoe's Telegram channel

**What it does:**

- Monitors Telegram channels for new token calls
- Parses messages to extract:
  - Token addresses (Solana mint addresses)
  - Token metadata (name, symbol)
  - Call price and marketcap
  - Caller information
- Stores calls in database
- Automatically starts monitoring new tokens

**Data Flow:**

```
Telegram Channel
    ↓
Message Received
    ↓
Parse Token Address & Metadata
    ↓
Store in Database (caller_alerts)
    ↓
Start Live Monitoring
```

### 5. Pump.fun Lifecycle Tracking

**Component:** `PumpfunLifecycleTracker`

**What it does:**

- Tracks Pump.fun tokens from creation to graduation
- Monitors bonding curve state changes
- Detects when tokens graduate to Raydium
- Records lifecycle events (creation, graduation, etc.)

**Lifecycle Stages:**

1. **Creation** - Token created on Pump.fun
2. **Bonding Curve** - Trading on bonding curve
3. **Graduation** - Token graduates to Raydium DEX

### 6. OHLCV Aggregation

**Component:** `OhlcvAggregator`

**What it does:**

- Aggregates real-time price ticks into OHLCV candles
- Supports multiple intervals (1m, 5m, 15m, 1h)
- Handles missing data and gaps
- Stores aggregated candles in ClickHouse

### 7. Stream Recording & Backfilling

**Components:**

- `heliusStreamRecorder` - Records WebSocket streams for replay
- `heliusBackfillService` - Backfills missing historical data

**What it does:**

- Records live streams for later analysis
- Backfills missing OHLCV data
- Handles data gaps and inconsistencies

---

## Architecture

### Monitoring Engine

**Component:** `MonitoringEngine`

**Purpose:** Central orchestration for all monitoring services

**Responsibilities:**

- Initialize and start/stop all services
- Manage service lifecycle
- Provide unified status interface
- Handle service dependencies

**Usage:**

```typescript
import { getMonitoringEngine } from '@quantbot/monitoring';

const engine = getMonitoringEngine({
  enableLiveTradeAlerts: true,
  enableTenkanKijunAlerts: true,
  enableHeliusMonitor: true,
  enableBrookIngestion: true,
  bot: telegramBot,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  brookChannelId: process.env.BROOK_CHANNEL_ID,
});

await engine.initialize();
await engine.start();
```

### Service Dependencies

```
MonitoringEngine
    ├── LiveTradeAlertService
    │   └── Uses: StorageEngine, Simulation (Ichimoku), Telegram Bot
    │
    ├── TenkanKijunAlertService
    │   └── Uses: StorageEngine, Simulation (Indicators), Telegram Bot
    │
    ├── HeliusMonitor
    │   └── Uses: CAMonitoringService, Telegram Bot
    │
    ├── BrookCallIngestion
    │   └── Uses: Telegram Bot, LiveTradeAlertService (optional)
    │
    └── CurlyJoeCallIngestion
        └── Uses: Telegram Bot
```

---

## Key Features

### 1. Real-Time WebSocket Streaming

- **Helius WebSocket** - Real-time price updates
- **Yellowstone gRPC** - Deterministic transaction streams (optional)
- **Auto-reconnection** - Handles connection failures gracefully
- **Dynamic subscription** - Subscribe/unsubscribe to tokens on-the-fly

### 2. Intelligent Alert System

- **Entry Alerts** - Detects optimal entry points using strategy logic
- **Exit Alerts** - Monitors profit targets and stop-loss
- **Technical Signals** - Tenkan/Kijun cross alerts
- **Duplicate Prevention** - Prevents sending duplicate alerts

### 3. Multi-Chain Support

- **Solana** - Primary chain (via Helius/Yellowstone)
- **Ethereum/BSC** - RPC polling fallback (1-minute intervals)

### 4. Caching & Performance

- **Price Cache** - 30-second TTL for price data
- **Candle Cache** - In-memory candle storage
- **API Rate Limiting** - Respects API quotas
- **Efficient WebSocket Usage** - Minimizes API calls

### 5. Data Persistence

- **ClickHouse** - OHLCV candles, price updates
- **PostgreSQL** - Caller alerts, monitored tokens
- **SQLite** - Legacy support (being phased out)

---

## Data Structures

### CAMonitor

Represents an actively tracked token:

```typescript
interface CAMonitor {
  id: number;
  mint: string;              // Token mint address
  chain: string;              // 'solana', 'ethereum', etc.
  tokenName: string;
  tokenSymbol: string;
  callPrice: number;          // Price when called
  callMarketcap: number;
  callTimestamp: number;
  strategy: Strategy[];       // Profit targets
  stopLossConfig: StopLossConfig;
  chatId: number;             // Telegram chat for alerts
  userId: number;
  lastPrice?: number;
  alertsSent: Set<string>;     // Prevent duplicates
  candles: Candle[];          // Recent candles for analysis
  lastIchimoku?: IchimokuData;
  ichimokuSignalsSent: Set<string>;
}
```

### TokenMonitor

Represents a token being monitored for entry signals:

```typescript
interface TokenMonitor {
  alertId: number;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  callerName: string;
  alertTime: Date;
  alertPrice: number;
  candles: Candle[];
  indicatorHistory: IndicatorData[];
  lastPrice?: number;
  entrySignalSent: boolean;
  inPosition: boolean;
  entryPrice?: number;
  entryTime?: number;
}
```

---

## Configuration

### Environment Variables

```bash
# Helius
HELIUS_API_KEY=your_key
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=...

# Yellowstone gRPC (optional)
YELLOWSTONE_GRPC_URL=grpc://...
YELLOWSTONE_X_TOKEN=your_token

# Telegram
TELEGRAM_BOT_TOKEN=your_token
BROOK_CHANNEL_ID=channel_id
CURLYJOE_CHANNEL_ID=channel_id
LIVE_TRADE_ALERT_GROUP_IDS=group1,group2

# Shyft (fallback)
SHYFT_API_KEY=your_key
SHYFT_X_TOKEN=your_token
SHYFT_WS_URL=wss://api.shyft.to/v1/stream
```

### Entry Configuration

```typescript
const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  initialEntry: -0.1,      // Wait for 10% drop from alert price
  trailingEntry: 0.05,     // 5% rebound from low
  maxWaitTime: 60,         // 60 minutes max wait
};
```

---

## Usage Examples

### Basic Setup

```typescript
import { getMonitoringEngine } from '@quantbot/monitoring';

const engine = getMonitoringEngine({
  enableLiveTradeAlerts: true,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
});

await engine.initialize();
await engine.start();
```

### Advanced Configuration

```typescript
const engine = getMonitoringEngine({
  enableLiveTradeAlerts: true,
  enableTenkanKijunAlerts: true,
  enableHeliusMonitor: true,
  enableBrookIngestion: true,
  enableCurlyJoeIngestion: true,
  bot: telegramBot,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  brookChannelId: process.env.BROOK_CHANNEL_ID,
  curlyjoeChannelId: process.env.CURLYJOE_CHANNEL_ID,
  personalChatId: process.env.PERSONAL_CHAT_ID,
});

await engine.initialize();
await engine.start();

// Check status
const status = engine.getStatus();
console.log(status);
```

### Manual Service Usage

```typescript
import { LiveTradeAlertService } from '@quantbot/monitoring';

const service = new LiveTradeAlertService();
await service.initialize();
await service.start();
```

---

## Related Packages

| Package | Purpose | Relationship |
|---------|---------|-------------|
| `@quantbot/analytics` | Historical analytics | Uses data collected by monitoring |
| `@quantbot/observability` | System health | Monitors monitoring package health |
| `@quantbot/ingestion` | Batch ingestion | Complementary (batch vs real-time) |
| `@quantbot/storage` | Data persistence | Stores monitoring data |
| `@quantbot/simulation` | Strategy logic | Used for entry/exit detection |
| `@quantbot/api-clients` | External APIs | Provides Helius/Birdeye clients |

---

## Key Differences from Other Packages

### vs @quantbot/analytics

| Monitoring | Analytics |
|------------|----------|
| Real-time/live | Historical |
| WebSocket streaming | Database queries |
| Active monitoring | Post-analysis |
| Alerts & notifications | Metrics & reports |

### vs @quantbot/ingestion

| Monitoring | Ingestion |
|------------|-----------|
| Real-time streaming | Batch processing |
| Continuous | Scheduled |
| WebSocket/gRPC | REST API |
| Live alerts | Data collection |

### vs @quantbot/observability

| Monitoring | Observability |
|------------|---------------|
| Token monitoring | System monitoring |
| Trading alerts | Health checks |
| Price tracking | Metrics collection |
| User-facing | Internal |

---

## Testing

The package includes comprehensive tests:

- **Unit tests** - Individual service testing
- **Integration tests** - Service interaction testing
- **Property tests** - Invariant testing with fast-check

Run tests:

```bash
cd packages/monitoring
npm test
```

---

## Summary

The **@quantbot/monitoring** package is the **real-time monitoring layer** of QuantBot. It:

1. ✅ Streams live price data via WebSocket/gRPC
2. ✅ Detects entry/exit signals using strategy logic
3. ✅ Sends real-time alerts to Telegram
4. ✅ Ingests calls from Telegram channels
5. ✅ Tracks technical indicators (Ichimoku, Tenkan/Kijun)
6. ✅ Monitors Pump.fun token lifecycle
7. ✅ Aggregates real-time data into OHLCV candles

**Use it when you need:**

- Real-time token monitoring
- Live trading alerts
- Telegram call ingestion
- Technical indicator signals

**Don't use it for:**

- Historical analytics (use `@quantbot/analytics`)
- Batch data ingestion (use `@quantbot/ingestion`)
- System health monitoring (use `@quantbot/observability`)

---

**Last Updated:** 2025-12-14
