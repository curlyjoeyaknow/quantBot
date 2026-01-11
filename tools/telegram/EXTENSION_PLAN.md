# Python/DuckDB Extension Plan: Simulation & Statistical/ML Pipeline

## Executive Summary

Extend the Python/DuckDB Telegram ingestion pipeline with:
1. **Simulation Engine** - Backtesting strategies directly in DuckDB using SQL
2. **Statistical Analysis Pipeline** - Feature engineering, metrics calculation, pattern detection
3. **ML-Style Pipeline** - Feature extraction, model training data preparation, prediction features

**Architecture Principle**: Python/DuckDB for data plane (fast, analytical), TypeScript for orchestration (pipeline control, API boundaries).

---

## Phase 1: Simulation Engine in DuckDB

### 1.1 Core Simulation Tables

**New Tables:**
```sql
-- Strategy definitions
CREATE TABLE simulation_strategies (
  strategy_id TEXT PRIMARY KEY,
  name TEXT,
  entry_config JSON,  -- {type: 'immediate'|'drop'|'trailing', ...}
  exit_config JSON,   -- {targets: [{target: 2.0, percent: 0.5}, ...], stop_loss: {...}}
  reentry_config JSON,
  cost_config JSON,   -- {maker_fee, taker_fee, slippage}
  created_at TIMESTAMP
);

-- Simulation runs (one per strategy + token + time window)
CREATE TABLE simulation_runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT REFERENCES simulation_strategies(strategy_id),
  mint TEXT,
  alert_timestamp TIMESTAMP,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  initial_capital DOUBLE,
  final_capital DOUBLE,
  total_return_pct DOUBLE,
  max_drawdown_pct DOUBLE,
  sharpe_ratio DOUBLE,
  win_rate DOUBLE,
  total_trades INTEGER,
  created_at TIMESTAMP
);

-- Simulation events (trades, entries, exits)
CREATE TABLE simulation_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES simulation_runs(run_id),
  event_type TEXT,  -- 'entry'|'exit'|'stop_loss'|'reentry'
  timestamp TIMESTAMP,
  price DOUBLE,
  quantity DOUBLE,
  value_usd DOUBLE,
  fee_usd DOUBLE,
  pnl_usd DOUBLE,
  cumulative_pnl_usd DOUBLE,
  position_size DOUBLE,
  metadata JSON  -- {target_hit: 2.0, reason: 'profit_target', ...}
);
```

### 1.2 OHLCV Integration

**Extend existing schema:**
```sql
-- Add to existing user_calls_d or create separate view
CREATE VIEW v_calls_with_ohlcv AS
SELECT 
  u.*,
  c.timestamp AS candle_timestamp,
  c.open, c.high, c.low, c.close, c.volume,
  c.interval_seconds
FROM user_calls_d u
LEFT JOIN ohlcv_candles_d c 
  ON u.mint = c.mint 
  AND c.timestamp >= u.call_ts_ms / 1000
  AND c.timestamp <= (u.call_ts_ms / 1000) + (1440 * 60)  -- 24h window
ORDER BY u.call_ts_ms, c.timestamp;
```

### 1.3 Simulation SQL Functions

**Window Functions for Strategy Logic:**
```python
# tools/telegram/simulation/sql_functions.py

SIMULATION_SQL = """
-- Entry detection (immediate entry at alert time)
CREATE OR REPLACE FUNCTION detect_entry_immediate(
  alert_ts TIMESTAMP,
  price_at_alert DOUBLE
) RETURNS TABLE (
  entry_timestamp TIMESTAMP,
  entry_price DOUBLE
) AS $$
  SELECT alert_ts, price_at_alert;
$$;

-- Profit target detection (using window functions)
CREATE OR REPLACE FUNCTION detect_profit_targets(
  candles ARRAY(STRUCT(timestamp TIMESTAMP, high DOUBLE, low DOUBLE, close DOUBLE)),
  entry_price DOUBLE,
  targets ARRAY(STRUCT(target DOUBLE, percent DOUBLE))
) RETURNS TABLE (
  target_hit DOUBLE,
  hit_timestamp TIMESTAMP,
  exit_price DOUBLE,
  percent_exited DOUBLE
) AS $$
  -- SQL logic to detect when price hits each target
  -- Uses ARRAY functions and window functions
$$;

-- Stop loss detection
CREATE OR REPLACE FUNCTION detect_stop_loss(
  candles ARRAY(...),
  entry_price DOUBLE,
  stop_loss_pct DOUBLE
) RETURNS TABLE (
  stop_hit BOOLEAN,
  stop_timestamp TIMESTAMP,
  exit_price DOUBLE
) AS $$ ... $$;

-- Trailing stop logic
CREATE OR REPLACE FUNCTION detect_trailing_stop(
  candles ARRAY(...),
  entry_price DOUBLE,
  trailing_pct DOUBLE,
  activation_pct DOUBLE
) RETURNS TABLE (...) AS $$ ... $$;
"""
```

### 1.4 Python Simulation Orchestrator

