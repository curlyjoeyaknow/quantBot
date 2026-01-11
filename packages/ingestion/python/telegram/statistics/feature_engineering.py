"""
Feature engineering for alerts and calls.
Creates features for ML models and statistical analysis.
"""

import duckdb
import json
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

class FeatureEngine:
    """Engine for creating statistical features from alerts/calls"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
    
    def create_alert_features(
        self,
        mint: str,
        alert_timestamp: datetime,
        caller_name: Optional[str] = None
    ) -> Dict[str, Any]:
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
        if caller_name:
            features.update(self._get_caller_features(caller_name, alert_timestamp))
        
        # Token features
        features.update(self._get_token_features(mint, alert_timestamp))
        
        return features
    
    def create_candle_features(self, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Create features from candle data.
        
        Features:
        - Technical indicators: RSI, MACD, moving averages
        - Volatility: std_dev, bollinger_bands
        - Momentum: price_momentum, volume_momentum
        """
        if not candles or len(candles) < 2:
            return {}
        
        features = {}
        
        # Technical indicators
        features['rsi_14'] = self._calculate_rsi(candles, 14)
        features['rsi_30'] = self._calculate_rsi(candles, 30)
        features['sma_20'] = self._calculate_sma(candles, 20)
        features['sma_50'] = self._calculate_sma(candles, 50)
        features['ema_12'] = self._calculate_ema(candles, 12)
        features['ema_26'] = self._calculate_ema(candles, 26)
        
        # Volatility
        features['volatility_20'] = self._calculate_volatility(candles, 20)
        bb_upper, bb_lower = self._calculate_bollinger_bands(candles, 20)
        features['bollinger_upper'] = bb_upper
        features['bollinger_lower'] = bb_lower
        
        # Momentum
        features['price_momentum_5'] = self._calculate_momentum(candles, 5)
        features['volume_momentum_5'] = self._calculate_volume_momentum(candles, 5)
        
        return features
    
    def create_sequence_features(
        self,
        candles: List[Dict[str, Any]],
        window_size: int = 60
    ) -> List[Dict[str, Any]]:
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
    
    def _get_price_features(
        self,
        mint: str,
        alert_timestamp: datetime
    ) -> Dict[str, float]:
        """Get price-related features"""
        try:
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
                    'price_at_alert': float(result[0]) if result[0] else 0.0,
                    'price_change_pct': float(result[1]) if result[1] else 0.0,
                    'price_change_1h_pct': float(result[2]) if result[2] else 0.0
                }
        except Exception as e:
            logger.warning(f"Failed to get price features: {e}")
        
        return {'price_at_alert': 0.0, 'price_change_pct': 0.0, 'price_change_1h_pct': 0.0}
    
    def _get_volume_features(
        self,
        mint: str,
        alert_timestamp: datetime
    ) -> Dict[str, float]:
        """Get volume-related features"""
        try:
            # Get volume from candles
            start_ts = int((alert_timestamp - timedelta(hours=24)).timestamp())
            end_ts = int(alert_timestamp.timestamp())
            
            result = self.con.execute("""
                SELECT 
                    SUM(volume) as volume_24h,
                    SUM(CASE WHEN timestamp >= ? THEN volume ELSE 0 END) as volume_1h
                FROM ohlcv_candles_d
                WHERE mint = ? AND timestamp >= ? AND timestamp <= ?
            """, [int((alert_timestamp - timedelta(hours=1)).timestamp()), mint, start_ts, end_ts]).fetchone()
            
            if result:
                return {
                    'volume_24h': float(result[0]) if result[0] else 0.0,
                    'volume_1h': float(result[1]) if result[1] else 0.0,
                    'volume_ratio': float(result[1]) / float(result[0]) if result[0] and result[0] > 0 else 0.0
                }
        except Exception as e:
            logger.warning(f"Failed to get volume features: {e}")
        
        return {'volume_24h': 0.0, 'volume_1h': 0.0, 'volume_ratio': 0.0}
    
    def _get_market_features(
        self,
        mint: str,
        alert_timestamp: datetime
    ) -> Dict[str, float]:
        """Get market-related features"""
        try:
            result = self.con.execute("""
                SELECT 
                    mcap_usd,
                    liquidity_usd
                FROM user_calls_d
                WHERE mint = ? AND call_ts_ms = ?
            """, [mint, int(alert_timestamp.timestamp() * 1000)]).fetchone()
            
            if result:
                return {
                    'mcap_at_alert': float(result[0]) if result[0] else 0.0,
                    'liquidity_at_alert': float(result[1]) if result[1] else 0.0
                }
        except Exception as e:
            logger.warning(f"Failed to get market features: {e}")
        
        return {'mcap_at_alert': 0.0, 'liquidity_at_alert': 0.0}
    
    def _get_time_features(self, alert_timestamp: datetime) -> Dict[str, Any]:
        """Get time-related features"""
        return {
            'hour_of_day': alert_timestamp.hour,
            'day_of_week': alert_timestamp.weekday(),
            'day_of_month': alert_timestamp.day,
            'month': alert_timestamp.month
        }
    
    def _get_caller_features(
        self,
        caller_name: str,
        alert_timestamp: datetime
    ) -> Dict[str, float]:
        """Get caller-related features"""
        try:
            result = self.con.execute("""
                WITH caller_stats AS (
                    SELECT 
                        COUNT(*) as total_calls,
                        AVG(CASE WHEN a.ath_multiple > 1.0 THEN 1.0 ELSE 0.0 END) as win_rate,
                        AVG(a.ath_multiple) as avg_multiple
                    FROM user_calls_d u
                    LEFT JOIN alerts a ON u.mint = a.token_id AND u.call_ts_ms = a.alert_timestamp
                    WHERE u.caller_name = ? AND u.call_ts_ms < ?
                )
                SELECT * FROM caller_stats
            """, [caller_name, int(alert_timestamp.timestamp() * 1000)]).fetchone()
            
            if result:
                return {
                    'caller_total_calls': int(result[0]) if result[0] else 0,
                    'caller_win_rate': float(result[1]) if result[1] else 0.0,
                    'caller_avg_multiple': float(result[2]) if result[2] else 0.0
                }
        except Exception as e:
            logger.warning(f"Failed to get caller features: {e}")
        
        return {'caller_total_calls': 0, 'caller_win_rate': 0.0, 'caller_avg_multiple': 0.0}
    
    def _get_token_features(
        self,
        mint: str,
        alert_timestamp: datetime
    ) -> Dict[str, float]:
        """Get token-related features"""
        try:
            result = self.con.execute("""
                SELECT 
                    token_age_s,
                    token_created_ts_ms
                FROM caller_links_d
                WHERE mint = ? AND trigger_ts_ms <= ?
                ORDER BY trigger_ts_ms DESC
                LIMIT 1
            """, [mint, int(alert_timestamp.timestamp() * 1000)]).fetchone()
            
            if result:
                age_seconds = result[0] if result[0] else 0
                age_days = age_seconds / 86400.0 if age_seconds else 0.0
                return {
                    'token_age_days': age_days
                }
        except Exception as e:
            logger.warning(f"Failed to get token features: {e}")
        
        return {'token_age_days': 0.0}
    
    def _calculate_rsi(self, candles: List[Dict[str, Any]], period: int) -> float:
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
    
    def _calculate_sma(self, candles: List[Dict[str, Any]], period: int) -> float:
        """Calculate Simple Moving Average"""
        if len(candles) < period:
            return candles[-1]['close'] if candles else 0.0
        
        prices = [c['close'] for c in candles[-period:]]
        return sum(prices) / len(prices)
    
    def _calculate_ema(self, candles: List[Dict[str, Any]], period: int) -> float:
        """Calculate Exponential Moving Average"""
        if len(candles) < period:
            return candles[-1]['close'] if candles else 0.0
        
        multiplier = 2.0 / (period + 1)
        ema = candles[0]['close']
        
        for i in range(1, len(candles)):
            ema = (candles[i]['close'] - ema) * multiplier + ema
        
        return ema
    
    def _calculate_volatility(self, candles: List[Dict[str, Any]], period: int) -> float:
        """Calculate price volatility (standard deviation)"""
        if len(candles) < period:
            return 0.0
        
        prices = [c['close'] for c in candles[-period:]]
        mean = sum(prices) / len(prices)
        variance = sum((p - mean) ** 2 for p in prices) / len(prices)
        return variance ** 0.5
    
    def _calculate_bollinger_bands(
        self,
        candles: List[Dict[str, Any]],
        period: int,
        num_std: float = 2.0
    ) -> tuple[float, float]:
        """Calculate Bollinger Bands"""
        if len(candles) < period:
            price = candles[-1]['close'] if candles else 0.0
            return price, price
        
        sma = self._calculate_sma(candles, period)
        std = self._calculate_volatility(candles, period)
        
        upper = sma + (num_std * std)
        lower = sma - (num_std * std)
        
        return upper, lower
    
    def _calculate_momentum(self, candles: List[Dict[str, Any]], period: int) -> float:
        """Calculate price momentum"""
        if len(candles) < period + 1:
            return 0.0
        
        current_price = candles[-1]['close']
        past_price = candles[-period-1]['close']
        
        if past_price == 0:
            return 0.0
        
        return ((current_price - past_price) / past_price) * 100
    
    def _calculate_volume_momentum(self, candles: List[Dict[str, Any]], period: int) -> float:
        """Calculate volume momentum"""
        if len(candles) < period + 1:
            return 0.0
        
        current_volume = candles[-1]['volume']
        past_volume = candles[-period-1]['volume']
        
        if past_volume == 0:
            return 0.0
        
        return ((current_volume - past_volume) / past_volume) * 100

