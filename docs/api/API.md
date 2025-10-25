# QuantBot API Documentation

## 🔌 External API Integrations

### Birdeye API

The bot integrates with Birdeye API for token data and OHLCV information.

#### Endpoints Used

- `GET /defi/token_overview` - Token metadata and price information
- `GET /defi/ohlcv` - Historical OHLCV candle data
- `GET /defi/tokenlist` - Token list information

#### Configuration

```typescript
interface BirdeyeConfig {
  apiKey: string;
  baseUrl: string;
  rateLimit: number;
  timeout: number;
}
```

#### Usage Example

```typescript
import { BirdeyeClient } from '../api/birdeye';

const client = new BirdeyeClient({
  apiKey: process.env.BIRDEYE_API_KEY,
  baseUrl: 'https://public-api.birdeye.so',
  rateLimit: 100, // requests per minute
  timeout: 10000
});

// Get token information
const tokenInfo = await client.getTokenInfo('So11111111111111111111111111111111111111112');

// Get OHLCV data
const candles = await client.getOHLCV('So11111111111111111111111111111111111111112', {
  chain: 'solana',
  timeframe: '5m',
  limit: 100
});
```

### Helius WebSocket API

Real-time price monitoring using Helius WebSocket connections.

#### Helius Configuration

```typescript
interface HeliusConfig {
  apiKey: string;
  wsUrl: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}
```

#### Helius Usage Example

```typescript
import { HeliusMonitor } from '../api/helius';

const monitor = new HeliusMonitor({
  apiKey: process.env.HELIUS_API_KEY,
  wsUrl: 'wss://atlas-mainnet.helius-rpc.com',
  reconnectInterval: 5000,
  maxReconnectAttempts: 10
});

// Subscribe to price updates
monitor.subscribeToPriceUpdates('So11111111111111111111111111111111111111112', (update) => {
  console.log('Price update:', update);
});

// Start monitoring
await monitor.connect();
```

## 🤖 Bot API

### Command Handlers

The bot provides several command handlers for different functionalities.

#### `/backtest` Command

Starts a new PNL simulation with user-specified parameters.

**Parameters:**

- Token address (required)
- Chain selection (for EVM addresses)
- Start datetime (ISO format)
- Take-profit strategy
- Stop-loss configuration

**Response:**

```typescript
interface BacktestResponse {
  sessionId: string;
  tokenInfo: TokenInfo;
  strategy: TradingStrategy;
  status: 'started' | 'error';
  message: string;
}
```

#### `/repeat` Command

Repeats a previous simulation with new strategy parameters.

**Parameters:**

- Simulation ID or "last"
- New strategy configuration

#### `/strategy` Command

Manages custom trading strategies.

**Subcommands:**

- `save <name> <description> <strategy> <stop_loss>` - Save new strategy
- `use <name>` - Load strategy for next backtest
- `delete <name>` - Delete strategy
- `list` - List all saved strategies

#### `/analysis` Command

Runs comprehensive historical analysis on CA drops.

**Response:**

```typescript
interface AnalysisResponse {
  totalCAs: number;
  successRate: number;
  averagePnL: number;
  performanceByTime: TimePeriodAnalysis[];
  performanceByChain: ChainAnalysis[];
  recommendations: string[];
}
```

### Message Handlers

#### CA Drop Detection

Automatically detects contract addresses in chat messages.

**Detection Criteria:**

- Token addresses (Solana or EVM format)
- Trading keywords: "ca", "contract", "address", "buy", "pump", "moon", "gem", "call"

**Response:**

```typescript
interface CADropAlert {
  tokenAddress: string;
  chain: string;
  alertPrice: number;
  timestamp: Date;
  chatId: string;
  messageId: string;
  detectedBy: string[];
}
```

## 📊 Simulation API

### Simulation Engine

Core simulation functionality for backtesting trading strategies.

#### Simulation Configuration

```typescript
interface SimulationConfig {
  initialBalance: number;
  positionSize: number;
  slippage: number;
  fees: number;
  tradingRules: TradingStrategy;
}
```

#### Trading Strategy

```typescript
interface TradingStrategy {
  name: string;
  description: string;
  takeProfit: TakeProfitTarget[];
  stopLoss: StopLossConfig;
  reentry?: ReentryConfig;
}

interface TakeProfitTarget {
  percentage: number; // 0-1, portion of position to close
  multiplier: number; // Price multiplier (e.g., 2.0 for 2x)
}

interface StopLossConfig {
  initial: number; // Initial stop loss percentage
  trailing?: number; // Trailing stop loss percentage
}

interface ReentryConfig {
  enabled: boolean;
  reentryPriceFactor: number;
  reentryStopLoss: number;
}
```

#### Simulation Result

```typescript
interface SimulationResult {
  id: string;
  tokenAddress: string;
  chain: string;
  startTime: Date;
  endTime: Date;
  initialBalance: number;
  finalBalance: number;
  totalPnL: number;
  totalPnLPercent: number;
  trades: Trade[];
  events: SimulationEvent[];
  strategy: TradingStrategy;
}
```

