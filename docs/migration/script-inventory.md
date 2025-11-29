# Script Inventory & Categorization

This document catalogs all scripts in the `/scripts` directory, categorizes them by function, and maps their dependencies.

**Total Scripts:** 120+ TypeScript and JavaScript files

## Categories

### 1. Simulation Scripts (Core Trading Simulation)

#### Primary Simulation Scripts
- `analyze-solana-callers-optimized.ts` - **MAJOR**: Complex multi-strategy simulation for Solana callers (2496 lines)
  - Dependencies: ClickHouse, CSV parsing, indicators, ichimoku
  - Output: CSV, JSON, logs
  - Strategies: 100+ predefined strategies
  
- `run-top-strategies-simulation.ts` - Runs top 3 optimized strategies
  - Dependencies: CSV (all_brook_channels_calls.csv), fetchHybridCandles
  - Output: CSV per strategy
  
- `simulate-specific-strategies.ts` - Simulates predefined strategies on Brook Giga calls
  - Dependencies: CSV, ClickHouse, fetchHybridCandles
  - Output: CSV
  
- `simulate-caller.js` - Simulates trades for specific callers
  - Dependencies: caller-tracking service, ohlcv-query service
  - Output: JSON results

#### Legacy Simulation Scripts (in `scripts/simulation/`)
- `simulate_accurate_final.js` - Original accurate simulation
- `simulate_accurate_mock.js` - Mock simulation
- `simulate_accurate_trades.js` - Trade-level simulation
- `simulate_cleaned_profit_targets.js` - Profit target variations
- `simulate_complete_profit_targets.js` - Complete profit targets
- `simulate_expanded_dataset.js` - Expanded dataset simulation
- `simulate_final_profit_targets.js` - Final profit targets
- `simulate_individual_callers.js` - Individual caller simulation
- `simulate_profit_target_variations.js` - Profit target variations
- `simulate_real_data.js` - Real data simulation
- `simulate_real_ohlcv.js` - Real OHLCV simulation
- `simulate_realistic_1_month.js` - 1 month realistic simulation
- `simulate_realistic_callers.js` - Realistic caller simulation
- `simulate_realistic_profit_targets.js` - Realistic profit targets
- `simulate_risk_managed.js` - Risk managed simulation
- `simulate_simplified_strategy.js` - Simplified strategy
- `simulate_weekly_rebalanced_2_5_percent.js` - Weekly rebalanced 2.5%
- `simulate_weekly_rebalanced_profit_targets.js` - Weekly rebalanced profit targets
- `simulate_weekly_rebalanced_raw_figures.js` - Weekly rebalanced raw
- `simulate_with_real_api.js` - Real API simulation
- `simulate_your_rules.js` - Custom rules simulation
- `comprehensive_api_simulation.js` - Comprehensive API simulation
- `test_api_simulation.js` - API simulation test
- `test_timestamp.js` - Timestamp test

#### Test/Validation Simulation Scripts
- `test-advanced-strategies.ts` - Advanced strategy tests
- `test-conditional-reentry.ts` - Conditional re-entry tests
- `test-dip-strategies.ts` - Dip strategy tests
- `test-multi-tp-reentry.ts` - Multi TP re-entry tests
- `test-profit-targets.ts` - Profit target tests
- `test-reentry-targets.ts` - Re-entry target tests
- `test-tenkan-kijun-1h-candles-no-reinvestment.ts` - Tenkan-Kijun 1h tests
- `test-tenkan-kijun-brook-loss-clamp.ts` - Tenkan-Kijun loss clamp tests
- `test-tenkan-kijun-remaining-period-by-caller.ts` - Remaining period by caller
- `test-tenkan-kijun-remaining-period-only.ts` - Remaining period only
- `test-tenkan-kijun-with-loss-clamp.ts` - Tenkan-Kijun with loss clamp
- `test_token_simulations.js` - Token simulation tests
- `test_birdeye_api.js` - Birdeye API tests

### 2. Optimization Scripts (Strategy Parameter Optimization)

- `optimize-strategies.ts` - **MAJOR**: Strategy optimization framework with ML support
  - Dependencies: CSV, fetchHybridCandles, ClickHouse
  - Output: CSV comparison, optimization results
  
- `optimize-strategies-with-filters.ts` - Optimization with filters
- `optimize-strategies-with-indicators.ts` - Optimization with indicators
- `optimize-high-win-rate-strategies.ts` - High win rate optimization
- `optimize-tenkan-kijun-brook.ts` - Tenkan-Kijun Brook optimization
- `optimize-tenkan-kijun-with-filters.ts` - Tenkan-Kijun with filters
- `optimize-filtered-ichimoku-strategies.ts` - Filtered Ichimoku optimization
- `ml-strategy-optimizer.ts` - ML-based strategy optimizer

