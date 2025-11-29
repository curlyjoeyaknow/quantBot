# QuantBot Telegram Service

Lightweight Telegram bot service for QuantBot - handles alerts and commands.

## Overview

This is the extracted Telegram bot service that communicates with the core QuantBot service via shared database access. It provides:

- Telegram bot commands and interactions
- CA (Contract Address) drop detection
- Alert notifications
- Basic strategy management
- Session management for user workflows

## Architecture

- **Database**: Shared database access (SQLite for local dev, PostgreSQL for AWS RDS)
- **Communication**: Direct database access (no HTTP API calls needed for basic operations)
- **Dependencies**: Minimal - only bot-specific code, no simulation engine

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Telegram Bot Token
- Database access (SQLite file or PostgreSQL connection string)

### Installation

```bash
cd quantbot-bot
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```env
BOT_TOKEN=your_telegram_bot_token_here
DATABASE_URL=sqlite://./simulations.db  # or postgresql://user:pass@host:5432/db
CALLER_DB_PATH=./caller_alerts.db
LOG_LEVEL=info
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
npm start
```

## Project Structure

```
quantbot-bot/
├── src/
│   ├── index.ts              # Entry point
│   ├── commands/              # Command handlers
│   ├── services/              # Bot services
│   ├── database/              # Database client
│   ├── container/             # Dependency injection
│   ├── types/                 # TypeScript types
│   ├── utils/                 # Utilities
│   └── simulation/            # Type stubs (no engine)
├── package.json
├── tsconfig.json
└── README.md
```

## Database Schema

The bot service uses the following tables (shared with core service):

- `strategies` - User-defined trading strategies
- `simulation_runs` - Historical simulation results
- `ca_tracking` - Active CA monitoring
- `ca_calls` - Historical CA calls

## Commands

- `/backtest` - Run a backtest simulation
- `/strategy` - Manage trading strategies
- `/repeat` - Repeat a previous simulation
- `/alerts` - View active alerts
- `/history` - View call history
- And more...

## Notes

- Simulation execution is stubbed - will call core service API in future
- Candle fetching is stubbed - will call core service API in future
- Database client supports both SQLite and PostgreSQL
- All heavy computation is delegated to core service

## Deployment

See main project README for AWS deployment instructions.

