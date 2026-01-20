# Starting Live Monitoring and SignalOutbox

## Build Status

**Core packages build successfully:**
- ✅ `@quantbot/core`
- ✅ `@quantbot/infra`
- ✅ `@quantbot/utils`
- ✅ `@quantbot/storage`
- ✅ `@quantbot/ohlcv`
- ✅ `@quantbot/jobs`

**Packages with build errors:**
- ❌ `@quantbot/workflows` - Missing exports (`SimulationOutput`, `CausalCandleAccessor`)
- ❌ `@quantbot/simulation` - TypeScript build conflicts (dist files overwriting input)

These errors need to be fixed before the full monorepo builds, but the **SignalOutbox feature is in a separate worktree** and can be run independently.

---

## Starting SignalOutbox (Shadow Runner)

The SignalOutbox feature lives in the `quantBot-signaloutbox` worktree. This is the **live monitoring application** that processes Telegram events and emits signals.

### Prerequisites

1. **ClickHouse running:**
   ```bash
   docker-compose up -d clickhouse
   # Or ensure ClickHouse is accessible at CLICKHOUSE_URL
   ```

2. **Telegram API credentials:**
   - Get `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from https://my.telegram.org/apps
   - Generate a session string (or let the app prompt you)

### Configuration

Set environment variables:

```bash
# Shadow Runner Config
export SHADOW_RUNNER_RUN_ID=shadow-main-001
export SHADOW_ENGINE_VERSION=1.0.0
export SHADOW_HORIZON_S=3600

# Signal Engine Config
export SHADOW_MIN_CALLER_SCORE=0.3
export SHADOW_AVOID_THRESHOLD=0.2
export SHADOW_ENTER_WINDOW_THRESHOLD=0.7

# Recommendation Config
export SHADOW_DEFAULT_ENTRY_WINDOW_S=3600
export SHADOW_MAX_DRAWDOWN_BPS=-2000
export SHADOW_DEFAULT_MAX_CAPITAL_PCT=0.005

# Queue Config
export SHADOW_QUEUE_MAX_SIZE=10000

# Telegram Config
export TELEGRAM_API_ID=12345678
export TELEGRAM_API_HASH=your_api_hash
export TELEGRAM_SESSION=your_session_string  # Optional
export TELEGRAM_CHATS=-1001976645587  # Chat/Group ID (numeric ID for groups)
# Example: export TELEGRAM_CHATS=-1001976645587
# Or use username: export TELEGRAM_CHATS=@groupname
# Supports channels, groups, and private chats
# Note: TELEGRAM_CHANNELS is also supported for backward compatibility

# ClickHouse Config
export CLICKHOUSE_URL=http://localhost:8123
export CLICKHOUSE_DATABASE=quantbot
```

### Starting Shadow Runner

```bash
# Navigate to the signaloutbox worktree
cd /home/memez/backups/quantBot-signaloutbox

# Install dependencies (if not already done)
pnpm install

# Build the shadow-runner app
cd apps/shadow-runner
pnpm build

# Start the shadow runner
pnpm start

# Or with inline env vars:
TELEGRAM_API_ID=... TELEGRAM_API_HASH=... TELEGRAM_CHANNELS=@channel1 pnpm start
```

### What Shadow Runner Does

1. **Connects to Telegram** via MTProto (read-only, no messages sent)
2. **Listens to specific chats/groups** (not all channels - you specify which chat/group to monitor)
3. **Ingests all messages** from the configured chat/group as they arrive
4. **Normalizes events** into `CanonicalEvent` format
5. **Generates signals** using caller rankings and signal engine
6. **Writes signals** to ClickHouse SignalOutbox table
7. **Maintains checkpoints** for resume after restart
8. **Handles backpressure** with bounded queue (drops regular events, never drops edits/deletes)

### Monitoring Status

The shadow runner logs status every minute:
- `running`: Whether the loop is active
- `queueDepth`: Current event queue depth
- `metrics`: Event counts, signals emitted, deduplication stats

### Graceful Shutdown

Send `SIGINT` (Ctrl+C) or `SIGTERM` to trigger graceful shutdown:
- Drains pending events
- Flushes signal batch to ClickHouse
- Writes final checkpoint
- Closes connections cleanly

---

## Live Monitoring Architecture

The live monitoring system consists of:

1. **Shadow Runner** (`apps/shadow-runner`) - Processes Telegram events, emits signals
2. **SignalOutbox** (`packages/infra/src/storage/adapters/signal-outbox-clickhouse-adapter.ts`) - Persists signals to ClickHouse
3. **Checkpoint System** - Enables resume after restart
4. **Caller Ranking** - Provides caller quality scores for signal filtering

### Signal Flow

```
Telegram Channels → TelegramLiveSource → ShadowLoop → SignalOutbox → ClickHouse
```

### Signal Types

- `watch` - Token added to watchlist
- `enter_window` - Entry window signal
- `update` - Update signal
- `exit` - Exit signal
- `avoid` - Avoid signal (low caller score)

---

## Troubleshooting

### Build Errors

If you encounter build errors in the main repo, the shadow-runner can still run independently from its worktree since it has its own dependencies.

### ClickHouse Connection

Ensure ClickHouse is running and accessible:
```bash
docker-compose up -d clickhouse
# Verify connection
curl http://localhost:8123
```

### Telegram Connection

If Telegram connection fails:
- Verify `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are correct
- Check session string is valid (or let app generate it)
- Verify chat ID is correct (use numeric ID like `-1001234567890` for groups)
- Ensure your account has access to the chat/group
- Review rate limiting (may need to wait between attempts)

### Finding Chat/Group ID

To find the chat ID of a group you want to monitor:

1. **Using a bot**: Add `@userinfobot` to the group and it will show the chat ID
2. **Using Telegram Desktop**: 
   - Right-click the group → "Copy Link"
   - The URL will contain the chat ID (e.g., `https://t.me/c/1234567890/1` → chat ID is `-1001234567890`)
3. **Group IDs** are typically negative numbers like `-1001234567890`
4. **Channel usernames** can be used directly like `@channelname`

### Queue Full

If you see "Queue full" warnings:
- Increase `SHADOW_QUEUE_MAX_SIZE`
- Check if signal generation is slower than ingestion
- Verify ClickHouse write performance

---

## Next Steps

1. **Fix remaining build errors** in `@quantbot/workflows` and `@quantbot/simulation`
2. **Merge signaloutbox worktree** into main branch when ready
3. **Set up monitoring** for shadow runner (metrics, alerts)
4. **Configure channels** for your use case

