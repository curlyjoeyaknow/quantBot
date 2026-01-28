# PRD: Phase 4 - CLI & Results Management

## Overview

Phase 4 implements the command-line interface (CLI) for the backtesting platform and provides comprehensive results management capabilities. This phase enables users to run backtests, query results, and manage plugins through a user-friendly CLI.

## Goals

1. **CLI Interface**: Provide command-line interface for all platform operations
2. **Results Querying**: Enable querying and analysis of backtest results
3. **Results Export**: Support exporting results to various formats
4. **Plugin Management**: CLI commands for plugin discovery and management
5. **User Experience**: Intuitive commands with helpful error messages

## Scope

### In Scope

- CLI command structure
- Backtest execution commands
- Results querying commands
- Results export commands
- Plugin management commands
- Configuration management
- Help and documentation

### Out of Scope

- Web UI (can be added as plugin)
- Interactive TUI (can be added later)
- API server (optional, Phase 5)

## User Stories

### US-4.1: Run a Backtest via CLI

**As a** user  
**I want to** run a backtest using CLI commands  
**So that** I can test strategies quickly

**Acceptance Criteria:**

- Can specify strategy plugin name
- Can specify date range
- Can specify alert filters
- Can specify configuration file
- Command executes backtest
- Results are displayed
- Run ID is returned

### US-4.2: Query Backtest Results

**As a** user  
**I want to** query backtest results  
**So that** I can analyze performance

**Acceptance Criteria:**

- Can list all runs
- Can get run details by ID
- Can filter runs by strategy, date, etc.
- Can view metrics
- Can view trades
- Results are formatted nicely

### US-4.3: Export Results

**As a** user  
**I want to** export results to files  
**So that** I can analyze in external tools

**Acceptance Criteria:**

- Can export to CSV
- Can export to JSON
- Can export to Parquet
- Can export specific metrics
- Can export trades
- Files are properly formatted

### US-4.4: Manage Plugins via CLI

**As a** user  
**I want to** manage plugins via CLI  
**So that** I can discover and use plugins

**Acceptance Criteria:**

- Can list available plugins
- Can validate plugins
- Can enable/disable plugins
- Can view plugin details
- Can see plugin configuration

## Functional Requirements

### FR-4.1: CLI Command Structure

**Description**: Define CLI command hierarchy

**Commands:**

```bash
backtest
  ├── run              # Run a backtest
  ├── results          # Query results
  │   ├── list         # List all runs
  │   ├── show         # Show run details
  │   ├── compare      # Compare runs
  │   └── export       # Export results
  └── reproduce        # Reproduce a run

plugins
  ├── list             # List plugins
  ├── show             # Show plugin details
  ├── validate         # Validate plugin
  └── config           # Show plugin config

config
  ├── show             # Show configuration
  └── validate         # Validate configuration
```

**Source**: Borrow from `@quantbot/cli/src/commands/` structure

### FR-4.2: Backtest Run Command

**Description**: CLI command to run backtests

**Usage:**

```bash
backtest run \
  --strategy <plugin-name> \
  --from <date> \
  --to <date> \
  [--caller <name>] \
  [--token <mint>] \
  [--config <path>] \
  [--output-dir <path>]
```

**Options:**

- `--strategy`: Strategy plugin name (required)
- `--from`: Start date (ISO format, required)
- `--to`: End date (ISO format, required)
- `--caller`: Filter alerts by caller name
- `--token`: Filter alerts by token mint
- `--config`: Path to strategy config JSON file
- `--output-dir`: Directory for result exports
- `--interval`: OHLCV candle interval (default: 5m)
- `--verbose`: Verbose output

**Source**: Borrow from `@quantbot/cli/src/commands/backtest.ts`

**Implementation:**

```typescript
export async function runBacktestCommand(args: RunBacktestArgs): Promise<void> {
  // Parse arguments
  // Load configuration
  // Load alerts (using AlertPort)
  // Execute backtest (using BacktestExecutor)
  // Display results
  // Export if requested
}
```