**File: `tools/telegram/simulation/simulator.py`**
```python
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import duckdb
from datetime import datetime, timedelta

@dataclass
class StrategyConfig:
    strategy_id: str
    name: str
    entry_type: str  # 'immediate'|'drop'|'trailing'
    profit_targets: List[Dict[str, float]]  # [{target: 2.0, percent: 0.5}, ...]
    stop_loss_pct: Optional[float] = None
    trailing_stop_pct: Optional[float] = None
    trailing_activation_pct: Optional[float] = None
    reentry_config: Optional[Dict[str, Any]] = None
    maker_fee: float = 0.001
    taker_fee: float = 0.001
    slippage: float = 0.005

class DuckDBSimulator:
    """Run simulations directly in DuckDB using SQL"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        self._setup_simulation_tables()
        self._setup_simulation_functions()
    
    def run_simulation(
        self,
        strategy: StrategyConfig,
        mint: str,
        alert_timestamp: datetime,
        initial_capital: float = 1000.0,
        lookback_minutes: int = 260,  # Pre-alert window
        lookforward_minutes: int = 1440  # Post-alert window
    ) -> Dict[str, Any]:
        """
        Run a complete simulation for a single token/alert.
        
        Returns:
            {
                'run_id': str,
                'final_capital': float,
                'total_return_pct': float,
                'max_drawdown_pct': float,
                'sharpe_ratio': float,
                'win_rate': float,
                'total_trades': int,
                'events': List[Dict]
            }
        """
        # 1. Fetch candles for time window
        candles = self._fetch_candles(mint, alert_timestamp, lookback_minutes, lookforward_minutes)
        
        # 2. Execute entry logic
        entry_event = self._execute_entry(strategy, alert_timestamp, candles)
        
        # 3. Execute exit logic (profit targets, stop loss, trailing stop)
        exit_events = self._execute_exits(strategy, entry_event, candles)
        
        # 4. Calculate metrics
        metrics = self._calculate_metrics(entry_event, exit_events, initial_capital)
        
        # 5. Store results
        run_id = self._store_simulation_run(strategy, mint, alert_timestamp, metrics)
        self._store_simulation_events(run_id, [entry_event] + exit_events)
        
        return {
            'run_id': run_id,
            **metrics,
            'events': [entry_event] + exit_events
        }
    
    def batch_simulate(
        self,
        strategy: StrategyConfig,
        mints: List[str],
        alert_timestamps: List[datetime],
        initial_capital: float = 1000.0
    ) -> List[Dict[str, Any]]:
        """Run simulations for multiple tokens in parallel"""
        results = []
        for mint, alert_ts in zip(mints, alert_timestamps):
            try:
                result = self.run_simulation(strategy, mint, alert_ts, initial_capital)
                results.append(result)
            except Exception as e:
                logger.error(f"Simulation failed for {mint} at {alert_ts}: {e}")
                results.append({'error': str(e), 'mint': mint, 'alert_timestamp': alert_ts})
        return results
    
    def _execute_entry(self, strategy: StrategyConfig, alert_ts: datetime, candles: List[Dict]) -> Dict:
        """Execute entry logic based on strategy type"""
        if strategy.entry_type == 'immediate':
            # Entry at alert time price
            entry_price = self._get_price_at_timestamp(candles, alert_ts)
            return {
                'event_type': 'entry',
                'timestamp': alert_ts,
                'price': entry_price,
                'quantity': 1.0,  # Normalized
                'value_usd': entry_price,
                'fee_usd': entry_price * strategy.maker_fee,
                'pnl_usd': 0.0
            }
        elif strategy.entry_type == 'drop':
            # Entry on price drop
            return self._execute_drop_entry(strategy, alert_ts, candles)
        elif strategy.entry_type == 'trailing':
            # Entry on trailing condition
            return self._execute_trailing_entry(strategy, alert_ts, candles)
    
    def _execute_exits(self, strategy: StrategyConfig, entry_event: Dict, candles: List[Dict]) -> List[Dict]:
        """Execute exit logic: profit targets, stop loss, trailing stop"""
        exit_events = []
        entry_price = entry_event['price']
        entry_ts = entry_event['timestamp']
        
        # Filter candles after entry
        post_entry_candles = [c for c in candles if c['timestamp'] > entry_ts]
        
        # Check profit targets
        for target in strategy.profit_targets:
            exit_event = self._check_profit_target(
                entry_price, target, post_entry_candles, strategy
            )
            if exit_event:
                exit_events.append(exit_event)
        
        # Check stop loss
        if strategy.stop_loss_pct:
            stop_event = self._check_stop_loss(
                entry_price, strategy.stop_loss_pct, post_entry_candles, strategy
            )
            if stop_event:
                exit_events.append(stop_event)
        
        # Check trailing stop
        if strategy.trailing_stop_pct:
            trailing_event = self._check_trailing_stop(
                entry_price, strategy.trailing_stop_pct, 
                strategy.trailing_activation_pct, post_entry_candles, strategy
            )
            if trailing_event:
                exit_events.append(trailing_event)
        
        # Sort by timestamp, take first exit
        exit_events.sort(key=lambda e: e['timestamp'])
        return exit_events[:1] if exit_events else []
    
    def _calculate_metrics(
        self, 
        entry_event: Dict, 
        exit_events: List[Dict], 
        initial_capital: float
    ) -> Dict[str, float]:
        """Calculate simulation metrics"""
        if not exit_events:
            return {
                'final_capital': initial_capital,
                'total_return_pct': 0.0,
                'max_drawdown_pct': 0.0,
                'sharpe_ratio': 0.0,
                'win_rate': 0.0,
                'total_trades': 0
            }
        
        exit_event = exit_events[0]
        entry_price = entry_event['price']
        exit_price = exit_event['price']
        
        # Calculate return
        return_pct = ((exit_price - entry_price) / entry_price) * 100
        final_capital = initial_capital * (1 + return_pct / 100)
        
        # Calculate drawdown (simplified - would need full price series)
        max_drawdown_pct = 0.0  # TODO: implement
        
        # Calculate Sharpe ratio (simplified)
        sharpe_ratio = 0.0  # TODO: implement with returns series
        
        return {
            'final_capital': final_capital,
            'total_return_pct': return_pct,
            'max_drawdown_pct': max_drawdown_pct,
            'sharpe_ratio': sharpe_ratio,
            'win_rate': 1.0 if return_pct > 0 else 0.0,
            'total_trades': 1
        }
```