### 3. Analysis Scripts (Result Analysis & Metrics)

- `analyze-strategy-results.ts` - **MAJOR**: Analyzes optimization results
  - Dependencies: CSV results
  - Output: Analysis reports
  
- `analyze-all-strategies-reinvestment.ts` - All strategies reinvestment analysis
- `analyze-reinvestment-performance.ts` - Reinvestment performance analysis
- `analyze-tenkan-kijun-reinvestment.ts` - Tenkan-Kijun reinvestment analysis
- `recalculate-all-strategies-reinvestment.ts` - Recalculate reinvestment
- `analyze-reentry-max.ts` - Re-entry max analysis
- `analyze-dip-timing.js` - Dip timing analysis
- `analyze-stop-recovery.js` - Stop recovery analysis
- `analyze-time-period.js` - Time period analysis
- `analyze-callers.js` - Caller analysis
- `analyze-lsy-calls.js` - LSY calls analysis
- `analyze-lsy-performance.js` - LSY performance analysis
- `analyze-market-caps.ts` - Market cap analysis
- `compare-ichimoku-strategies.ts` - Ichimoku strategy comparison
- `verify-tenkan-kijun-reinvestment.ts` - Verify Tenkan-Kijun reinvestment

#### Analysis Subdirectory
- `analysis/analyze-past-trades.ts` - Past trades analysis
- `analysis/analyze_by_caller.js` - Analysis by caller
- `analysis/analyze_entry_rating.js` - Entry rating analysis
- `analysis/analyze_filtered_ca_drops.js` - Filtered CA drops analysis
- `analysis/analyze_time_period.js` - Time period analysis
- `analysis/create_strategy_comparison.js` - Strategy comparison creation
- `analysis/historical_analysis.js` - Historical analysis

### 4. Calculation Scripts (Metrics & Performance)

- `calculate-portfolio-pnl.ts` - Portfolio PnL calculation
- `calculate-portfolio-pnl-by-caller.ts` - PnL by caller
- `calculate-weighted-portfolio-performance.ts` - Weighted portfolio performance
- `calculate-weighted-portfolio-performance-solana-only.ts` - Solana-only weighted performance
- `calculate-position-sizing.ts` - Position sizing calculation

### 5. Reporting Scripts (Report Generation)

- `generate-strategy-weekly-reports.ts` - **MAJOR**: Strategy weekly reports
  - Dependencies: CSV, ClickHouse, Birdeye API, email templates
  - Output: HTML email reports
  
- `generate-weekly-portfolio-reports.ts` - Weekly portfolio reports
  - Dependencies: CSV, ClickHouse, Birdeye API
  - Output: HTML reports
  
- `generate-email-report.ts` - Email report generation
- `generate-csv-summary.js` - CSV summary generation
- `export_dashboard.js` - Dashboard export

### 6. Data Processing Scripts

#### Data Extraction
- `extract-all-brook-channels.js` - Extract all Brook channels
- `extract-brook6-calls.js` - Extract Brook6 calls
- `extract-lsy-calls.js` - Extract LSY calls
- `extract-bot-tokens-to-clickhouse.ts` - Extract bot tokens to ClickHouse
- `extract-partial-results.ts` - Extract partial results

#### Data Processing Subdirectory
- `data-processing/extract_brook_to_csv.js` - Extract Brook to CSV
- `data-processing/extract_ca_drops.js` - Extract CA drops
- `data-processing/extract_ca_drops_v2.js` - Extract CA drops v2
- `data-processing/extract_failed_mints.js` - Extract failed mints
- `data-processing/filter_ca_drops.js` - Filter CA drops
- `data-processing/import_ca_drops.js` - Import CA drops
- `data-processing/clean_ca_drops_data.js` - Clean CA drops data
- `data-processing/process_brook2_data.js` - Process Brook2 data
- `data-processing/process_brook_simulations.js` - Process Brook simulations
- `data-processing/process_complete_brook_data.js` - Process complete Brook data
- `data-processing/process_final_brook3_data.js` - Process final Brook3 data

#### Data Aggregation
- `aggregate-simulation-results.js` - Aggregate simulation results
- `combine-all-simulations.js` - Combine all simulations
- `process-csv-simulations.js` - Process CSV simulations

### 7. Data Fetching Scripts

- `fetch-100-tokens.ts` - Fetch 100 tokens
- `fetch-20-tokens.ts` - Fetch 20 tokens
- `fetch-all-tokens-to-clickhouse.ts` - Fetch all tokens to ClickHouse
- `fetch-lsy-ohlcv.js` - Fetch LSY OHLCV
- `fetch-lsy-ohlcv-simple.js` - Fetch LSY OHLCV simple
- `fetch-missing-brook-giga-candles.ts` - Fetch missing Brook Giga candles
- `fetch-missing-ohlcv-with-new-key.ts` - Fetch missing OHLCV with new key
- `fetch-remaining-with-birdeye-check.ts` - Fetch remaining with Birdeye check