### FR-4.3: Results List Command

**Description**: List all backtest runs

**Usage:**

```bash
backtest results list [--strategy <name>] [--from <date>] [--to <date>] [--limit <n>]
```

**Output:**

```
Run ID                                Strategy      Date Range           Trades  Return
────────────────────────────────────  ────────────  ───────────────────  ──────  ──────
abc123...                             simple-ma     2024-01-01 to 01-31  150     12.5%
def456...                             rsi-strategy  2024-02-01 to 02-28  200     -5.2%
```

**Source**: Create new, query DuckDB results table

### FR-4.4: Results Show Command

**Description**: Show detailed results for a run

**Usage:**

```bash
backtest results show <run-id> [--format table|json]
```

**Output:**

```
Run ID: abc123...
Strategy: simple-ma
Date Range: 2024-01-01 to 2024-01-31
Execution Time: 45.2s

Metrics:
  Total Return: 12.5%
  Number of Trades: 150
  Win Rate: 58.3%
  Average Win: $125.50
  Average Loss: -$85.20
  Max Drawdown: -8.2%
  Sharpe Ratio: 1.45
  Sortino Ratio: 1.82
  Profit Factor: 1.47
```

**Source**: Create new, query DuckDB

### FR-4.5: Results Compare Command

**Description**: Compare two backtest runs

**Usage:**

```bash
backtest results compare <run-id-1> <run-id-2>
```

**Output:**

```
Comparison: abc123... vs def456...

Metric                Run 1      Run 2      Difference
────────────────────  ─────────  ─────────  ──────────
Total Return          12.5%      -5.2%      +17.7%
Number of Trades      150        200        -50
Win Rate              58.3%      45.0%      +13.3%
Sharpe Ratio          1.45       0.82       +0.63
Max Drawdown          -8.2%      -15.5%    +7.3%
```

**Source**: Create new

### FR-4.6: Results Export Command

**Description**: Export results to files

**Usage:**

```bash
backtest results export <run-id> \
  --format csv|json|parquet \
  --output <path> \
  [--include-trades] \
  [--include-metrics]
```

**Formats:**

- CSV: Tabular format for Excel/spreadsheets
- JSON: Structured format for programmatic access
- Parquet: Columnar format for data analysis

**Source**: Create new, use existing export utilities

### FR-4.7: Reproduce Command

**Description**: Reproduce a previous backtest run

**Usage:**

```bash
backtest reproduce <run-id> [--validate]
```

**Requirements:**

- Load run metadata
- Extract original parameters
- Re-execute backtest
- Compare results (if --validate)
- Report differences

**Source**: Create new

### FR-4.8: Plugin List Command

**Description**: List available plugins

**Usage:**

```bash
plugins list [--type strategy|feature]
```

**Output:**

```
Plugins:
  simple-ma (strategy)      v1.0.0    Simple moving average strategy
  rsi-strategy (strategy)    v1.2.0    RSI-based strategy
  custom-metrics (feature)  v0.5.0    Custom metrics plugin
```

**Source**: Use PluginRegistry from Phase 3

### FR-4.9: Plugin Show Command

**Description**: Show plugin details

**Usage:**

```bash
plugins show <plugin-name>
```

**Output:**

```
Plugin: simple-ma
Type: strategy
Version: 1.0.0
Description: Simple moving average crossover strategy

Configuration Schema:
  {
    "fastPeriod": { "type": "number", "default": 10 },
    "slowPeriod": { "type": "number", "default": 30 },
    "stopLoss": { "type": "number", "default": -5 }
  }
```

**Source**: Use PluginRegistry

### FR-4.10: Plugin Validate Command

**Description**: Validate a plugin

**Usage:**

```bash
plugins validate <plugin-path>
```

**Output:**