### 1.5 Integration with TypeScript

**Bridge Script: `tools/telegram/simulation/run_simulation.py`**
```python
#!/usr/bin/env python3
"""
CLI script to run simulations from TypeScript handler.
Accepts JSON config, returns JSON results.
"""

import json
import sys
import duckdb
from simulator import DuckDBSimulator, StrategyConfig

def main():
    # Read config from stdin (JSON)
    config = json.load(sys.stdin)
    
    # Connect to DuckDB
    con = duckdb.connect(config['duckdb_path'])
    
    # Create simulator
    simulator = DuckDBSimulator(con)
    
    # Parse strategy config
    strategy = StrategyConfig(**config['strategy'])
    
    # Run simulation(s)
    if config.get('batch'):
        results = simulator.batch_simulate(
            strategy,
            config['mints'],
            [datetime.fromisoformat(ts) for ts in config['alert_timestamps']],
            config.get('initial_capital', 1000.0)
        )
    else:
        result = simulator.run_simulation(
            strategy,
            config['mint'],
            datetime.fromisoformat(config['alert_timestamp']),
            config.get('initial_capital', 1000.0)
        )
        results = [result]
    
    # Output JSON results
    print(json.dumps({
        'results': results,
        'summary': {
            'total_runs': len(results),
            'successful': len([r for r in results if 'error' not in r]),
            'failed': len([r for r in results if 'error' in r])
        }
    }))

if __name__ == '__main__':
    main()
```

---

## Phase 2: Statistical Analysis Pipeline

### 2.1 Feature Engineering Module

**File: `tools/telegram/statistics/feature_engineering.py`**
```python
"""
Feature engineering for alerts and calls.
Creates features for ML models and statistical analysis.
"""

import duckdb
from typing import List, Dict, Any
from datetime import datetime, timedelta

class FeatureEngine:
    """Engine for creating statistical features from alerts/calls"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
    
    def create_alert_features(self, mint: str, alert_timestamp: datetime) -> Dict[str, Any]:
        """
        Create features for a single alert.
        
        Features:
        - Price features: price_at_alert, price_change_1h, price_change_24h
        - Volume features: volume_1h, volume_24h, volume_ratio
        - Market features: mcap_at_alert, liquidity_at_alert, holders_count
        - Time features: hour_of_day, day_of_week, days_since_launch
        - Caller features: caller_win_rate, caller_avg_multiple, caller_total_calls
        - Token features: token_age_days, previous_ath, previous_atl
        """
        features = {}
        
        # Price features
        features.update(self._get_price_features(mint, alert_timestamp))
        
        # Volume features
        features.update(self._get_volume_features(mint, alert_timestamp))
        
        # Market features
        features.update(self._get_market_features(mint, alert_timestamp))
        
        # Time features
        features.update(self._get_time_features(alert_timestamp))
        
        # Caller features
        features.update(self._get_caller_features(mint, alert_timestamp))
        
        # Token features
        features.update(self._get_token_features(mint, alert_timestamp))
        
        return features
    
    def create_candle_features(self, candles: List[Dict]) -> Dict[str, Any]:
        """
        Create features from candle data.
        
        Features:
        - Technical indicators: RSI, MACD, moving averages
        - Volatility: std_dev, bollinger_bands
        - Momentum: price_momentum, volume_momentum
        - Patterns: support_resistance_levels, breakouts
        """
        features = {}
        
        # Technical indicators
        features['rsi_14'] = self._calculate_rsi(candles, 14)
        features['rsi_30'] = self._calculate_rsi(candles, 30)
        features['macd'] = self._calculate_macd(candles)
        features['sma_20'] = self._calculate_sma(candles, 20)
        features['sma_50'] = self._calculate_sma(candles, 50)
        features['ema_12'] = self._calculate_ema(candles, 12)
        features['ema_26'] = self._calculate_ema(candles, 26)
        
        # Volatility
        features['volatility_20'] = self._calculate_volatility(candles, 20)
        features['bollinger_upper'], features['bollinger_lower'] = self._calculate_bollinger_bands(candles, 20)
        
        # Momentum
        features['price_momentum_5'] = self._calculate_momentum(candles, 5)
        features['volume_momentum_5'] = self._calculate_volume_momentum(candles, 5)
        
        return features
    
    def create_sequence_features(self, candles: List[Dict], window_size: int = 60) -> List[Dict[str, Any]]:
        """
        Create sequence features for time series models.
        
        Returns list of feature dicts, one per candle in sequence.
        """
        sequence_features = []
        
        for i in range(len(candles)):
            window = candles[max(0, i - window_size):i+1]
            features = self.create_candle_features(window)
            features['timestamp'] = candles[i]['timestamp']
            features['price'] = candles[i]['close']
            sequence_features.append(features)
        
        return sequence_features
    
    def _get_price_features(self, mint: str, alert_timestamp: datetime) -> Dict[str, float]:
        """Get price-related features"""
        result = self.con.execute("""
            SELECT 
                price_usd,
                price_move_pct,
                chg_1h_pct
            FROM user_calls_d
            WHERE mint = ? AND call_ts_ms = ?
        """, [mint, int(alert_timestamp.timestamp() * 1000)]).fetchone()
        
        if result:
            return {
                'price_at_alert': result[0] or 0.0,
                'price_change_pct': result[1] or 0.0,
                'price_change_1h_pct': result[2] or 0.0
            }
        return {'price_at_alert': 0.0, 'price_change_pct': 0.0, 'price_change_1h_pct': 0.0}
    
    def _calculate_rsi(self, candles: List[Dict], period: int) -> float:
        """Calculate RSI indicator"""
        if len(candles) < period + 1:
            return 50.0  # Neutral
        
        gains = []
        losses = []
        
        for i in range(1, len(candles)):
            change = candles[i]['close'] - candles[i-1]['close']
            if change > 0:
                gains.append(change)
                losses.append(0.0)
            else:
                gains.append(0.0)
                losses.append(abs(change))
        
        if len(gains) < period:
            return 50.0
        
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        
        return rsi
    
    # ... (implement other indicator calculations)
```

