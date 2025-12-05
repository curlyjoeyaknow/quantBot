# QuantBot - Advanced Trading Simulation & CA Monitoring Bot

A sophisticated Telegram bot that provides PNL simulation for trading strategies and real-time CA (Contract Address) monitoring using Helius WebSockets.

## 🚀 Features

### 📊 **PNL Simulation**

- Multi-chain support: Solana, Ethereum, BSC, Base
- **InfluxDB time-series database** for high-performance OHLCV storage
- Multi-API-key Birdeye integration with retry logic and caching
- Customizable take-profit strategies
- Configurable stop-loss (initial + trailing)
- Detailed simulation events and performance metrics
- Intelligent caching layer for 10-50x faster queries

### 🎛️ **Config-Driven Simulation Engine** (NEW)

- **JSON-based configuration** - Define simulations declaratively
- **Modular architecture** - Reusable components for strategies, data loading, analysis
- **CLI interface** - Run simulations from config files
- **Programmatic API** - Use simulation engine in your own code
- **Multiple data sources** - CSV files, ClickHouse, caller databases
- **Flexible outputs** - CSV, JSON, stdout, ClickHouse
- **Strategy presets** - Pre-defined strategies ready to use
- **Batch execution** - Run multiple scenarios in parallel

See [Simulation Engine Guide](docs/guides/simulation-engine.md) for details.

### 🎯 **Real-Time CA Monitoring**

- Automatic CA drop detection in chat messages
- Real-time price monitoring via Helius WebSockets
- Profit target alerts (2x, 5x, 10x, etc.)
- Stop-loss notifications
- **Ichimoku Cloud Analysis** with technical signals
- Hourly performance summaries
- Multi-chain CA tracking

### 💾 **Persistent Storage**

- SQLite database for simulation history
- **Caller tracking database** for individual caller alert history
- Custom strategy management
- CA tracking and performance data
- Alert history and price updates
- **InfluxDB time-series database** for OHLCV data

## 🔧 Setup

### Prerequisites

- Node.js 18+
- Docker (for InfluxDB)
- Telegram Bot Token
- Birdeye API Keys (3.18M total credits across all keys)
- Helius API Key (for CA monitoring)

### Installation

```bash
git clone <repository>
cd quantBot
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# InfluxDB Configuration
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=your-admin-token
INFLUX_ORG=quantbot
INFLUX_BUCKET=ohlcv_data
INFLUX_USERNAME=admin
INFLUX_PASSWORD=your-secure-password

# Birdeye API Keys (3.18M total credits - add as many keys as you have)
BIRDEYE_API_KEY_1=your_first_key
BIRDEYE_API_KEY_2=your_second_key
BIRDEYE_API_KEY_3=your_third_key
# Add more keys as needed...

# Helius API
HELIUS_API_KEY=your_helius_key
HELIUS_WS_URL=wss://atlas-mainnet.helius-rpc.com/?api-key=your_helius_key

# Database
DATABASE_PATH=./quantbot.db
SIMULATIONS_DB_PATH=./simulations.db
CALLER_DB_PATH=./caller_alerts.db
```

### Running the Bot

#### 1. Start InfluxDB
```bash
npm run influxdb:start
```

#### 2. Initialize InfluxDB
- Visit http://localhost:8086
- Create admin user and organization
- Copy the admin token to your `.env` file

#### 3. Migrate Existing Data (Optional)
```bash
npm run influxdb:migrate
npm run caller:migrate
```

#### 4. Test Integration
```bash
npm run influxdb:test
npm run caller:stats
```

#### 5. Start the Bot
```bash
npm start
```

## 📱 Commands

### `/backtest`

Start a new PNL simulation:

1. Paste token address (Solana or EVM)
2. Select chain (for EVM addresses)
3. Enter start datetime (ISO format)
4. Choose take-profit strategy
5. Configure stop-loss settings

### `/repeat`

Repeat a previous simulation with new strategy:

- Lists recent simulations
- Select by number or "last"
- Reuses token and timeframe

### `/strategy`

Manage custom trading strategies:

- `/strategy` - List all strategies
- `/strategy save <name> <description> <strategy> <stop_loss>` - Save strategy
- `/strategy use <name>` - Load strategy for next backtest
- `/strategy delete <name>` - Delete strategy

### `/cancel`

Cancel current simulation session

### `/extract`

Extract CA drops from HTML chat messages and save to database:

- Processes all HTML files in the `messages/` folder
- Extracts token addresses with timestamps
- Fetches metadata for each token
- Saves to database for analysis

### `/analysis`

Run comprehensive historical analysis on all CA drops:

- Calculates success rates and performance metrics
- Analyzes performance by time periods and chains
- Generates strategy recommendations
- Provides detailed performance insights

## 🎯 Caller Tracking & Analysis

### Caller Database Commands