```
Validating plugin: ./plugins/strategies/my-strategy
✓ Manifest valid
✓ Interface compliant
✓ Configuration schema valid
✓ Dependencies satisfied
Plugin is valid
```

**Source**: Use PluginValidator from Phase 3

### FR-4.11: Configuration Management

**Description**: Manage platform and plugin configurations

**Configuration Sources (priority order):**

1. CLI flags
2. Config file (--config)
3. Environment variables
4. Default values

**Config File Format:**

```json
{
  "duckdb": {
    "path": "/path/to/database.duckdb"
  },
  "clickhouse": {
    "host": "localhost",
    "port": 8123,
    "database": "quantbot"
  },
  "plugins": {
    "directory": "./plugins"
  },
  "strategies": {
    "simple-ma": {
      "fastPeriod": 10,
      "slowPeriod": 30
    }
  }
}
```

**Source**: Borrow from `@quantbot/cli/src/` config handling

## Technical Specifications

### CLI Framework

- **commander.js** or **yargs**: Command parsing
- **chalk**: Colored output
- **table**: Table formatting
- **inquirer**: Interactive prompts (optional)

### Dependencies

**CLI Package:**

- `@backtesting-platform/core` - Core types
- `@backtesting-platform/backtest` - Backtest engine
- `@backtesting-platform/plugins` - Plugin system
- `commander` - CLI framework
- `chalk` - Colors
- `table` - Table formatting

### Code to Borrow from QuantBot

#### CLI Structure

- `@quantbot/cli/src/commands/` - Command structure
- `@quantbot/cli/src/handlers/` - Command handlers
- `@quantbot/cli/bin/` - CLI entry point

#### Command Examples

- `@quantbot/cli/src/commands/backtest.ts` - Backtest command
- `@quantbot/cli/src/commands/ingestion.ts` - Ingestion command pattern

#### Output Formatting

- `@quantbot/cli/src/` - Output formatting utilities

## Implementation Tasks

### Task 4.1: Set Up CLI Framework

- Install CLI dependencies
- Set up command structure
- Create entry point
- Add help system

### Task 4.2: Implement Backtest Commands

- Implement `run` command
- Implement `reproduce` command
- Add argument parsing
- Add error handling

### Task 4.3: Implement Results Commands

- Implement `list` command
- Implement `show` command
- Implement `compare` command
- Implement `export` command
- Add output formatting

### Task 4.4: Implement Plugin Commands

- Implement `list` command
- Implement `show` command
- Implement `validate` command
- Add plugin discovery

### Task 4.5: Implement Configuration Management

- Add config file loading
- Add environment variable support
- Add config validation
- Add config merging

### Task 4.6: Add Output Formatting

- Add table formatting
- Add JSON output
- Add colored output
- Add progress indicators

### Task 4.7: Add Error Handling

- Add validation errors
- Add execution errors
- Add helpful error messages
- Add error recovery

## Success Criteria

1. ✅ Can run backtest via CLI
2. ✅ Can query results via CLI
3. ✅ Can export results to files
4. ✅ Can manage plugins via CLI
5. ✅ Commands are intuitive
6. ✅ Error messages are helpful
7. ✅ Output is well-formatted

## Dependencies

- Phase 1 complete (data access)
- Phase 2 complete (backtesting engine)
- Phase 3 complete (plugin system)

## Risks & Mitigations

**Risk**: Complex command-line interface  
**Mitigation**: Keep commands simple, provide good help text

**Risk**: Poor user experience  
**Mitigation**: Test with users, iterate on UX

**Risk**: Performance issues with large result sets  
**Mitigation**: Implement pagination, streaming exports

## Open Questions

1. Should we support interactive mode?
2. Should we support command aliases?
3. How should we handle long-running commands (progress bars)?
4. Should we support command completion?

## Next Phase

Phase 5 will add Python integration for advanced data science workflows and analysis.
