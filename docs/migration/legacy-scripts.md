# Legacy Scripts Migration Mapping

This document maps old scripts to their new equivalents in the modular architecture.

## Simulation Scripts

| Old Script | New Equivalent | Status |
|-----------|---------------|--------|
| `analyze-solana-callers-optimized.ts` | `configs/simulations/solana-callers-optimized.json` + engine | In Progress |
| `run-top-strategies-simulation.ts` | `configs/simulations/top-strategies.json` | ✅ Migrated |
| `simulate-specific-strategies.ts` | `configs/simulations/specific-strategies.json` | Pending |
| `simulate-caller.js` | `configs/simulations/caller-simulation.json` | Pending |
| `scripts/simulation/*.js` | Legacy - archived | Archived |

## Optimization Scripts

| Old Script | New Equivalent | Status |
|-----------|---------------|--------|
| `optimize-strategies.ts` | `src/simulation/optimization/optimizer.ts` + CLI | Pending |
| `optimize-strategies-with-filters.ts` | Optimization module with filters | Pending |
| `optimize-strategies-with-indicators.ts` | Optimization module with indicators | Pending |
| `optimize-high-win-rate-strategies.ts` | Optimization module | Pending |
| `optimize-tenkan-kijun-*.ts` | Optimization module | Pending |
| `ml-strategy-optimizer.ts` | `src/simulation/optimization/ml-optimizer.ts` | Pending |

## Analysis Scripts

| Old Script | New Equivalent | Status |
|-----------|---------------|--------|
| `analyze-strategy-results.ts` | `src/analysis/result-analyzer.ts` + CLI | Pending |
| `analyze-reinvestment-performance.ts` | Analysis module | Pending |
| `analyze-all-strategies-reinvestment.ts` | Analysis module | Pending |
| `calculate-portfolio-pnl.ts` | `src/analysis/metrics/portfolio-metrics.ts` | Pending |
| `calculate-weighted-portfolio-performance.ts` | Analysis module | Pending |

## Reporting Scripts

| Old Script | New Equivalent | Status |
|-----------|---------------|--------|
| `generate-strategy-weekly-reports.ts` | `src/reporting/` module + CLI | Pending |
| `generate-weekly-portfolio-reports.ts` | Reporting module | Pending |
| `generate-email-report.ts` | Reporting module | Pending |

## Data Processing Scripts

| Old Script | New Equivalent | Status |
|-----------|---------------|--------|
| `extract-*.js/ts` | `src/data/processors/` | Pending |
| `fetch-*.ts/js` | `src/data/loaders/` | Pending |
| `process-csv-simulations.js` | Data processor module | Pending |
| `aggregate-simulation-results.js` | `src/analysis/aggregators/` | Pending |

## Migration Notes

### Key Changes

1. **Config-Driven**: Simulations now use JSON configs instead of hardcoded parameters
2. **Modular**: Logic extracted into reusable modules
3. **Type-Safe**: Full TypeScript with proper types
4. **Testable**: Modules can be unit tested independently

### How to Migrate a Script

1. Identify the script's purpose (simulation, optimization, analysis, etc.)
2. Extract configuration parameters
3. Create a JSON config file (for simulations) or module (for reusable logic)
4. Test equivalence with original script
5. Move original script to `scripts/legacy/`
6. Update documentation

