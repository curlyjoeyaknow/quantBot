# 🎯 Interactive CLI - Simulation Workflow

Beautiful, user-friendly interactive prompts for running simulations.

## Usage

```bash
# Interactive mode (recommended for new users)
quantbot sim

# Or use the alias
quantbot simulate
```

## Features

### 📊 Strategy Selection
- Lists all active strategies from database
- Shows strategy name, version, and description
- Navigate with arrow keys, select with Enter

### 📞 Caller Filtering (Optional)
- Lists all available callers
- Option to select "(All callers)" for no filtering
- Shows caller source, handle, and display name

### 📅 Date Range Selection
Interactive date picker with:
1. **Year Selection** - Choose from last 5 years
2. **Month Selection** - Visual list of all 12 months
3. **Day Input** - Type the day (validates against month/year)

### ⏱️ Time Window Configuration
Pre-configured options for:
- **Pre-window**: Minutes before call timestamp to fetch candles
  - None, 15min, 30min, 1hr, 2hr, or custom
- **Post-window**: Minutes after call timestamp to fetch candles
  - None, 30min, 1hr, 2hr, 4hr, or custom

### ✅ Confirmation & Summary
- Shows complete summary before execution
- Confirm or cancel before running

## Example Session

```
$ quantbot sim

🎯 Interactive Simulation Workflow

Let's set up your simulation run...

📊 Loading strategies...
? Select strategy: (Use arrow keys)
❯ IchimokuV1 (v1) - Ichimoku cloud strategy with dynamic targets
  PT2_SL25 (v1) - 2x profit target with 25% stop loss
  Scalper_Fast (v2) - Fast scalping strategy

📞 Loading callers...
? Filter by caller (optional): (Use arrow keys)
❯ (All callers)
  brook/main (Brook - Main Account)
  lsy/alpha (LSY Alpha)

📅 Date Range Selection

? Start Date - Select year: (Use arrow keys)
❯ 2025
  2024
  2023

? Start Date - Select month: (Use arrow keys)
❯ October
  November
  December

? Start Date - Enter day (1-31): 1

? End Date - Select year: 2025
? End Date - Select month: December
? End Date - Enter day (1-31): 1

⏱️  Time Window Configuration

? Pre-window (minutes before call): (Use arrow keys)
❯ None (0 min)
  15 minutes
  30 minutes
  60 minutes (1 hour)
  120 minutes (2 hours)
  Custom...

? Post-window (minutes after call): 120 minutes (2 hours)

? Dry run (do not persist results)? Yes

📋 Simulation Summary:

  Strategy:     IchimokuV1
  Caller:       (all)
  Date Range:   2025-10-01 to 2025-12-01
  Pre-window:   0 minutes
  Post-window:  120 minutes
  Dry Run:      Yes

? Proceed with simulation? Yes

⚙️  Running simulation...

✅ Simulation complete!

═══════════════════════════════════════════════════════════

📈 SUMMARY

  Run ID:          run_abc123...
  Strategy:        IchimokuV1
  Caller:          (all)
  Date Range:      2025-10-01T00:00:00.000Z to 2025-12-01T00:00:00.000Z
  Dry Run:         Yes

📊 TOTALS

  Calls Found:     45
  Calls Attempted: 45
  Calls Succeeded: 42
  Calls Failed:    3
  Total Trades:    84

💰 PnL STATISTICS

  Min:             0.8523
  Max:             2.3456
  Mean:            1.1234
  Median:          1.0987

═══════════════════════════════════════════════════════════

ℹ️  Dry run mode: Results were not persisted to database
```

## Benefits

### For New Users
- No need to remember command flags
- Visual feedback at each step
- Input validation prevents errors
- Clear summary before execution

### For Power Users
- Still have access to non-interactive `quantbot simulation run` command
- Can script the non-interactive version
- Interactive mode great for exploratory analysis

## Technical Details

### Dependencies
- `inquirer` - Interactive CLI prompts
- `@types/inquirer` - TypeScript definitions

### Date Validation
- Automatically validates days based on selected month/year
- Handles leap years correctly
- Prevents invalid date ranges (end before start)

### Database Integration
- Fetches real strategies from Postgres
- Fetches real callers from Postgres
- Uses production context for simulation execution

## Comparison with Non-Interactive Mode

| Feature | Interactive (`quantbot sim`) | Non-Interactive (`quantbot simulation run`) |
|---------|------------------------------|---------------------------------------------|
| Ease of use | ⭐⭐⭐⭐⭐ Beginner-friendly | ⭐⭐⭐ Requires knowledge of flags |
| Speed | ⭐⭐⭐ Requires user input | ⭐⭐⭐⭐⭐ Instant execution |
| Scriptable | ❌ No | ✅ Yes |
| Validation | ✅ Real-time | ✅ At execution |
| Discovery | ✅ Shows available options | ❌ Must know options |

## Tips

1. **Use Tab for autocomplete** in text inputs
2. **Press Ctrl+C** to cancel at any time
3. **Arrow keys** to navigate lists
4. **Enter** to select/confirm
5. **Type to filter** in searchable lists (if enabled)

## Future Enhancements

- [ ] Add search/filter for long strategy lists
- [ ] Save favorite configurations
- [ ] Show recent simulation runs
- [ ] Add progress bar during execution
- [ ] Export results to CSV/JSON
- [ ] Compare multiple simulation runs

