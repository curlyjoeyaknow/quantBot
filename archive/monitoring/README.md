# @quantbot/monitoring

Live token monitoring, real-time alerts, and call ingestion for QuantBot.

## Overview

This package handles **real-time** monitoring of tokens:
- Live price streams (WebSocket)
- Real-time entry/exit alerts
- Call ingestion from Telegram channels
- Signal detection (Tenkan/Kijun, Ichimoku)

**Note:** For historical analytics and performance metrics, see `@quantbot/analytics`.

## Core Components

### Monitoring Engine

Orchestrates all monitoring services:

```typescript
import { getMonitoringEngine } from '@quantbot/monitoring';

const engine = getMonitoringEngine({
  enableLiveTradeAlerts: true,
  enableTenkanKijunAlerts: true,
  enableBrookIngestion: true,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  brookChannelId: process.env.BROOK_CHANNEL_ID,
  bot: botInstance,
});

await engine.initialize();
await engine.start();

// Check status
const status = engine.getStatus();
console.log(status);
```

### Services

- **LiveTradeAlertService** - Real-time entry/exit alerts
- **TenkanKijunAlertService** - Tenkan/Kijun cross signals
- **HeliusMonitor** - WebSocket price monitoring
- **BrookCallIngestion** - Ingest calls from Brook's channel
- **CurlyJoeCallIngestion** - Ingest calls from CurlyJoe's channel

## Usage

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
```

## Package Structure

```
packages/monitoring/
├── engine/
│   └── MonitoringEngine.ts    ← Core orchestration
├── live-trade-alert-service.ts
├── tenkan-kijun-alert-service.ts
├── helius-monitor.ts
├── brook-call-ingestion.ts
├── curlyjoe-call-ingestion.ts
└── ...
```

## Related Packages

- **@quantbot/analytics** - Historical analytics and performance metrics
- **@quantbot/observability** - System health monitoring
- **@quantbot/ingestion** - Batch data ingestion

