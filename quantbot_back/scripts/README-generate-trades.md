# Generate Remaining Trades Script

This script generates the remaining trades to match weekly and monthly profit targets.

## Requirements

- Python 3.8+
- DuckDB database at `data/tele.duckdb` with `user_calls_d` table
- Existing trades data saved to `existing_trades.txt`

## Usage

1. **Save your existing trades data** to `scripts/existing_trades.txt`:
   - Copy your tab-separated trade data
   - Format: `TradeNumber\tTokenAddress\tAlertTime\tEntryTime\tExitTime\tPnL\tPnLPercent\tMaxReached\tHoldDurationMinutes\tIsWin`
   - Include header row: `TradeNumber	TokenAddress	AlertTime	EntryTime	ExitTime	PnL	PnLPercent	MaxReached	HoldDurationMinutes	IsWin`

2. **Run the script**:
   ```bash
   cd scripts
   python3 generate-remaining-trades.py
   ```

3. **Output**: `all_trades_1547.csv` with all trades matching weekly targets

## Targets

### Weekly Targets
- 2025-08-25: 130 trades, 18.40%
- 2025-09-01: 135 trades, 17.11% (cumulative: 35.51%)
- 2025-09-08: 167 trades, 12.77% (cumulative: 48.28%)
- ... (see script for full list)

### Monthly Targets
- Aug: 18.40% (cumulative: 18.40%, compounded: 1.184)
- Sep: 55.47% (cumulative: 98.68%, compounded: 1.9868)
- Oct: 18.18% (cumulative: 137.06%, compounded: 1.9206)
- Nov: 3.96% (cumulative: 146.25%, compounded: 1.9625)
- Dec: 37.03% (cumulative: 248.90%, compounded: 2.4890)

### Final Targets
- Total trades: 1547
- Non-compounded profit: 133.04%
- Compounded profit: 248.90%

## Notes

- The script pulls real mint addresses from `data/tele.duckdb`
- Trades are distributed across each week to meet targets
- PnL values are adjusted to match exact weekly/monthly targets
- If database has no calls, placeholder mints are used

