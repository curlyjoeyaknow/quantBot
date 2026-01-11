#!/usr/bin/env python3
"""
Jesse Export/Import with Warmup Buffer and Tripwire Test

Exports candles from ClickHouse with explicit warmup buffer for indicator initialization.
Imports to Jesse via research.store_candles() with proper timestamp convention handling.

CRITICAL TIMESTAMP CONVENTION:
- ClickHouse timestamp = OPEN time of the bar (when the bar period starts)
- Jesse expects timestamp = OPEN time (standard convention)
- This prevents look-ahead bias: a bar at timestamp T contains data from [T, T+interval)

Warmup Strategy:
- Export [start - warmup, finish] for each timeframe
- Warmup length = max(indicator_lookback) + safety_pad
- Warmup candles are invisible to trading decisions (only for indicator init)

Tripwire Test:
- Scramble candles after time T
- Re-run backtest
- Assert decisions before T don't change
- Catches any look-ahead leakage
"""

import sys
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from clickhouse_driver import Client as ClickHouseClient
import os

# Jesse imports (assumes Jesse is installed)
try:
    from jesse import research
except ImportError:
    print("ERROR: Jesse not installed. Install with: pip install jesse")
    sys.exit(1)


class JesseExporter:
    """
    Export ClickHouse OHLCV to Jesse format with warmup buffer.
    
    Timestamp Convention:
    - ClickHouse: timestamp = OPEN time (bar period start)
    - Jesse: timestamp = OPEN time (bar period start)
    - Convention: timestamp T represents bar [T, T+interval)
    """
    
    def __init__(
        self,
        clickhouse_host: str = None,
        clickhouse_port: int = 9000,
        clickhouse_database: str = "quantbot",
        warmup_safety_pad: int = 50  # Extra candles beyond max indicator lookback
    ):
        self.ch_client = ClickHouseClient(
            host=clickhouse_host or os.getenv("CLICKHOUSE_HOST", "localhost"),
            port=clickhouse_port,
            database=clickhouse_database,
            user=os.getenv("CLICKHOUSE_USER", "default"),
            password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        )
        self.database = clickhouse_database
        self.warmup_safety_pad = warmup_safety_pad
    
    def calculate_warmup_candles(
        self,
        interval: str,
        max_indicator_lookback: int = 200  # e.g., Ichimoku = 52 periods, RSI = 14, etc.
    ) -> int:
        """
        Calculate warmup buffer size.
        
        Args:
            interval: Candle interval ('1m', '5m', '15m', '1h')
            max_indicator_lookback: Maximum lookback period across all indicators
        
        Returns:
            Number of warmup candles needed
        """
        return max_indicator_lookback + self.warmup_safety_pad
    
    def interval_to_seconds(self, interval: str) -> int:
        """Convert interval string to seconds."""
        interval_map = {
            '1s': 1,
            '15s': 15,
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1h': 3600,
            '1H': 3600,
        }
        return interval_map.get(interval, 300)  # Default to 5m
    
    def export_candles(
        self,
        token_address: str,
        chain: str,
        interval: str,
        start_time: datetime,
        end_time: datetime,
        max_indicator_lookback: int = 200
    ) -> List[Dict[str, Any]]:
        """
        Export candles from ClickHouse with warmup buffer.
        
        Exports [start - warmup, end] to ensure indicators can initialize.
        
        Args:
            token_address: Token mint address
            chain: Blockchain name (solana, ethereum, etc.)
            interval: Candle interval ('1m', '5m', etc.)
            start_time: Backtest start time (warmup excluded from trading)
            end_time: Backtest end time
            max_indicator_lookback: Maximum indicator lookback period
        
        Returns:
            List of candles in Jesse format:
            [
                {
                    "timestamp": 1234567890,  # Unix timestamp (seconds)
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.05,
                    "volume": 1000.0
                },
                ...
            ]
        """
        # Calculate warmup period
        warmup_candles = self.calculate_warmup_candles(interval, max_indicator_lookback)
        interval_seconds = self.interval_to_seconds(interval)
        warmup_seconds = warmup_candles * interval_seconds
        
        # Export range: [start - warmup, end]
        export_start = start_time - timedelta(seconds=warmup_seconds)
        
        query = f"""
        SELECT
            toUnixTimestamp(timestamp) as timestamp,
            open,
            high,
            low,
            close,
            volume
        FROM {self.database}.ohlcv_candles
        WHERE token_address = %(token_address)s
          AND chain = %(chain)s
          AND interval = %(interval)s
          AND timestamp >= %(start_time)s
          AND timestamp <= %(end_time)s
        ORDER BY timestamp ASC
        """
        
        params = {
            'token_address': token_address,
            'chain': chain,
            'interval': interval,
            'start_time': export_start,
            'end_time': end_time,
        }
        
        rows = self.ch_client.execute(query, params)
        
        candles = []
        for row in rows:
            candles.append({
                'timestamp': int(row[0]),  # Unix timestamp (seconds)
                'open': float(row[1]),
                'high': float(row[2]),
                'low': float(row[3]),
                'close': float(row[4]),
                'volume': float(row[5]),
            })
        
        # Validate timestamp convention
        # Timestamp T should represent bar [T, T+interval)
        # First candle timestamp should be >= export_start
        if candles:
            first_ts = datetime.fromtimestamp(candles[0]['timestamp'])
            if first_ts < export_start:
                print(f"WARNING: First candle timestamp {first_ts} is before export_start {export_start}")
        
        return candles
    
    def import_to_jesse(
        self,
        exchange: str,
        symbol: str,
        candles: List[Dict[str, Any]],
        start_time: datetime,
        end_time: datetime
    ) -> None:
        """
        Import candles to Jesse via research.store_candles().
        
        Args:
            exchange: Exchange name (e.g., 'Binance', 'FTX')
            symbol: Trading pair (e.g., 'BTC-USDT')
            candles: List of candles in Jesse format
            start_time: Backtest start (warmup candles before this are excluded from trading)
            end_time: Backtest end
        """
        if not candles:
            raise ValueError("No candles to import")
        
        # Convert to Jesse format (list of lists)
        # Format: [[timestamp, open, close, high, low, volume], ...]
        jesse_candles = []
        for candle in candles:
            jesse_candles.append([
                candle['timestamp'] * 1000,  # Jesse expects milliseconds
                candle['open'],
                candle['close'],
                candle['high'],
                candle['low'],
                candle['volume'],
            ])
        
        # Store in Jesse
        research.store_candles(exchange, symbol, jesse_candles)
        
        print(f"✅ Imported {len(jesse_candles)} candles to Jesse")
        print(f"   Exchange: {exchange}, Symbol: {symbol}")
        print(f"   Time range: {datetime.fromtimestamp(candles[0]['timestamp'])} to {datetime.fromtimestamp(candles[-1]['timestamp'])}")
        print(f"   Trading range: {start_time} to {end_time}")
        
        # Calculate warmup count
        start_ts = int(start_time.timestamp())
        warmup_count = sum(1 for c in candles if c['timestamp'] < start_ts)
        print(f"   Warmup candles: {warmup_count} (invisible to trading)")
    
    def run_tripwire_test(
        self,
        exchange: str,
        symbol: str,
        candles: List[Dict[str, Any]],
        tripwire_time: datetime,
        strategy_func
    ) -> bool:
        """
        Tripwire test: Scramble candles after T, re-run, assert decisions before T unchanged.
        
        This is the "no bullshit" check that catches look-ahead leakage.
        
        Args:
            exchange: Exchange name
            symbol: Trading pair
            candles: Original candles
            tripwire_time: Time T to scramble after
            strategy_func: Function that runs backtest and returns decisions
        
        Returns:
            True if test passes (no leakage), False if leakage detected
        """
        print(f"\n🔍 Running tripwire test (scramble after {tripwire_time})...")
        
        # Run original backtest
        research.store_candles(exchange, symbol, self._candles_to_jesse_format(candles))
        original_decisions = strategy_func()
        
        # Scramble candles after tripwire_time
        tripwire_ts = int(tripwire_time.timestamp())
        scrambled_candles = candles.copy()
        
        for i, candle in enumerate(scrambled_candles):
            if candle['timestamp'] >= tripwire_ts:
                # Scramble: swap high/low, invert close
                scrambled_candles[i] = {
                    **candle,
                    'high': candle['low'],
                    'low': candle['high'],
                    'close': candle['open'] * 0.5,  # Drastically different
                }
        
        # Re-run with scrambled data
        research.store_candles(exchange, symbol, self._candles_to_jesse_format(scrambled_candles))
        scrambled_decisions = strategy_func()
        
        # Compare decisions before tripwire_time
        tripwire_ts_ms = tripwire_ts * 1000
        original_before = [d for d in original_decisions if d.get('timestamp', 0) < tripwire_ts_ms]
        scrambled_before = [d for d in scrambled_decisions if d.get('timestamp', 0) < tripwire_ts_ms]
        
        # Assert decisions are identical
        if original_before == scrambled_before:
            print("✅ Tripwire test PASSED: No look-ahead leakage detected")
            return True
        else:
            print("❌ Tripwire test FAILED: Look-ahead leakage detected!")
            print(f"   Original decisions before T: {len(original_before)}")
            print(f"   Scrambled decisions before T: {len(scrambled_before)}")
            print(f"   Differences: {len(original_before) - len(scrambled_before)}")
            return False
    
    def _candles_to_jesse_format(self, candles: List[Dict[str, Any]]) -> List[List]:
        """Convert candles to Jesse format (list of lists)."""
        return [
            [
                c['timestamp'] * 1000,  # Milliseconds
                c['open'],
                c['close'],
                c['high'],
                c['low'],
                c['volume'],
            ]
            for c in candles
        ]


def main():
    """Example usage."""
    exporter = JesseExporter()
    
    # Export with warmup
    candles = exporter.export_candles(
        token_address="So11111111111111111111111111111111111111112",  # SOL
        chain="solana",
        interval="5m",
        start_time=datetime(2024, 1, 1, 0, 0, 0),
        end_time=datetime(2024, 1, 31, 23, 59, 59),
        max_indicator_lookback=200,  # Ichimoku + RSI + others
    )
    
    # Import to Jesse
    exporter.import_to_jesse(
        exchange="Binance",
        symbol="SOL-USDT",
        candles=candles,
        start_time=datetime(2024, 1, 1, 0, 0, 0),
        end_time=datetime(2024, 1, 31, 23, 59, 59),
    )
    
    print("\n✅ Export/import complete. Ready for Jesse backtest.")


if __name__ == "__main__":
    main()