### 2.2 Statistical Analysis Module

**File: `tools/telegram/statistics/analysis.py`**
```python
"""
Statistical analysis of alerts and calls.
"""

import duckdb
import numpy as np
from typing import List, Dict, Any, Optional
from scipy import stats

class StatisticalAnalyzer:
    """Perform statistical analysis on alert/call data"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
    
    def analyze_caller_performance(self, caller_name: str) -> Dict[str, Any]:
        """
        Statistical analysis of caller performance.
        
        Returns:
        - Win rate and confidence intervals
        - Average return distribution
        - Sharpe ratio
        - Maximum drawdown statistics
        - Correlation with market conditions
        """
        # Fetch caller's calls with outcomes
        calls = self.con.execute("""
            SELECT 
                u.mint,
                u.call_ts_ms,
                u.mcap_usd,
                u.price_usd,
                COALESCE(a.ath_multiple, 0) as ath_multiple,
                COALESCE(a.atl_multiple, 0) as atl_multiple
            FROM user_calls_d u
            LEFT JOIN alerts a ON u.mint = a.token_id AND u.call_ts_ms = a.alert_timestamp
            WHERE u.caller_name = ?
            ORDER BY u.call_ts_ms
        """, [caller_name]).fetchall()
        
        if not calls:
            return {'error': 'No calls found for caller'}
        
        # Extract metrics
        returns = [c[4] for c in calls if c[4] is not None]  # ATH multiples
        wins = [r for r in returns if r > 1.0]
        losses = [r for r in returns if r < 1.0]
        
        # Calculate statistics
        win_rate = len(wins) / len(returns) if returns else 0.0
        avg_return = np.mean(returns) if returns else 0.0
        median_return = np.median(returns) if returns else 0.0
        std_return = np.std(returns) if returns else 0.0
        
        # Confidence intervals
        if len(returns) > 1:
            ci_lower, ci_upper = stats.t.interval(
                0.95, len(returns)-1, 
                loc=avg_return, 
                scale=stats.sem(returns)
            )
        else:
            ci_lower, ci_upper = avg_return, avg_return
        
        # Sharpe ratio (simplified)
        sharpe = (avg_return - 1.0) / std_return if std_return > 0 else 0.0
        
        return {
            'caller_name': caller_name,
            'total_calls': len(calls),
            'win_rate': win_rate,
            'avg_return': avg_return,
            'median_return': median_return,
            'std_return': std_return,
            'sharpe_ratio': sharpe,
            'confidence_interval_95': [ci_lower, ci_upper],
            'wins': len(wins),
            'losses': len(losses),
            'best_return': max(returns) if returns else 0.0,
            'worst_return': min(returns) if returns else 0.0
        }
    
    def analyze_token_patterns(self, mint: str) -> Dict[str, Any]:
        """
        Analyze patterns in token price/volume behavior.
        
        Returns:
        - Price volatility patterns
        - Volume patterns
        - Correlation between features and outcomes
        """
        # Fetch candles
        candles = self.con.execute("""
            SELECT timestamp, open, high, low, close, volume
            FROM ohlcv_candles_d
            WHERE mint = ?
            ORDER BY timestamp
        """, [mint]).fetchall()
        
        if len(candles) < 10:
            return {'error': 'Insufficient data'}
        
        # Calculate patterns
        prices = [c[4] for c in candles]  # close prices
        volumes = [c[5] for c in candles]
        
        # Volatility patterns
        price_changes = [abs(prices[i] - prices[i-1]) / prices[i-1] for i in range(1, len(prices))]
        volatility = np.std(price_changes)
        
        # Volume patterns
        avg_volume = np.mean(volumes)
        volume_std = np.std(volumes)
        
        # Trend analysis
        price_trend = self._calculate_trend(prices)
        volume_trend = self._calculate_trend(volumes)
        
        return {
            'mint': mint,
            'total_candles': len(candles),
            'volatility': volatility,
            'avg_volume': avg_volume,
            'volume_std': volume_std,
            'price_trend': price_trend,
            'volume_trend': volume_trend
        }
    
    def correlation_analysis(self, feature_cols: List[str], target_col: str) -> Dict[str, float]:
        """
        Calculate correlation between features and target.
        
        Args:
            feature_cols: List of feature column names
            target_col: Target column name (e.g., 'ath_multiple')
        
        Returns:
            Dict mapping feature names to correlation coefficients
        """
        # Build SQL query
        cols = ', '.join(feature_cols + [target_col])
        query = f"""
            SELECT {cols}
            FROM v_alerts_with_features
            WHERE {target_col} IS NOT NULL
        """
        
        data = self.con.execute(query).fetchall()
        
        if len(data) < 2:
            return {}
        
        # Calculate correlations
        correlations = {}
        target_values = [row[-1] for row in data]
        
        for i, col in enumerate(feature_cols):
            feature_values = [row[i] for row in data]
            corr, p_value = stats.pearsonr(feature_values, target_values)
            correlations[col] = {
                'correlation': corr,
                'p_value': p_value,
                'significant': p_value < 0.05
            }
        
        return correlations
    
    def _calculate_trend(self, values: List[float]) -> str:
        """Calculate trend direction"""
        if len(values) < 2:
            return 'unknown'
        
        first_half = np.mean(values[:len(values)//2])
        second_half = np.mean(values[len(values)//2:])
        
        if second_half > first_half * 1.1:
            return 'upward'
        elif second_half < first_half * 0.9:
            return 'downward'
        else:
            return 'stable'
```

