# QuantBot Command Handlers - Obsidian Notes

This directory contains Obsidian notes documenting all QuantBot command handlers and main workflows.

> **Last Updated**: 2025-01-24  
> **Pattern**: All commands follow handler → service → repository pattern

## Structure

- **Handlers/** - Individual notes for each command handler organized by package
- **Main Commands/** - High-level workflow documentation for main commands
- **[[Command Patterns]]** - Comprehensive pattern documentation

## Quick Links

- [[INDEX]] - Complete command index
- [[Command Patterns]] - Handler, service, and repository patterns
- [[OHLCV Fetch]] - Direct OHLCV data fetching
- [[OHLCV Coverage Analysis]] - Coverage analysis workflows
- [[Optimization Workflow]] - Policy optimization workflows
- [[Backtesting Workflows]] - Backtesting execution workflows

## Command Categories

### Core Operations
- **Data**: Raw data and canonical events (`data raw`, `data canonical`)
- **Features**: Feature store operations (`features list`, `features compute`)
- **Artifacts**: Versioned artifact management (`artifacts list`, `artifacts get`, `artifacts tag`)

### Data Ingestion
- **Ingestion**: Telegram, OHLCV, market data ingestion
- **OHLCV**: OHLCV fetching, coverage analysis, deduplication
- **Storage**: Storage operations, statistics, validation

### Analysis & Simulation
- **Research**: Research OS experiment management
- **Simulation**: Simulation execution and management
- **Backtest**: Backtest workflows and optimization
- **Analytics**: Analytics and metrics

### Infrastructure
- **Server**: API server (`serve`)
- **Lab UI**: Lab UI server (`lab-ui`)
- **Lake**: Parquet Lake v1 exports (`lake export-run-slices`)
- **Observability**: Health, quotas, errors

## Pattern Summary

All commands follow these patterns:
1. **Handler**: Pure function in `packages/cli/src/handlers/{package}/{command}.ts`
2. **Service**: Accessed via `ctx.services.serviceName()` from `CommandContext`
3. **Registration**: Uses `defineCommand()` wrapper with Zod validation
4. **No Side Effects**: No console.log, no process.exit, no try/catch in handlers
5. **Python Integration**: Service wraps PythonEngine with Zod validation

See [[Command Patterns]] for detailed pattern documentation.