### 8. Migration Scripts

- `migrate-csv-to-clickhouse.ts` - Migrate CSV to ClickHouse
- `migration/migrate-ca-drops-to-caller-db.js` - Migrate CA drops to caller DB
- `migration/migrate-ca-drops-to-caller-db-fixed.js` - Migrate CA drops (fixed)
- `migration/migrate-csv-to-influx.js` - Migrate CSV to InfluxDB

### 9. Backtesting Scripts

- `backtest-all-lsy-calls.js` - Backtest all LSY calls
- `backtest-all-lsy.ts` - Backtest all LSY
- `backtest-brook-calls.ts` - Backtest Brook calls
- `backtest-brook-dip-entry.ts` - Backtest Brook dip entry

### 10. Utility & Setup Scripts

- `setup-clickhouse.ts` - ClickHouse setup
- `monitor-credits.js` - Monitor API credits
- `list-tokens-without-candles.ts` - List tokens without candles
- `check-giggle.ts` - Check Giggle
- `check-sept10-calls.ts` - Check Sept 10 calls
- `check-token-0xd6b652.ts` - Check specific token
- `cleanup-bot-responses.js` - Cleanup bot responses
- `add-lsy-to-caller-db.js` - Add LSY to caller DB
- `debug_html.js` - Debug HTML
- `test-influxdb-integration.js` - Test InfluxDB integration
- `test-metadata-fetch.ts` - Test metadata fetch
- `weighted-portfolio-top-strategies.ts` - Weighted portfolio top strategies

### 11. New Engine Scripts

- `simulation/run-engine.ts` - **NEW**: Config-driven simulation engine CLI

## Dependency Mapping

### External Dependencies
- **Birdeye API**: Used for OHLCV data fetching
- **ClickHouse**: Primary data storage for candles and results
- **InfluxDB**: Alternative time-series database (legacy)
- **CSV Files**: Primary input format for call data
  - `data/exports/csv/all_brook_channels_calls.csv` - Main input file

### Internal Dependencies
- `src/simulation/candles.ts` - Candle fetching (fetchHybridCandles)
- `src/simulation/indicators.ts` - Technical indicators
- `src/simulation/ichimoku.ts` - Ichimoku calculations
- `src/storage/clickhouse-client.ts` - ClickHouse client
- `src/services/caller-tracking.ts` - Caller tracking service
- `src/services/ohlcv-query.ts` - OHLCV query service

### Common Patterns

1. **CSV Loading Pattern** (used in 30+ scripts):
   ```typescript
   const csv = fs.readFileSync(CSV_PATH, 'utf8');
   const records = await new Promise((resolve, reject) => {
     parse(csv, { columns: true }, (err, records) => {
       if (err) reject(err);
       else resolve(records);
     });
   });
   ```

2. **Candle Fetching Pattern** (used in 20+ scripts):
   ```typescript
   const candles = await fetchHybridCandles(mint, startTime, endTime, chain);
   ```

3. **Strategy Simulation Pattern** (used in 15+ scripts):
   - Define strategy parameters
   - Loop through candles
   - Check stop loss, take profit, trailing stops
   - Calculate PnL

4. **Output Pattern** (used in 25+ scripts):
   - CSV output with stringify
   - JSON output
   - Console logging

## Data Flow

### Input Sources
1. **CSV Files** → Call data (tokens, timestamps, callers)
2. **ClickHouse** → Historical OHLCV data
3. **Birdeye API** → Real-time/fresh OHLCV data
4. **Caller Database** → Caller tracking data

### Processing
1. **Data Loading** → Parse CSV, query ClickHouse/API
2. **Simulation** → Run strategy on candles
3. **Analysis** → Calculate metrics, aggregate results
4. **Optimization** → Test parameter combinations

### Output Destinations
1. **CSV Files** → Results, summaries, trade-by-trade
2. **JSON Files** → Detailed results, configurations
3. **HTML/Email** → Reports, dashboards
4. **ClickHouse** → Stored results
5. **Console** → Logs, summaries

## Migration Priority

### High Priority (Most Used/Complex)
1. `analyze-solana-callers-optimized.ts` - 2496 lines, 100+ strategies
2. `optimize-strategies.ts` - Core optimization framework
3. `generate-strategy-weekly-reports.ts` - Production reporting
4. `run-top-strategies-simulation.ts` - Top strategies
5. `simulate-caller.js` - Caller simulation

### Medium Priority
- All other optimization scripts
- Analysis scripts
- Reporting scripts

### Low Priority (Can Archive)
- Legacy simulation scripts in `scripts/simulation/`
- Test scripts (convert to unit tests)
- One-off utility scripts

