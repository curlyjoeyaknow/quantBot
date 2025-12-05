# Brook Token Selection Analysis

This directory contains scripts to analyze Brook's token selection patterns and replicate his picking technique.

## Overview

Brook is a high-performing caller whose token selections have shown strong returns. These scripts:

1. **Analyze historical Brook calls** to identify common patterns in high-performing picks
2. **Build a scoring model** based on these patterns
3. **Score new tokens** to identify picks that match Brook's criteria

## Scripts

### 1. `analyze-brook-token-selection.ts`

Analyzes all Brook calls from the database to identify patterns in high-performing tokens.

**Features analyzed:**

- Price action (1h, 24h before call)
- Volume trends
- Market cap ranges
- Timing patterns (hour of day, day of week)
- Volatility metrics
- Token age (if available)

**Outputs:**

- `data/exports/brook-analysis/brook-calls-analysis.json` - Full analysis of all calls
- `data/exports/brook-analysis/brook-patterns.json` - Identified patterns
- `data/exports/brook-analysis/brook-scoring-model.json` - Scoring model weights

**Usage:**

```bash
npm run analyze:brook
```

### 2. `score-tokens-like-brook.ts`

Scores new tokens using the patterns identified from Brook's historical calls.

**Usage:**

```bash
# Score a single token
npm run score:tokens <token_address>

# Score multiple tokens
npm run score:tokens <token1> <token2> <token3>
```

**Example:**

```bash
npm run score:tokens So11111111111111111111111111111111111111112
```

**Output:**

- Console output with scores and reasons
- JSON file: `data/exports/brook-analysis/token-scores-<timestamp>.json`

## Key Patterns Identified

Based on analysis of Brook's calls, high-performing tokens typically have:

### Market Cap

- **Micro** (<$1M) or **Small** ($1M-$10M) market caps perform best
- Large market caps (>$100M) tend to underperform

### Price Action

- **Sweet spot**: 5-20% gain in 24h, 0-10% gain in 1h
- Too much pump (>50% in 24h) often means you're too late
- Significant dips (<-20%) can be opportunities but are riskier

### Volume

- Increasing volume is a positive signal
- Volume spikes (>50% increase) are particularly strong signals
- Decreasing volume is a warning sign

### Timing

- US market hours (14-22 UTC) show slightly better performance
- Weekend calls may perform differently

### Volatility

- Moderate volatility (5-20%) is optimal
- Very high volatility (>50%) increases risk

## Scoring Model

The scoring model assigns weights to different features:

- **Market Cap**: Micro (1.5x), Small (1.2x), Mid (0.8x), Large (0.5x)
- **Price Action**: Optimal range gets 1.5x, too much pump gets 0.3x
- **Volume**: Increasing volume gets up to 1.5x multiplier
- **Timing**: US market hours get 1.1x multiplier
- **Volatility**: Moderate volatility gets 1.1x multiplier

Final score is a product of all multipliers. Higher scores indicate tokens that match Brook's successful selection patterns.

## Interpreting Scores

- **Score > 2.0**: Strong match with Brook's patterns
- **Score 1.5-2.0**: Good match
- **Score 1.0-1.5**: Moderate match
- **Score < 1.0**: Weak match

## Notes

- The analysis requires historical data in the database (`caller_alerts` or `ca_calls` tables)
- Birdeye API keys are required for fetching current token data
- The model is based on historical patterns and does not guarantee future performance
- Always do your own research before making trading decisions

## Unified Calls Analysis

### Creating Unified Calls Table

To analyze all calls from all callers (not just Brook), first create a unified table:

```bash
npm run create:unified-calls
```

This creates `data/unified_calls.db` containing all calls from:

- `caller_alerts` table
- `ca_calls` table

The unified table removes duplicates and provides a single source of truth for all calls.

### Scoring and Analyzing Unified Calls

Once the unified table is created, score all tokens and analyze P&L:

```bash
# Score all calls (may take a while)
npm run score:unified-calls

# Score a limited number (for testing)
npm run score:unified-calls 100
```

This script:

1. Loads all calls from the unified table
2. Scores each token using Brook's scoring model
3. Calculates returns (7d and 30d max returns)
4. Analyzes P&L by score ranges (Top 1%, Top 5%, Top 10%, etc.)
5. Identifies highest scoring tokens and their performance

**Output:**

- Console output with P&L analysis by score range
- `data/exports/brook-analysis/unified-calls-scored-<timestamp>.json` - Full scored data
- `data/exports/brook-analysis/unified-calls-summary-<timestamp>.json` - Summary statistics

### Interpreting Results

The analysis shows:

- **Top 1%**: Highest scoring tokens - do they outperform?
- **Top 5%**: High scoring tokens - average returns
- **Top 10%**: Good scoring tokens - performance metrics
- **Bottom 50%**: Low scoring tokens - for comparison

This validates whether the scoring model can identify profitable tokens across all callers, not just Brook.

## Future Improvements

- Add machine learning model for more sophisticated pattern recognition
- Include additional features (liquidity, holder distribution, etc.)
- Real-time monitoring of tokens matching Brook's criteria
- Backtesting of the scoring model on historical data
- Portfolio simulation using top-scoring tokens
