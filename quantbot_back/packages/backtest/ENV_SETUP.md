# Environment Variables Setup

The backtest package requires ClickHouse configuration from environment variables. These are automatically loaded from the root `.env` file when running via the CLI.

## Required Environment Variables

The following ClickHouse variables are required (from root `.env`):

```bash
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot
```

## How It Works

1. The CLI entry point loads environment variables from the root `.env` file
2. The backtest package uses `OhlcvRepository` from `@quantbot/storage`
3. `@quantbot/storage` reads ClickHouse config from `process.env` directly
4. No additional setup needed in the backtest package

## Setup

1. Copy `env.example` from the quantbot root to `.env` in the root directory
2. Fill in your ClickHouse credentials
3. Run backtest commands - they will automatically use the credentials

## Example

```bash
# From quantbot root
cp env.example .env
# Edit .env with your ClickHouse credentials

# Run backtest
quantbot backtest run --strategy my-strategy --interval 1m --from 2024-01-01T00:00:00Z --to 2024-01-31T23:59:59Z
```

