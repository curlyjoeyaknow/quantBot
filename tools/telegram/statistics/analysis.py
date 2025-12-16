"""
Statistical analysis of alerts and calls.
"""

import duckdb
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

try:
    import numpy as np
    from scipy import stats
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    np = None
    stats = None

logger = logging.getLogger(__name__)

class StatisticalAnalyzer:
    """Perform statistical analysis on alert/call data"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        if not HAS_SCIPY:
            logger.warning("scipy not available, some statistical functions will be limited")
    
    def analyze_caller_performance(self, caller_name: str) -> Dict[str, Any]:
        """
        Statistical analysis of caller performance.
        
        Returns:
        - Win rate and confidence intervals
        - Average return distribution
        - Sharpe ratio
        - Maximum drawdown statistics
        """
        try:
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
                return {'error': 'No calls found for caller', 'caller_name': caller_name}
            
            # Extract metrics
            returns = [float(c[4]) for c in calls if c[4] is not None and c[4] > 0]  # ATH multiples
            wins = [r for r in returns if r > 1.0]
            losses = [r for r in returns if r < 1.0]
            
            if not returns:
                return {
                    'caller_name': caller_name,
                    'total_calls': len(calls),
                    'error': 'No return data available'
                }
            
            # Calculate statistics
            win_rate = len(wins) / len(returns) if returns else 0.0
            
            if HAS_SCIPY and len(returns) > 1:
                avg_return = float(np.mean(returns))
                median_return = float(np.median(returns))
                std_return = float(np.std(returns))
                
                # Confidence intervals
                ci_lower, ci_upper = stats.t.interval(
                    0.95, len(returns)-1,
                    loc=avg_return,
                    scale=stats.sem(returns)
                )
                
                # Sharpe ratio (simplified)
                sharpe = (avg_return - 1.0) / std_return if std_return > 0 else 0.0
            else:
                # Fallback without scipy
                avg_return = sum(returns) / len(returns)
                median_return = sorted(returns)[len(returns) // 2]
                std_return = (sum((r - avg_return) ** 2 for r in returns) / len(returns)) ** 0.5
                ci_lower, ci_upper = avg_return, avg_return
                sharpe = (avg_return - 1.0) / std_return if std_return > 0 else 0.0
            
            return {
                'caller_name': caller_name,
                'total_calls': len(calls),
                'win_rate': win_rate,
                'avg_return': float(avg_return),
                'median_return': float(median_return),
                'std_return': float(std_return),
                'sharpe_ratio': float(sharpe),
                'confidence_interval_95': [float(ci_lower), float(ci_upper)],
                'wins': len(wins),
                'losses': len(losses),
                'best_return': float(max(returns)) if returns else 0.0,
                'worst_return': float(min(returns)) if returns else 0.0
            }
        except Exception as e:
            logger.error(f"Failed to analyze caller performance: {e}", exc_info=True)
            return {'error': str(e), 'caller_name': caller_name}
    
    def analyze_token_patterns(self, mint: str) -> Dict[str, Any]:
        """
        Analyze patterns in token price/volume behavior.
        
        Returns:
        - Price volatility patterns
        - Volume patterns
        - Correlation between features and outcomes
        """
        try:
            # Fetch candles
            candles = self.con.execute("""
                SELECT timestamp, open, high, low, close, volume
                FROM ohlcv_candles_d
                WHERE mint = ?
                ORDER BY timestamp
            """, [mint]).fetchall()
            
            if len(candles) < 10:
                return {'error': 'Insufficient data', 'mint': mint}
            
            # Calculate patterns
            prices = [float(c[4]) for c in candles]  # close prices
            volumes = [float(c[5]) for c in candles]
            
            # Volatility patterns
            price_changes = [
                abs(prices[i] - prices[i-1]) / prices[i-1]
                for i in range(1, len(prices))
                if prices[i-1] > 0
            ]
            
            if price_changes:
                volatility = (sum((pc - sum(price_changes)/len(price_changes))**2 for pc in price_changes) / len(price_changes)) ** 0.5
            else:
                volatility = 0.0
            
            # Volume patterns
            if volumes:
                avg_volume = sum(volumes) / len(volumes)
                volume_std = (sum((v - avg_volume)**2 for v in volumes) / len(volumes)) ** 0.5
            else:
                avg_volume = 0.0
                volume_std = 0.0
            
            # Trend analysis
            price_trend = self._calculate_trend(prices)
            volume_trend = self._calculate_trend(volumes)
            
            return {
                'mint': mint,
                'total_candles': len(candles),
                'volatility': float(volatility),
                'avg_volume': float(avg_volume),
                'volume_std': float(volume_std),
                'price_trend': price_trend,
                'volume_trend': volume_trend
            }
        except Exception as e:
            logger.error(f"Failed to analyze token patterns: {e}", exc_info=True)
            return {'error': str(e), 'mint': mint}
    
    def correlation_analysis(
        self,
        feature_cols: List[str],
        target_col: str
    ) -> Dict[str, Dict[str, float]]:
        """
        Calculate correlation between features and target.
        
        Args:
            feature_cols: List of feature column names
            target_col: Target column name (e.g., 'ath_multiple')
        
        Returns:
            Dict mapping feature names to correlation coefficients
        """
        try:
            # Build SQL query - this is a simplified version
            # In practice, you'd need a view with features already computed
            query = f"""
                SELECT {', '.join(feature_cols)}, {target_col}
                FROM v_alerts_with_features
                WHERE {target_col} IS NOT NULL
                LIMIT 1000
            """
            
            data = self.con.execute(query).fetchall()
            
            if len(data) < 2:
                return {}
            
            # Calculate correlations
            correlations = {}
            target_values = [float(row[-1]) for row in data]
            
            for i, col in enumerate(feature_cols):
                try:
                    feature_values = [float(row[i]) for row in data]
                    
                    if HAS_SCIPY:
                        corr, p_value = stats.pearsonr(feature_values, target_values)
                        correlations[col] = {
                            'correlation': float(corr),
                            'p_value': float(p_value),
                            'significant': p_value < 0.05
                        }
                    else:
                        # Simple correlation without scipy
                        corr = self._simple_correlation(feature_values, target_values)
                        correlations[col] = {
                            'correlation': float(corr),
                            'p_value': 0.0,
                            'significant': False
                        }
                except Exception as e:
                    logger.warning(f"Failed to calculate correlation for {col}: {e}")
                    correlations[col] = {
                        'correlation': 0.0,
                        'p_value': 1.0,
                        'significant': False
                    }
            
            return correlations
        except Exception as e:
            logger.error(f"Failed correlation analysis: {e}", exc_info=True)
            return {}
    
    def _calculate_trend(self, values: List[float]) -> str:
        """Calculate trend direction"""
        if len(values) < 2:
            return 'unknown'
        
        first_half = sum(values[:len(values)//2]) / (len(values)//2)
        second_half = sum(values[len(values)//2:]) / (len(values) - len(values)//2)
        
        if second_half > first_half * 1.1:
            return 'upward'
        elif second_half < first_half * 0.9:
            return 'downward'
        else:
            return 'stable'
    
    def _simple_correlation(self, x: List[float], y: List[float]) -> float:
        """Calculate simple correlation coefficient"""
        if len(x) != len(y) or len(x) < 2:
            return 0.0
        
        n = len(x)
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(x[i] * y[i] for i in range(n))
        sum_x2 = sum(xi * xi for xi in x)
        sum_y2 = sum(yi * yi for yi in y)
        
        numerator = n * sum_xy - sum_x * sum_y
        denominator = ((n * sum_x2 - sum_x * sum_x) * (n * sum_y2 - sum_y * sum_y)) ** 0.5
        
        if denominator == 0:
            return 0.0
        
        return numerator / denominator