### 2.3 Feature Store

**File: `tools/telegram/statistics/feature_store.py`**
```python
"""
Feature store for ML pipeline.
Stores computed features in DuckDB for model training.
"""

import duckdb
from typing import List, Dict, Any
from datetime import datetime

class FeatureStore:
    """Store and retrieve features for ML models"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        self._setup_feature_tables()
    
    def _setup_feature_tables(self):
        """Create feature storage tables"""
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS alert_features (
                feature_id TEXT PRIMARY KEY,
                mint TEXT,
                alert_timestamp TIMESTAMP,
                caller_name TEXT,
                features JSON,  -- All computed features as JSON
                created_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS candle_features (
                feature_id TEXT PRIMARY KEY,
                mint TEXT,
                candle_timestamp TIMESTAMP,
                features JSON,
                created_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS sequence_features (
                sequence_id TEXT PRIMARY KEY,
                mint TEXT,
                start_timestamp TIMESTAMP,
                end_timestamp TIMESTAMP,
                features_array JSON,  -- Array of feature dicts
                created_at TIMESTAMP
            );
        """)
    
    def store_alert_features(
        self, 
        mint: str, 
        alert_timestamp: datetime, 
        caller_name: str,
        features: Dict[str, Any]
    ) -> str:
        """Store features for an alert"""
        feature_id = f"{mint}_{int(alert_timestamp.timestamp())}"
        
        self.con.execute("""
            INSERT OR REPLACE INTO alert_features 
            (feature_id, mint, alert_timestamp, caller_name, features, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            feature_id,
            mint,
            alert_timestamp,
            caller_name,
            json.dumps(features),
            datetime.now()
        ])
        
        return feature_id
    
    def get_features_for_training(
        self,
        target_col: str = 'ath_multiple',
        min_samples: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get features and targets for model training.
        
        Returns list of dicts with 'features' and 'target' keys.
        """
        # Join features with targets
        query = """
            SELECT 
                af.features,
                COALESCE(a.ath_multiple, 0) as target
            FROM alert_features af
            LEFT JOIN alerts a ON af.mint = a.token_id AND af.alert_timestamp = a.alert_timestamp
            WHERE a.ath_multiple IS NOT NULL
            LIMIT ?
        """
        
        rows = self.con.execute(query, [min_samples]).fetchall()
        
        training_data = []
        for row in rows:
            features = json.loads(row[0])
            target = row[1]
            training_data.append({
                'features': features,
                'target': target
            })
        
        return training_data
```

---

## Phase 3: ML-Style Pipeline

### 3.1 Model Training Data Preparation

