# Scoring Model Validation - Rolling Window Approach

## Overview

This document describes the rolling window validation methodology used to validate that the token scoring model actually correlates with future success.

## Methodology

### Rolling Window Approach

The validation uses a **time-based rolling window** to ensure we're testing the model's predictive power, not just fitting to historical data:

1. **Split data into time windows**: Divide all calls into overlapping time windows (e.g., 30-day windows with 15-day steps)
2. **Train on past data**: For each window, build the scoring model using only calls that occurred **before** that window
3. **Test on future data**: Score tokens in the test window using only data available at call time
4. **Measure correlation**: Compare predicted scores vs actual returns

### Why Rolling Windows?

- **Prevents look-ahead bias**: Model can only use information available at call time
- **Tests real-world performance**: Simulates how the model would perform in production
- **Multiple validation points**: Each window provides an independent test
- **Time-varying patterns**: Captures how model performance changes over time

## Metrics Calculated

### 1. Correlation (Pearson)

- **Correlation 7d**: Correlation between score and max 7-day return
- **Correlation 30d**: Correlation between score and max 30-day return

**Interpretation:**
- `> 0.3`: Moderate positive correlation
- `> 0.5`: Strong positive correlation
- `< 0.1`: Weak/no correlation (model not predictive)

### 2. Precision (Top-Scored Tokens)

- **Precision Top 10%**: % of top 10% by score that had >3x return
- **Precision Top 25%**: % of top 25% by score that had >3x return

**Interpretation:**
- `> 30%`: Good - top-scored tokens are actually winners
- `> 50%`: Excellent - model is highly selective
- `< 20%`: Poor - top scores don't predict success

### 3. Recall (Capturing Winners)

- **Recall Top 10%**: % of all >3x returns that were in top 10% by score
- **Recall Top 25%**: % of all >3x returns that were in top 25% by score

**Interpretation:**
- `> 20%`: Good - model captures significant portion of winners
- `> 40%`: Excellent - model finds most winners
- `< 10%`: Poor - model misses most winners

### 4. Average Returns by Score Quartile

- **Top 10% by score**: Average return of highest-scored tokens
- **Bottom 10% by score**: Average return of lowest-scored tokens
- **Outperformance**: Ratio of top 10% vs bottom 10% returns

**Interpretation:**
- `> 2x outperformance`: Good - high scores predict higher returns
- `> 3x outperformance`: Excellent - strong predictive power
- `< 1.5x outperformance`: Weak - scores don't differentiate well

## Usage

```bash
# Run validation with 30-day windows, 15-day steps (50% overlap)
npm run validate:scoring 30 15

# Run with 60-day windows, 30-day steps (50% overlap)
npm run validate:scoring 60 30

# Run with 7-day windows, 3-day steps (for more granular analysis)
npm run validate:scoring 7 3
```

## Output

The script generates a JSON file with:
- **Summary**: Aggregated metrics across all windows
- **Windows**: Detailed metrics for each validation window

Example output:
```json
{
  "summary": {
    "totalWindows": 12,
    "avgCorrelation30d": 0.42,
    "avgPrecisionTop10": 45.2,
    "avgTop10Return30d": 4.8,
    "avgBottom10Return30d": 1.2,
    "top10Outperformance30d": 4.0
  },
  "windows": [...]
}
```

## Interpreting Results

### Good Model Performance
- Correlation > 0.3
- Precision Top 10% > 30%
- Top 10% outperforms bottom 10% by > 2x
- Consistent across multiple windows

### Poor Model Performance
- Correlation < 0.1
- Precision Top 10% < 20%
- Top 10% doesn't outperform bottom 10%
- High variance across windows (unstable)

### Model Improvement Opportunities
- If correlation is low: Features may not be predictive
- If precision is low but recall is high: Model is too broad, needs to be more selective
- If recall is low but precision is high: Model is too conservative, missing winners
- If variance is high: Model may be overfitting to specific time periods

## Example Results Interpretation

```
=== VALIDATION SUMMARY ===
Windows analyzed: 12

Correlation (Score vs Returns):
  7-day:  38.5%
  30-day: 42.3%

Precision (Top-scored tokens that actually performed):
  Top 10%: 45.2%
  Top 25%: 38.7%

Average Returns:
  Top 10% by score (30d): 4.8x
  Bottom 10% by score (30d): 1.2x

Outperformance:
  Top 10% vs Bottom 10% (30d): 4.0x
```

**Interpretation:**
- ✅ **Strong correlation** (42%): Scores predict returns well
- ✅ **Good precision** (45%): Nearly half of top-scored tokens were winners
- ✅ **Strong outperformance** (4x): Top-scored tokens perform 4x better than bottom-scored
- ✅ **Model is predictive**: The scoring system successfully identifies high-potential tokens

## Next Steps

1. **If validation shows good performance**: Deploy model for live token selection
2. **If validation shows poor performance**: 
   - Analyze which features are most/least predictive
   - Adjust scoring weights based on validation insights
   - Consider adding new features
   - Retrain and re-validate

3. **Monitor over time**: Re-run validation periodically as new data comes in to ensure model remains predictive

