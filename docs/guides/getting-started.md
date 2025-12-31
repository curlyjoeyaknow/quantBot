# Getting Started with QuantBot

## Quick Navigation Guide

### For Strategy Builder Wizard (Web UI)

**Navigate to strategy-ui directory:**

```bash
cd /home/memez/quantBot/strategy-ui
```

**Install dependencies:**

```bash
pip install -r requirements.txt
```

**Start the server:**

```bash
./run.sh
```

**Open in browser:**

- Main page: http://localhost:8000
- Strategy Wizard: http://localhost:8000/strategies/wizard

### For CLI Commands (TypeScript)

**Navigate to repository root:**

```bash
cd /home/memez/quantBot
```

**Install dependencies:**

```bash
pnpm install
```

**Build packages:**

```bash
pnpm build:ordered
```

**Run commands:**

```bash
# Ingest Telegram data
pnpm quantbot ingestion telegram --file data/raw/messages.html

# Fetch OHLCV data
pnpm quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01

# Run simulation
pnpm quantbot simulation run --strategy MyStrategy --from 2024-01-01 --to 2024-02-01
```

### For Pure Simulator Engine (TypeScript)

**Navigate to repository root:**

```bash
cd /home/memez/quantBot
```

**Build simulation package:**

```bash
pnpm --filter @quantbot/simulation build
```

**Use in code:**

```typescript
import { simulateToken } from '@quantbot/simulation/src/engine';
```

## Directory Structure

```
/home/memez/quantBot/
├── strategy-ui/          # Web UI (cd here for wizard)
│   ├── app/
│   ├── run.sh
│   └── requirements.txt
├── packages/
│   ├── simulation/      # Pure simulator engine
│   ├── workflows/        # Workflow orchestration
│   └── cli/              # CLI commands
└── docs/                 # Documentation
```

## Common Tasks

### Create a Strategy via Wizard

1. `cd strategy-ui`
2. `./run.sh`
3. Open http://localhost:8000/strategies/wizard
4. Fill out the 5-step wizard
5. Save strategy

### Run Simulation via CLI

1. `cd /home/memez/quantBot` (repo root)
2. `pnpm quantbot simulation run --strategy MyStrategy --from 2024-01-01 --to 2024-02-01`

### Use Pure Simulator in Code

1. `cd /home/memez/quantBot` (repo root)
2. Import: `import { simulateToken } from '@quantbot/simulation/src/engine'`
3. Call: `simulateToken(token, candles, strategy)`

## Troubleshooting

**"Command not found" errors:**
- Make sure you're in the correct directory
- For CLI: must be in repo root (`/home/memez/quantBot`)
- For wizard: must be in `strategy-ui` directory

**Import errors:**
- Run `pnpm build:ordered` from repo root
- Or `pnpm --filter @quantbot/simulation build` for just the simulator

**Server won't start:**
- Check you're in `strategy-ui` directory
- Verify dependencies: `pip install -r requirements.txt`
- Check port 8000 is available