**File: `tools/telegram/ml/data_preparation.py`**
```python
"""
Prepare data for ML model training.
"""

import duckdb
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Tuple
from sklearn.preprocessing import StandardScaler, LabelEncoder

class MLDataPreparator:
    """Prepare data for ML model training"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        self.scaler = StandardScaler()
        self.label_encoders = {}
    
    def prepare_training_data(
        self,
        target_col: str = 'ath_multiple',
        feature_cols: List[str] = None,
        min_samples: int = 100,
        test_size: float = 0.2
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Prepare training and test datasets.
        
        Returns:
            X_train, X_test, y_train, y_test
        """
        # Fetch data from DuckDB
        df = self._fetch_training_data(target_col, feature_cols, min_samples)
        
        if df.empty:
            raise ValueError("No training data available")
        
        # Separate features and target
        if feature_cols is None:
            feature_cols = [col for col in df.columns if col != target_col]
        
        X = df[feature_cols].values
        y = df[target_col].values
        
        # Handle categorical features
        X = self._encode_categorical_features(X, feature_cols, df)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Split train/test
        split_idx = int(len(X_scaled) * (1 - test_size))
        X_train = X_scaled[:split_idx]
        X_test = X_scaled[split_idx:]
        y_train = y[:split_idx]
        y_test = y[split_idx:]
        
        return X_train, X_test, y_train, y_test
    
    def prepare_sequence_data(
        self,
        sequence_length: int = 60,
        target_col: str = 'ath_multiple',
        min_sequences: int = 50
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare sequence data for time series models (LSTM, Transformer).
        
        Returns:
            X_sequences: (n_sequences, sequence_length, n_features)
            y_sequences: (n_sequences,)
        """
        # Fetch sequence features
        sequences = self.con.execute("""
            SELECT features_array, target
            FROM sequence_features_with_targets
            WHERE LENGTH(features_array) >= ?
            LIMIT ?
        """, [sequence_length, min_sequences * 10]).fetchall()
        
        X_list = []
        y_list = []
        
        for seq_data, target in sequences:
            features_array = json.loads(seq_data)
            
            if len(features_array) < sequence_length:
                continue
            
            # Extract features from sequence
            sequence_features = []
            for feat_dict in features_array[-sequence_length:]:
                # Convert feature dict to array
                feat_array = [feat_dict.get(f'feature_{i}', 0.0) for i in range(len(feat_dict))]
                sequence_features.append(feat_array)
            
            X_list.append(sequence_features)
            y_list.append(target)
        
        X_sequences = np.array(X_list)
        y_sequences = np.array(y_list)
        
        return X_sequences, y_sequences
    
    def _fetch_training_data(
        self,
        target_col: str,
        feature_cols: List[str],
        min_samples: int
    ) -> pd.DataFrame:
        """Fetch training data from DuckDB"""
        # Build query
        if feature_cols:
            cols = ', '.join(feature_cols + [target_col])
        else:
            cols = '*'
        
        query = f"""
            SELECT {cols}
            FROM v_training_data
            WHERE {target_col} IS NOT NULL
            LIMIT ?
        """
        
        result = self.con.execute(query, [min_samples]).df()
        return result
    
    def _encode_categorical_features(
        self,
        X: np.ndarray,
        feature_cols: List[str],
        df: pd.DataFrame
    ) -> np.ndarray:
        """Encode categorical features"""
        X_encoded = X.copy()
        
        for i, col in enumerate(feature_cols):
            if df[col].dtype == 'object' or df[col].dtype.name == 'category':
                if col not in self.label_encoders:
                    self.label_encoders[col] = LabelEncoder()
                    X_encoded[:, i] = self.label_encoders[col].fit_transform(df[col])
                else:
                    X_encoded[:, i] = self.label_encoders[col].transform(df[col])
        
        return X_encoded
```

### 3.2 Model Training Interface

**File: `tools/telegram/ml/train_models.py`**
```python
"""
Train ML models on alert/call data.
"""

import json
import pickle
from typing import Dict, Any, List
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
import numpy as np

class ModelTrainer:
    """Train ML models for prediction"""
    
    def __init__(self):
        self.models = {}
        self.model_metrics = {}
    
    def train_regression_model(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_test: np.ndarray,
        y_test: np.ndarray,
        model_type: str = 'random_forest'
    ) -> Dict[str, Any]:
        """
        Train a regression model to predict target (e.g., ATH multiple).
        
        Returns:
            Model object and metrics
        """
        # Select model
        if model_type == 'random_forest':
            model = RandomForestRegressor(n_estimators=100, random_state=42)
        elif model_type == 'gradient_boosting':
            model = GradientBoostingRegressor(n_estimators=100, random_state=42)
        elif model_type == 'linear':
            model = LinearRegression()
        else:
            raise ValueError(f"Unknown model type: {model_type}")
        
        # Train
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred_train = model.predict(X_train)
        y_pred_test = model.predict(X_test)
        
        metrics = {
            'train_mse': mean_squared_error(y_train, y_pred_train),
            'test_mse': mean_squared_error(y_test, y_pred_test),
            'train_r2': r2_score(y_train, y_pred_train),
            'test_r2': r2_score(y_test, y_pred_test),
            'train_mae': mean_absolute_error(y_train, y_pred_train),
            'test_mae': mean_absolute_error(y_test, y_pred_test)
        }
        
        # Feature importance (if available)
        if hasattr(model, 'feature_importances_'):
            metrics['feature_importances'] = model.feature_importances_.tolist()
        
        self.models[model_type] = model
        self.model_metrics[model_type] = metrics
        
        return {
            'model': model,
            'metrics': metrics
        }
    
    def save_model(self, model_type: str, filepath: str):
        """Save trained model to file"""
        if model_type not in self.models:
            raise ValueError(f"Model {model_type} not trained")
        
        with open(filepath, 'wb') as f:
            pickle.dump({
                'model': self.models[model_type],
                'metrics': self.model_metrics[model_type]
            }, f)
    
    def load_model(self, filepath: str) -> Dict[str, Any]:
        """Load trained model from file"""
        with open(filepath, 'rb') as f:
            return pickle.load(f)
```

