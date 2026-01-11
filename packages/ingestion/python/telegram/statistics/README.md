# Statistical Analysis & Feature Engineering

Statistical analysis and feature engineering for alerts and calls.

## Features

### Feature Engineering
- Price features (price at alert, price changes)
- Volume features (1h, 24h volume, ratios)
- Market features (mcap, liquidity)
- Time features (hour, day, month)
- Caller features (win rate, avg multiple)
- Technical indicators (RSI, SMA, EMA, Bollinger Bands, momentum)

### Statistical Analysis
- Caller performance analysis
- Token pattern analysis
- Correlation analysis
- Feature store for ML training

## Usage

### Feature Engineering

```python
import duckdb
from statistics import FeatureEngine

con = duckdb.connect('tele.duckdb')
engine = FeatureEngine(con)

# Create features for an alert
features = engine.create_alert_features(
    mint='So11111111111111111111111111111111111111112',
    alert_timestamp=datetime(2024, 1, 1, 12, 0, 0),
    caller_name='Brook'
)

print(features)
# {
#   'price_at_alert': 0.001,
#   'volume_24h': 100000.0,
#   'caller_win_rate': 0.65,
#   'rsi_14': 45.2,
#   ...
# }
```

### Statistical Analysis

```python
from statistics import StatisticalAnalyzer

analyzer = StatisticalAnalyzer(con)

# Analyze caller performance
result = analyzer.analyze_caller_performance('Brook')
print(f"Win rate: {result['win_rate']:.2%}")
print(f"Avg return: {result['avg_return']:.2f}x")
print(f"Sharpe ratio: {result['sharpe_ratio']:.2f}")

# Analyze token patterns
patterns = analyzer.analyze_token_patterns('So111...')
print(f"Volatility: {patterns['volatility']:.4f}")
print(f"Price trend: {patterns['price_trend']}")
```

### Feature Store

```python
from statistics import FeatureStore

store = FeatureStore(con)

# Store features
feature_id = store.store_alert_features(
    mint='So111...',
    alert_timestamp=datetime(2024, 1, 1),
    caller_name='Brook',
    features=features
)

# Get training data
training_data = store.get_features_for_training(
    target_col='ath_multiple',
    min_samples=100
)
```

## CLI

```bash
# Analyze caller performance
python3 tools/telegram/cli/analyze.py \
  --duckdb tele.duckdb \
  --caller "Brook"

# Analyze token patterns
python3 tools/telegram/cli/analyze.py \
  --duckdb tele.duckdb \
  --mint So11111111111111111111111111111111111111112
```

