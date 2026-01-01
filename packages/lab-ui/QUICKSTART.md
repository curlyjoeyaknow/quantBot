# Lab UI Quick Start Guide

Get the Lab UI up and running in minutes.

## Prerequisites

- Node.js 18+ and pnpm installed
- DuckDB database file (shared with main pipeline)
- `quantbot` CLI available in PATH (or set `QUANTBOT_CLI`)

## Step 1: Install Dependencies

From the project root:

```bash
pnpm install
```

## Step 2: Configure Environment

Set the required environment variable:

```bash
# Set DuckDB path (should match your main pipeline)
export DUCKDB_PATH=./data/tele.duckdb

# Optional: Set custom port (default: 3111)
export PORT=3111

# Optional: Set custom CLI path (default: quantbot)
export QUANTBOT_CLI=quantbot
```

Or create a `.env` file in the project root:

```bash
DUCKDB_PATH=./data/tele.duckdb
PORT=3111
QUANTBOT_CLI=quantbot
```

## Step 3: Start the UI

```bash
# Development mode (with hot reload)
pnpm --filter @quantbot/lab-ui dev
```

The UI will start at `http://localhost:3111` (or your configured port).

## Step 4: Create Your First Strategy

1. Navigate to **Strategy Builder** (`/strategies`)
2. Click **"Seed example"** to populate a sample ExitPlan
3. Edit the JSON as needed (or use the example as-is)
4. Enter a strategy name (e.g., "My First Strategy")
5. Click **"Save strategy"**

The strategy is now saved and ready to use!

## Step 5: Run Your First Backtest

1. Navigate to **Runs** (`/runs`)
2. Fill in the form:
   - **Strategy**: Select your saved strategy
   - **Date Range**: Choose `from` and `to` dates
   - **Interval**: Select candle interval (e.g., `1m`, `5m`, `15m`)
   - **Fees**: Set taker fee (basis points, e.g., `30` = 0.3%)
   - **Slippage**: Set slippage (basis points, e.g., `10` = 0.1%)
   - **Position USD**: Set position size in USD
   - **Caller Filter** (optional): Filter by specific caller
3. Click **"Run backtest"**

The run will be queued, then start executing. The status will update automatically:
- `queued` → `running` → `done` (or `error`)

## Step 6: View Leaderboard

1. Navigate to **Leaderboard** (`/leaderboard`)
2. Enter the `run_id` from your completed run
3. Click **"Load"**

You'll see a table with caller performance metrics:
- **Caller**: Caller name
- **PnL%**: Aggregate profit/loss percentage
- **Strike Rate**: Win rate percentage
- **Median Drawdown**: Median drawdown percentage
- **Total Drawdown**: Maximum drawdown percentage

## Example ExitPlan

Here's a complete example ExitPlan you can use:

```json
{
  "ladder": {
    "levels": [
      { "percent": 0.5, "target": 2.0 },
      { "percent": 0.3, "target": 5.0 },
      { "percent": 0.2, "target": 10.0 }
    ]
  },
  "trailing": {
    "activation": { "kind": "percent", "value": 1.5 },
    "stop": { "kind": "percent", "value": 0.5 }
  },
  "indicators": []
}
```

This strategy:
- Takes 50% profit at 2x, 30% at 5x, 20% at 10x
- Activates trailing stop after 1.5x gain
- Trails stop at 0.5x below peak

## Common Issues

### "Database connection failed"

- Check that `DUCKDB_PATH` points to a valid file
- Ensure the file exists and is readable/writable
- Try creating the database file first: `touch ./data/tele.duckdb`

### "CLI command not found"

- Verify `quantbot` is in your PATH: `which quantbot`
- Or set `QUANTBOT_CLI` to the full path: `export QUANTBOT_CLI=/path/to/quantbot`
- Ensure the CLI is built: `pnpm build:ordered`

### "Strategy validation failed"

- Use the "Seed example" button to see a valid format
- Ensure JSON is valid (no trailing commas, proper quotes)
- Check that all required fields are present

### "Run status stuck on 'running'"

- Check the CLI process is actually running: `ps aux | grep quantbot`
- Review error logs in the UI (error message in run details)
- Check CLI output if running manually

## Next Steps

- **Customize Strategies**: Experiment with different ExitPlan configurations
- **Analyze Results**: Compare different strategies using the leaderboard
- **Filter by Caller**: Use caller filters to test specific callers
- **Adjust Parameters**: Try different fees, slippage, and position sizes

## Production Deployment

For production use:

```bash
# Build the package
pnpm --filter @quantbot/lab-ui build

# Start the server
pnpm --filter @quantbot/lab-ui start
```

Consider:
- Using a process manager (PM2, systemd)
- Setting up reverse proxy (nginx, Caddy)
- Configuring HTTPS
- Setting up monitoring and logging

## Need Help?

- Check the main [README.md](./README.md) for detailed documentation
- Review [packages/backtest/README.md](../backtest/README.md) for backtest engine details
- See [packages/cli/README.md](../cli/README.md) for CLI usage