```bash
# Migrate CA drops to caller database
npm run caller:migrate

# View caller statistics
npm run caller:stats

# Generate comprehensive caller analysis
npm run analyze:callers

# Compare specific callers
npm run analyze:callers -- --compare "Brook" "Brook Calls" "BrookCalls"
```

### Individual Caller Simulations

```bash
# Simulate strategy for a specific caller
npm run simulate:caller "Brook" 20

# Simulate multiple callers
npm run simulate:caller --multi "Brook,Brook Calls,BrookCalls" 15
```

### Caller Analysis Features

- **Individual Caller History**: Track all alerts from each caller over time
- **Performance Metrics**: Win rates, success rates, and profitability per caller
- **Token Diversity**: Analyze which tokens each caller focuses on
- **Activity Patterns**: Understand caller frequency and consistency
- **Comparative Analysis**: Compare performance across different callers
- **Strategy Testing**: Test trading strategies against individual caller histories

### `/ichimoku`

Start Ichimoku Cloud analysis for a token:

1. Paste token address (Solana or EVM)
2. Select chain (for EVM addresses)
3. Bot fetches 52 historical 5-minute candles from Birdeye
4. Calculates Ichimoku Cloud components
5. Starts real-time price monitoring with leading span alerts

### `/broadcast <message>`

Send message to default chat (admin only)

## 🎯 CA Monitoring

The bot automatically detects CA drops in chat messages containing:

- Token addresses (Solana or EVM format)
- Trading keywords: "ca", "contract", "address", "buy", "pump", "moon", "gem", "call"

### Real-Time Alerts

- **🎯 Profit Targets**: Notifications when tokens hit 2x, 5x, 10x, etc.
- **🛑 Stop Loss**: Alerts when stop-loss is triggered
- **📊 Ichimoku Cloud Signals**: Technical analysis alerts
- **📊 Hourly Summaries**: Performance reports every hour

### 📈 Ichimoku Cloud Analysis

The bot includes advanced Ichimoku Cloud technical analysis for CA monitoring:

#### **Ichimoku Components**

- **Tenkan-sen (Conversion Line)**: 9-period high/low average
- **Kijun-sen (Base Line)**: 26-period high/low average  
- **Senkou Span A**: (Tenkan + Kijun) / 2, plotted 26 periods ahead
- **Senkou Span B**: 52-period high/low average, plotted 26 periods ahead
- **Chikou Span**: Current close, plotted 26 periods behind

#### **Trading Signals**

- **🟢 Tenkan-Kijun Cross**: Momentum shift when Tenkan crosses Kijun
- **🔥 Cloud Cross**: Strong trend change when price crosses cloud
- **⚡ Cloud Exit**: Price exiting cloud indicates trend continuation
- **💡 Momentum Shift**: Cloud thickness changes indicate strength changes

#### **Signal Strength**

- **Strong**: Thick cloud (>5% of price) or large Tenkan-Kijun distance (>2%)
- **Medium**: Moderate cloud thickness (2-5%) or medium distance (1-2%)
- **Weak**: Thin cloud (<2%) or small distance (<1%)

#### **Alert Format**

```
🟢 Ichimoku Signal Detected!

🪙 Token Name (SYMBOL)
📊 Signal: Tenkan crossed above Kijun - Bullish momentum shift
💰 Price: $0.00012345
💪 Strength: ⚡ MEDIUM

📊 Ichimoku Analysis:
• Price: $0.00012345 (above cloud)
• Tenkan: $0.00012000
• Kijun: $0.00011800
• Cloud: $0.00011500 - $0.00012500
• Thickness: 8.3%
• Trend: 🟢 Bullish
```

## 📊 Historical Analysis

The bot includes comprehensive historical analysis capabilities for analyzing past CA drops:

### **Analysis Features**

- **Performance Metrics**: Success rates, average PNL, win/loss ratios
- **Time-based Analysis**: Performance by 24h, 7d, 30d, and older periods
- **Chain Analysis**: Success rates and performance by blockchain
- **Strategy Recommendations**: AI-generated suggestions based on historical data
- **Best/Worst Performers**: Identification of top and bottom performing tokens

### **Analysis Report Example**

```
📊 Historical CA Analysis Report

📈 Overall Performance:
• Total CAs Analyzed: 150
• Success Rate: 42.7%
• Average PNL: 1.23x
• Profitable: 64 (42.7%)
• Losses: 86 (57.3%)

⏰ Performance by Time Period:
• Last 24h: 12 CAs, 58.3% success
• Last 7d: 45 CAs, 44.4% success
• Last 30d: 78 CAs, 41.0% success
• Older: 15 CAs, 33.3% success

🔗 Performance by Chain:
◎ SOLANA: 89 CAs, 45.2% success
🟡 BSC: 35 CAs, 37.1% success
⟠ ETHEREUM: 26 CAs, 38.5% success

🏆 Best Performer:
• TokenName (SYMBOL)
• PNL: 8.45x
• Chain: SOLANA

💡 Strategy Recommendations:
🔴 SUCCESS RATE: Low success rate (42.7%). Consider more conservative entry strategies.
   💡 Implement stricter token filtering or wait for better market conditions.
```