### Ichimoku Analysis

Technical analysis using Ichimoku Cloud indicators.

#### Components

- **Tenkan-sen (Conversion Line)**: 9-period high/low average
- **Kijun-sen (Base Line)**: 26-period high/low average
- **Senkou Span A**: (Tenkan + Kijun) / 2, plotted 26 periods ahead
- **Senkou Span B**: 52-period high/low average, plotted 26 periods ahead
- **Chikou Span**: Current close, plotted 26 periods behind

#### Signal Types

```typescript
interface IchimokuSignal {
  type: 'tenkan_kijun_cross' | 'cloud_cross' | 'cloud_exit' | 'momentum_shift';
  strength: 'strong' | 'medium' | 'weak';
  direction: 'bullish' | 'bearish';
  price: number;
  tenkan: number;
  kijun: number;
  cloudTop: number;
  cloudBottom: number;
  thickness: number;
  timestamp: Date;
}
```

## 🗄️ Database API

### Database Operations

SQLite database operations for persistent storage.

#### Tables

```sql
-- Strategies table
CREATE TABLE strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  strategy_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Simulation runs table
CREATE TABLE simulation_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  initial_balance REAL NOT NULL,
  final_balance REAL,
  total_pnl REAL,
  total_pnl_percent REAL,
  strategy_json TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- CA tracking table
CREATE TABLE ca_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  alert_price REAL NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Database Client

```typescript
import { DatabaseClient } from '../utils/database';

const db = new DatabaseClient('data/quantbot.db');

// Save strategy
await db.saveStrategy({
  name: 'Conservative 2x',
  description: 'Conservative strategy targeting 2x returns',
  strategy: {
    takeProfit: [{ percentage: 1.0, multiplier: 2.0 }],
    stopLoss: { initial: -0.15 }
  }
});

// Get simulation results
const results = await db.getSimulationResults({
  userId: '123456789',
  limit: 10
});

// Track CA drop
await db.trackCADrop({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
  alertPrice: 0.001,
  chatId: '-1002523160967',
  messageId: '123'
});
```

## 🔧 Utility Functions

### Validation

Input validation utilities for bot commands and API requests.

```typescript
import { validateTokenAddress, validateChain, validateStrategy } from '../utils/validation';

// Validate token address
const isValid = validateTokenAddress('So11111111111111111111111111111111111111112', 'solana');

// Validate chain
const chain = validateChain('ethereum'); // Returns 'ethereum' or throws error

// Validate strategy
const strategy = validateStrategy({
  takeProfit: [{ percentage: 0.5, multiplier: 2.0 }],
  stopLoss: { initial: -0.15 }
});
```

### Formatting

Data formatting utilities for consistent output.

```typescript
import { formatPrice, formatPercentage, formatTimestamp } from '../utils/formatting';

// Format price
const price = formatPrice(0.00123456); // Returns "$0.00123"

// Format percentage
const pnl = formatPercentage(0.15); // Returns "+15.00%"

// Format timestamp
const time = formatTimestamp(new Date()); // Returns "2025-01-25 15:30:45"
```

### Constants

Application constants and configuration values.

```typescript
import { CHAINS, SIMULATION_DEFAULTS, API_ENDPOINTS } from '../utils/constants';

// Chain configurations
const solanaConfig = CHAINS.solana;

// Simulation defaults
const defaultBalance = SIMULATION_DEFAULTS.INITIAL_BALANCE;

// API endpoints
const birdeyeUrl = API_ENDPOINTS.BIRDEYE_BASE_URL;
```

## 🚨 Error Handling

### Error Types

```typescript
interface BotError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
}

// Common error codes
const ERROR_CODES = {
  INVALID_TOKEN_ADDRESS: 'INVALID_TOKEN_ADDRESS',
  API_RATE_LIMIT: 'API_RATE_LIMIT',
  SIMULATION_ERROR: 'SIMULATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR'
};
```

### Error Handling Pattern

```typescript
try {
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  logger.error('Operation failed', { error, context });
  
  if (error.code === ERROR_CODES.API_RATE_LIMIT) {
    // Handle rate limiting
    await delay(60000); // Wait 1 minute
    return retryOperation();
  }
  
  throw new BotError({
    code: ERROR_CODES.SIMULATION_ERROR,
    message: 'Simulation failed',
    details: error
  });
}
```

## 📈 Performance Monitoring

### Metrics Collection

```typescript
interface PerformanceMetrics {
  apiResponseTime: number;
  simulationDuration: number;
  memoryUsage: number;
  activeConnections: number;
  cacheHitRate: number;
}

// Collect metrics
const metrics = await collectMetrics();

// Log performance data
logger.info('Performance metrics', metrics);
```

### Caching Strategy

```typescript
interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum cache size
  strategy: 'lru' | 'fifo'; // Eviction strategy
}

// Cache implementation
const cache = new Cache({
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  maxSize: 1000,
  strategy: 'lru'
});
```