### 3.3 Prediction Interface

**File: `tools/telegram/ml/predict.py`**
```python
"""
Make predictions using trained models.
"""

import pickle
import numpy as np
from typing import Dict, Any, List

class Predictor:
    """Make predictions on new alerts"""
    
    def __init__(self, model_path: str):
        with open(model_path, 'rb') as f:
            model_data = pickle.load(f)
        self.model = model_data['model']
        self.metrics = model_data.get('metrics', {})
    
    def predict(self, features: Dict[str, Any], feature_order: List[str]) -> Dict[str, Any]:
        """
        Predict target value for given features.
        
        Args:
            features: Dict of feature values
            feature_order: Order of features expected by model
        
        Returns:
            Prediction and confidence
        """
        # Convert features to array in correct order
        feature_array = np.array([[features.get(f, 0.0) for f in feature_order]])
        
        # Predict
        prediction = self.model.predict(feature_array)[0]
        
        # Calculate confidence (simplified - could use prediction intervals)
        confidence = 0.8  # TODO: implement proper confidence calculation
        
        return {
            'prediction': float(prediction),
            'confidence': confidence,
            'model_metrics': self.metrics
        }
```

---

## Phase 4: Integration & CLI

### 4.1 Python CLI Scripts

**File: `tools/telegram/cli/simulate.py`**
```python
#!/usr/bin/env python3
"""
CLI script for running simulations.
"""

import argparse
import json
import duckdb
from simulation.simulator import DuckDBSimulator, StrategyConfig

def main():
    parser = argparse.ArgumentParser(description='Run trading simulations')
    parser.add_argument('--duckdb', required=True, help='DuckDB file path')
    parser.add_argument('--strategy', required=True, help='Strategy JSON file')
    parser.add_argument('--mint', help='Single mint to simulate')
    parser.add_argument('--batch', action='store_true', help='Batch mode')
    parser.add_argument('--output', help='Output JSON file')
    
    args = parser.parse_args()
    
    # Load strategy
    with open(args.strategy, 'r') as f:
        strategy_data = json.load(f)
    strategy = StrategyConfig(**strategy_data)
    
    # Connect to DuckDB
    con = duckdb.connect(args.duckdb)
    simulator = DuckDBSimulator(con)
    
    # Run simulation
    if args.batch:
        # Batch mode - simulate all calls
        results = simulator.batch_simulate_all(strategy)
    else:
        # Single mint
        results = [simulator.run_simulation(strategy, args.mint, ...)]
    
    # Output results
    output = {'results': results}
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(output, f, indent=2)
    else:
        print(json.dumps(output, indent=2))

if __name__ == '__main__':
    main()
```

**File: `tools/telegram/cli/analyze.py`**
```python
#!/usr/bin/env python3
"""
CLI script for statistical analysis.
"""

import argparse
import json
import duckdb
from statistics.analysis import StatisticalAnalyzer

def main():
    parser = argparse.ArgumentParser(description='Statistical analysis')
    parser.add_argument('--duckdb', required=True)
    parser.add_argument('--caller', help='Analyze specific caller')
    parser.add_argument('--mint', help='Analyze specific token')
    parser.add_argument('--correlation', action='store_true', help='Correlation analysis')
    
    args = parser.parse_args()
    
    con = duckdb.connect(args.duckdb)
    analyzer = StatisticalAnalyzer(con)
    
    if args.caller:
        result = analyzer.analyze_caller_performance(args.caller)
    elif args.mint:
        result = analyzer.analyze_token_patterns(args.mint)
    elif args.correlation:
        result = analyzer.correlation_analysis(['feature1', 'feature2'], 'ath_multiple')
    else:
        result = {'error': 'Specify --caller, --mint, or --correlation'}
    
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
```

### 4.2 TypeScript Handler Integration

**File: `packages/cli/src/handlers/simulation/run-simulation-duckdb.ts`**
```typescript
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { execa } from 'execa';
import path from 'path';

export async function runSimulationDuckdbHandler(
  args: { strategy: string; duckdb: string; mint?: string; batch?: boolean },
  ctx: CommandContext
) {
  const pythonScript = path.resolve(
    __dirname,
    '../../../../../tools/telegram/cli/simulate.py'
  );
  
  const pythonArgs = [
    '--duckdb', args.duckdb,
    '--strategy', args.strategy,
  ];
  
  if (args.mint) {
    pythonArgs.push('--mint', args.mint);
  }
  
  if (args.batch) {
    pythonArgs.push('--batch');
  }
  
  const { stdout } = await execa('python3', [pythonScript, ...pythonArgs]);
  return JSON.parse(stdout);
}
```

---

## Phase 5: Testing Strategy

### 5.1 Python Tests