### **Usage Workflow**

1. **Extract Data**: `/extract` - Process HTML chat messages
2. **Run Analysis**: `/analysis` - Generate comprehensive report
3. **Review Results**: Analyze performance patterns and recommendations
4. **Optimize Strategy**: Use insights to improve future CA selection

### **Data Sources**

- **Chat Messages**: HTML files from Telegram chat exports
- **Current Prices**: Real-time data from Birdeye API
- **Historical Data**: Stored in SQLite database
- **Performance Tracking**: Continuous monitoring of CA performance

### Supported Chains

- **◎ Solana** - Default for Solana addresses
- **⟠ Ethereum** - EVM chain (eth/ethereum)
- **🟡 Binance Smart Chain** - EVM chain (bsc/binance)
- **🔵 Base** - EVM chain (base)

## 📈 Strategy Format

### Take-Profit Strategy

```
Simple: 50@2x,30@5x,20@10x
JSON: [{"percent":0.5,"target":2},{"percent":0.3,"target":5}]
Default: yes
```

### Stop-Loss Configuration

```
Format: initial: -30%, trailing: 50%
Examples:
- initial: -20%, trailing: 30%
- initial: -50%, trailing: 100%
- initial: -30%, trailing: none
- default
```

## 🗄️ Database Schema

### Tables

- `strategies` - Custom trading strategies
- `simulation_runs` - Historical simulation results
- `simulation_events` - Detailed simulation events
- `ca_tracking` - Active CA monitoring entries
- `price_updates` - Real-time price data
- `alerts_sent` - Alert history

## 🔌 API Integration

### Birdeye API

- Token metadata fetching
- OHLCV candle data
- Multi-chain support

### Helius WebSockets

- Real-time price updates
- Automatic reconnection
- Efficient subscription management

## 📊 Performance Features

### Caching System

- CSV-based OHLCV caching
- 24-hour cache expiry
- Intelligent cache extension
- Reduced API calls

### Monitoring Efficiency

- WebSocket-based real-time updates
- Smart alert deduplication
- Batch processing for summaries
- Memory-efficient data structures

## 🛠️ Development

### Project Structure

```
src/
├── bot.ts              # Main bot logic
├── candles.ts          # OHLCV data fetching
├── simulate.ts         # PNL simulation engine (legacy API)
├── simulation/         # NEW: Modular simulation engine
│   ├── engine.ts       # SimulationEngine class
│   ├── config.ts       # Configuration schemas
│   ├── strategies/     # Strategy definitions and builders
│   ├── optimization/   # Strategy optimization framework
│   └── sinks.ts        # Output handlers
├── data/               # NEW: Data access layer
│   └── loaders/        # CSV, ClickHouse, caller loaders
├── analysis/           # NEW: Analysis and metrics
│   ├── metrics/        # PnL, risk, trade metrics
│   └── aggregators/    # Result aggregation
├── reporting/          # NEW: Report generation
│   └── formats/        # CSV, JSON, HTML reporters
├── database.ts         # Database operations
├── helius-monitor.ts  # Real-time monitoring
└── .env               # Environment variables
```

### Running Config-Driven Simulations

```bash
# Run a simulation from a config file
npm run simulate:config -- --config=configs/simulations/top-strategies.json

# Or use ts-node directly
ts-node scripts/simulation/run-engine.ts --config=configs/simulations/top-strategies.json
```

### Migration from Legacy Scripts

The codebase has been refactored to use a modular, config-driven architecture. Legacy scripts have been archived to `scripts/legacy/`. See [Migration Guide](docs/migration/legacy-scripts.md) for details.

### Key Dependencies

- `telegraf` - Telegram Bot API
- `axios` - HTTP requests
- `luxon` - Date/time handling
- `sqlite3` - Database
- `ws` - WebSocket client

## 🚨 Error Handling

- Graceful API failure handling
- Automatic WebSocket reconnection
- Database transaction safety
- User-friendly error messages
- Comprehensive logging

## 🗂️ Backups

Run the backup helper to create a compressed archive that keeps `.env`, `config`, and `configs` while skipping build output and compiled JavaScript artifacts such as `dist`, `.next`, `node_modules`, and `.tsbuildinfo` files:

```bash
./scripts/backup-project.sh
```

Archives are stored under `backups/quantbot-backup-<timestamp>.tar.gz` by default. Override the destination with `-o /path/to/dir` or provide a custom archive name with `-n my-backup.tar.gz`.

## 📝 License

ISC License - See LICENSE file for details