**File: `tools/telegram/tests/test_simulation.py`**
```python
import pytest
import duckdb
from simulation.simulator import DuckDBSimulator, StrategyConfig

def test_immediate_entry_simulation(test_db):
    """Test immediate entry strategy"""
    simulator = DuckDBSimulator(test_db)
    strategy = StrategyConfig(
        strategy_id='test_immediate',
        name='Test Immediate',
        entry_type='immediate',
        profit_targets=[{'target': 2.0, 'percent': 0.5}],
        stop_loss_pct=0.2
    )
    
    result = simulator.run_simulation(
        strategy,
        'So11111111111111111111111111111111111111112',
        datetime(2024, 1, 1, 12, 0, 0),
        initial_capital=1000.0
    )
    
    assert 'run_id' in result
    assert 'final_capital' in result
    assert result['total_trades'] >= 0
```

**File: `tools/telegram/tests/test_feature_engineering.py`**
```python
def test_alert_features(test_db):
    """Test alert feature engineering"""
    from statistics.feature_engineering import FeatureEngine
    
    engine = FeatureEngine(test_db)
    features = engine.create_alert_features(
        'So11111111111111111111111111111111111111112',
        datetime(2024, 1, 1, 12, 0, 0)
    )
    
    assert 'price_at_alert' in features
    assert 'volume_1h' in features
    assert 'caller_win_rate' in features
```

### 5.2 Integration Tests

**File: `packages/utils/tests/integration/simulation-duckdb-bridge.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import path from 'path';

describe('DuckDB Simulation Bridge', () => {
  it('should run simulation and return valid JSON', async () => {
    const pythonScript = path.resolve(
      __dirname,
      '../../../../tools/telegram/cli/simulate.py'
    );
    
    const { stdout } = await execa('python3', [
      pythonScript,
      '--duckdb', 'test.duckdb',
      '--strategy', 'test_strategy.json',
      '--mint', 'So111...'
    ]);
    
    const result = JSON.parse(stdout);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });
});
```

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Create simulation tables in DuckDB
- [ ] Implement basic simulation SQL functions
- [ ] Create `DuckDBSimulator` class
- [ ] Implement immediate entry strategy
- [ ] Implement profit target detection
- [ ] Basic stop loss logic
- [ ] Unit tests for simulator

### Phase 2: Advanced Simulation (Weeks 3-4)
- [ ] Trailing stop logic
- [ ] Drop-based entry
- [ ] Re-entry logic
- [ ] Fee and slippage calculation
- [ ] Metrics calculation (Sharpe, drawdown, etc.)
- [ ] Batch simulation support
- [ ] Integration tests

### Phase 3: Statistical Analysis (Weeks 5-6)
- [ ] Feature engineering module
- [ ] Technical indicator calculations
- [ ] Statistical analyzer
- [ ] Correlation analysis
- [ ] Feature store implementation
- [ ] Tests for feature engineering

### Phase 4: ML Pipeline (Weeks 7-8)
- [ ] Data preparation module
- [ ] Model training interface
- [ ] Prediction interface
- [ ] Model persistence
- [ ] Sequence data preparation
- [ ] Tests for ML pipeline

### Phase 5: Integration & Polish (Weeks 9-10)
- [ ] CLI scripts
- [ ] TypeScript handler integration
- [ ] Documentation
- [ ] Performance optimization
- [ ] End-to-end tests
- [ ] Example notebooks

---

## Key Design Decisions

1. **DuckDB as Simulation Engine**: Leverage SQL for fast analytical queries and window functions
2. **Python for Data Plane**: Keep heavy computation in Python (numpy, scipy, sklearn)
3. **TypeScript for Orchestration**: Maintain TypeScript for CLI, API boundaries, contracts
4. **Modular Architecture**: Each phase is independently testable and deployable
5. **Bridge Pattern**: Python scripts accept JSON, return JSON - easy integration
6. **Feature Store**: Centralized feature storage for reproducibility
7. **Testing Strategy**: Python tests for correctness, TypeScript tests for integration

---

## Dependencies

### Python Packages
```txt
duckdb>=0.9.0
numpy>=1.24.0
pandas>=2.0.0
scipy>=1.10.0
scikit-learn>=1.3.0
```

### Optional (for advanced ML)
```txt
torch>=2.0.0  # For LSTM/Transformer models
xgboost>=2.0.0  # For gradient boosting
```

---

## Performance Considerations

1. **DuckDB Parallelism**: Use `PRAGMA threads=4` for parallel query execution
2. **Batch Processing**: Process simulations in batches to avoid memory issues
3. **Feature Caching**: Cache computed features to avoid recomputation
4. **Incremental Updates**: Update feature store incrementally as new data arrives
5. **SQL Optimization**: Use appropriate indexes and query optimization

---

## Future Extensions

1. **Real-time Simulation**: Stream new alerts and run simulations in real-time
2. **Strategy Optimization**: Genetic algorithms or Bayesian optimization for strategy parameters
3. **Ensemble Models**: Combine multiple ML models for better predictions
4. **Explainability**: SHAP values, feature importance visualization
5. **A/B Testing**: Compare strategies on historical data
6. **Portfolio Simulation**: Simulate multiple tokens simultaneously with position sizing

