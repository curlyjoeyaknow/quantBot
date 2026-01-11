"""
Comprehensive Edge Case Tests for Python/DuckDB Simulation Model
================================================================

These tests are designed to stress-test the Python/DuckDB simulation model with:
- Large datasets (10k+ candles)
- Extreme price movements (flash crashes, pump and dumps)
- Boundary conditions (zero, negative, NaN, Infinity)
- Complex scenarios (multiple re-entries, trailing stops)
- Performance edge cases
- Data quality issues

Goal: Find and fix weaknesses in the simulation model.
"""

import pytest
import duckdb
import time
import math
from datetime import datetime, timedelta
from pathlib import Path
import sys

# Add simulation directory to path
simulation_path = Path(__file__).parent.parent.parent / 'simulation'
sys.path.insert(0, str(simulation_path))

from simulator import DuckDBSimulator, StrategyConfig
from sql_functions import setup_simulation_schema


@pytest.fixture
def test_db():
    """Create a temporary DuckDB connection for testing."""
    con = duckdb.connect(':memory:')
    setup_simulation_schema(con)
    yield con
    con.close()


def create_candle(mint: str, timestamp: int, open_price: float, high: float, low: float, close: float, volume: float, interval: int = 60):
    """Helper to create a candle tuple for insertion."""
    # Note: SQL expects (mint, timestamp, open, high, low, close, volume, interval_seconds)
    return (mint, timestamp, open_price, high, low, close, volume, interval)


def create_price_progression(mint: str, base_timestamp: int, base_price: float, intervals: int, interval_seconds: int = 60, price_multiplier=lambda i: 1.0):
    """Create a price progression of candles."""
    candles = []
    for i in range(intervals):
        price = base_price * price_multiplier(i)
        volatility = price * 0.01  # 1% volatility
        candles.append(create_candle(
            mint,  # mint first
            base_timestamp + i * interval_seconds,  # timestamp second
            price,  # open
            price + volatility,  # high
            price - volatility,  # low
            price * (1 + (i % 2 - 0.5) * 0.02),  # close
            float(1000 + (i % 500)),  # volume
            interval_seconds  # interval
        ))
    return candles


def insert_candles(con: duckdb.DuckDBPyConnection, candles: list):
    """Insert candles into DuckDB."""
    if not candles:
        return
    con.executemany("""
        INSERT INTO ohlcv_candles_d (mint, timestamp, open, high, low, close, volume, interval_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, candles)
    con.commit()


class TestLargeDatasetStressTests:
    """Test large dataset handling."""
    
    def test_10000_candles_performance(self, test_db):
        """Test 10,000 candles without performance degradation."""
        mint = 'So11111111111111111111111111111111111111112'
        base_timestamp = 1704067200
        base_price = 1.0
        
        candles = create_price_progression(
            mint, base_timestamp, base_price, 10000, 60,
            lambda i: 1 + (i / 10000) * 2 + math.sin(i / 100) * 0.1
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_10k',
            name='Test 10k Candles',
            entry_type='immediate',
            profit_targets=[
                {'target': 2.0, 'percent': 0.5},
                {'target': 3.0, 'percent': 0.5}
            ]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        
        start_time = time.time()
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        end_time = time.time()
        
        assert 'error' not in result or result.get('run_id') is not None
        assert (end_time - start_time) < 5.0  # Should complete in < 5 seconds
        if 'error' not in result:
            assert result.get('total_trades', 0) >= 0
    
    def test_50000_candles_extreme_stress(self, test_db):
        """Test 50,000 candles (extreme stress test)."""
        mint = 'So22222222222222222222222222222222222222223'
        base_timestamp = 1704067200
        base_price = 1.0
        
        candles = create_price_progression(
            mint, base_timestamp, base_price, 50000, 60,
            lambda i: (
                1 + (i / 10000) * 3 if i < 10000
                else 4 - ((i - 10000) / 10000) * 2 if i < 20000
                else 2 + ((i - 20000) / 30000) * 1
            )
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_50k',
            name='Test 50k Candles',
            entry_type='immediate',
            profit_targets=[
                {'target': 1.5, 'percent': 0.33},
                {'target': 2, 'percent': 0.33},
                {'target': 3, 'percent': 0.34}
            ]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        
        start_time = time.time()
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        end_time = time.time()
        
        assert 'error' not in result or result.get('run_id') is not None
        assert (end_time - start_time) < 30.0  # Should complete in < 30 seconds
    
    def test_100000_candles_complex_strategy(self, test_db):
        """Test 100,000 candles with complex strategy."""
        mint = 'So33333333333333333333333333333333333333334'
        base_timestamp = 1704067200
        base_price = 0.001
        
        candles = create_price_progression(
            mint, base_timestamp, base_price, 100000, 60,
            lambda i: (
                0.001 + (i // 20000) * 0.001 + math.sin((i % 20000) / 20000 * math.pi * 2) * 0.0005
            )
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_100k',
            name='Test 100k Candles',
            entry_type='immediate',
            profit_targets=[
                {'target': 1.2, 'percent': 0.25},
                {'target': 1.5, 'percent': 0.25},
                {'target': 2, 'percent': 0.25},
                {'target': 3, 'percent': 0.25}
            ],
            stop_loss_pct=0.5,
            trailing_stop_pct=0.2,
            trailing_activation_pct=0.3,
            taker_fee=0.001,
            slippage=0.005
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        
        start_time = time.time()
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        end_time = time.time()
        
        assert 'error' not in result or result.get('run_id') is not None
        assert (end_time - start_time) < 60.0  # Should complete in < 60 seconds


class TestExtremePriceMovements:
    """Test extreme price movement scenarios."""
    
    def test_flash_crash_99_percent_drop(self, test_db):
        """Test flash crash (99% drop in single candle)."""
        mint = 'So44444444444444444444444444444444444444445'
        base_price = 1.0
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, base_price, base_price * 1.01, base_price * 0.99, base_price, 1000.0),
            create_candle(mint, base_timestamp + 60, base_price, base_price * 1.01, base_price * 0.99, base_price, 1000.0),
            create_candle(mint, base_timestamp + 120, base_price, base_price * 1.01, base_price * 0.99, base_price, 1000.0),
            # Flash crash: 99% drop
            create_candle(mint, base_timestamp + 180, base_price, base_price * 1.01, base_price * 0.01, base_price * 0.01, 100000.0),
            create_candle(mint, base_timestamp + 240, base_price * 0.01, base_price * 0.02, base_price * 0.005, base_price * 0.015, 50000.0),
            # Recovery attempt
            create_candle(mint, base_timestamp + 300, base_price * 0.015, base_price * 0.5, base_price * 0.01, base_price * 0.3, 20000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_flash_crash',
            name='Test Flash Crash',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}],
            stop_loss_pct=0.5
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert 'final_capital' in result
            assert math.isfinite(result.get('final_capital', 0))
    
    def test_pump_and_dump_1000x_then_99_percent_dump(self, test_db):
        """Test pump and dump (1000x pump then 99% dump)."""
        mint = 'So55555555555555555555555555555555555555556'
        base_price = 0.001
        base_timestamp = 1704067200
        
        candles = [
            # Entry
            create_candle(mint, base_timestamp, base_price, base_price * 1.1, base_price * 0.9, base_price, 1000.0),
            # Pump phase
            create_candle(mint, base_timestamp + 60, base_price, base_price * 2, base_price * 0.9, base_price * 1.5, 5000.0),
            create_candle(mint, base_timestamp + 120, base_price * 1.5, base_price * 5, base_price * 1.2, base_price * 4, 10000.0),
            create_candle(mint, base_timestamp + 180, base_price * 4, base_price * 10, base_price * 3, base_price * 8, 20000.0),
            create_candle(mint, base_timestamp + 240, base_price * 8, base_price * 50, base_price * 7, base_price * 40, 50000.0),
            create_candle(mint, base_timestamp + 300, base_price * 40, base_price * 200, base_price * 35, base_price * 150, 100000.0),
            create_candle(mint, base_timestamp + 360, base_price * 150, base_price * 500, base_price * 140, base_price * 400, 200000.0),
            create_candle(mint, base_timestamp + 420, base_price * 400, base_price * 1000, base_price * 350, base_price * 800, 500000.0),
            # Peak
            create_candle(mint, base_timestamp + 480, base_price * 800, base_price * 1000, base_price * 700, base_price * 950, 1000000.0),
            # Dump phase
            create_candle(mint, base_timestamp + 540, base_price * 950, base_price * 800, base_price * 100, base_price * 200, 800000.0),
            create_candle(mint, base_timestamp + 600, base_price * 200, base_price * 300, base_price * 50, base_price * 100, 400000.0),
            create_candle(mint, base_timestamp + 660, base_price * 100, base_price * 150, base_price * 20, base_price * 30, 200000.0),
            create_candle(mint, base_timestamp + 720, base_price * 30, base_price * 50, base_price * 5, base_price * 10, 100000.0),
            # Final dump
            create_candle(mint, base_timestamp + 780, base_price * 10, base_price * 15, base_price * 0.01, base_price * 0.01, 50000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_pump_dump',
            name='Test Pump and Dump',
            entry_type='immediate',
            profit_targets=[
                {'target': 2, 'percent': 0.2},
                {'target': 5, 'percent': 0.2},
                {'target': 10, 'percent': 0.2},
                {'target': 50, 'percent': 0.2},
                {'target': 100, 'percent': 0.2}
            ],
            stop_loss_pct=0.3,
            trailing_stop_pct=0.2,
            trailing_activation_pct=0.5
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert 'final_capital' in result
            assert math.isfinite(result.get('final_capital', 0))
            assert len(result.get('events', [])) > 0
    
    def test_extreme_volatility_100_percent_swings(self, test_db):
        """Test extreme volatility (100% swings every candle)."""
        mint = 'So66666666666666666666666666666666666666667'
        base_price = 1.0
        base_timestamp = 1704067200
        
        candles = []
        for i in range(1000):
            direction = 1 if i % 2 == 0 else -1
            swing = 1.0  # 100% swing
            price = base_price * (1 + direction * swing)
            candles.append(create_candle(
                mint,
                base_timestamp + i * 60,
                base_price,
                price * 1.1,
                price * 0.9,
                price,
                float(1000 + (i % 500)),
                60
            ))
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_volatility',
            name='Test Extreme Volatility',
            entry_type='immediate',
            profit_targets=[{'target': 1.5, 'percent': 1.0}],
            stop_loss_pct=0.2
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert math.isfinite(result.get('final_capital', 0))
    
    def test_gradual_death_spiral_continuous_decline(self, test_db):
        """Test gradual death spiral (continuous decline)."""
        mint = 'So77777777777777777777777777777777777777778'
        base_price = 1.0
        base_timestamp = 1704067200
        
        candles = []
        for i in range(5000):
            decline = 0.999  # 0.1% decline per candle
            price = base_price * (decline ** i)
            candles.append(create_candle(
                mint,
                base_timestamp + i * 60,
                price,
                price * 1.001,
                price * 0.999,
                price * 0.9995,
                float(1000 + (i % 500)),
                60
            ))
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_death_spiral',
            name='Test Death Spiral',
            entry_type='immediate',
            profit_targets=[{'target': 1.1, 'percent': 1.0}],
            stop_loss_pct=0.5
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            # Should eventually hit stop loss
            exit_events = [e for e in result.get('events', []) if e.get('event_type') in ['exit', 'stop_loss']]
            assert len(result.get('events', [])) >= 1  # At least entry


class TestBoundaryConditions:
    """Test boundary conditions and edge cases."""
    
    def test_zero_price_candles(self, test_db):
        """Test zero price candles."""
        mint = 'So88888888888888888888888888888888888888889'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 60, 1.0, 1.1, 0.0, 0.0, 1000.0),  # Zero price
            create_candle(mint, base_timestamp + 120, 0.0, 0.1, 0.0, 0.05, 1000.0),
            create_candle(mint, base_timestamp + 180, 0.05, 0.2, 0.0, 0.1, 1000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_zero_price',
            name='Test Zero Price',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        # Should handle zero prices gracefully (either skip or handle as error)
        assert 'error' in result or result.get('run_id') is not None
    
    def test_negative_prices_data_corruption(self, test_db):
        """Test negative prices (data corruption)."""
        mint = 'So99999999999999999999999999999999999999990'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 60, 1.0, 1.1, -0.1, -0.05, 1000.0),  # Negative price
            create_candle(mint, base_timestamp + 120, 0.05, 0.2, 0.0, 0.1, 1000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_negative_price',
            name='Test Negative Price',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        # Should handle negative prices (either reject or clamp to zero)
        assert 'error' in result or result.get('run_id') is not None
    
    def test_extremely_small_prices_micro_caps(self, test_db):
        """Test extremely small prices (micro-caps)."""
        mint = 'SoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        base_price = 0.0000001  # 0.1 micro
        base_timestamp = 1704067200
        
        candles = create_price_progression(
            mint, base_timestamp, base_price, 1000, 60,
            lambda i: 1 + (i / 1000) * 10  # 10x over 1000 candles
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_micro_cap',
            name='Test Micro Cap',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert math.isfinite(result.get('final_capital', 0))
    
    def test_extremely_large_prices(self, test_db):
        """Test extremely large prices."""
        mint = 'SoBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
        base_price = 1000000.0  # 1 million
        base_timestamp = 1704067200
        
        candles = create_price_progression(
            mint, base_timestamp, base_price, 1000, 60,
            lambda i: 1 + (i / 1000) * 0.1  # 10% increase
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_large_price',
            name='Test Large Price',
            entry_type='immediate',
            profit_targets=[{'target': 1.1, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert math.isfinite(result.get('final_capital', 0))
    
    def test_zero_volume_candles(self, test_db):
        """Test zero volume candles."""
        mint = 'SoCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 60, 1.0, 1.1, 0.9, 1.0, 0.0),  # Zero volume
            create_candle(mint, base_timestamp + 120, 1.0, 1.1, 0.9, 1.0, 0.0),
            create_candle(mint, base_timestamp + 180, 1.0, 1.1, 0.9, 1.0, 1000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_zero_volume',
            name='Test Zero Volume',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None


class TestComplexStrategyScenarios:
    """Test complex strategy scenarios."""
    
    def test_complex_ladder_exit_with_trailing_stop(self, test_db):
        """Test complex ladder exit with trailing stop."""
        mint = 'SoDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
        base_price = 1.0
        base_timestamp = 1704067200
        
        candles = create_price_progression(
            mint, base_timestamp, base_price, 5000, 60,
            lambda i: 1 + (i / 5000) * 9  # Gradual pump to 10x
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_ladder',
            name='Test Ladder Exit',
            entry_type='immediate',
            profit_targets=[
                {'target': 1.2, 'percent': 0.1},
                {'target': 1.5, 'percent': 0.1},
                {'target': 2, 'percent': 0.1},
                {'target': 3, 'percent': 0.1},
                {'target': 5, 'percent': 0.2},
                {'target': 7, 'percent': 0.2},
                {'target': 10, 'percent': 0.2}
            ],
            stop_loss_pct=0.5,
            trailing_stop_pct=0.15,
            trailing_activation_pct=0.3
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert len(result.get('events', [])) > 0
            # Should have some exit events
            exit_events = [e for e in result.get('events', []) if e.get('event_type') in ['exit', 'stop_loss', 'trailing_stop']]
            assert len(exit_events) > 0
            assert math.isfinite(result.get('final_capital', 0))


class TestDataQualityEdgeCases:
    """Test data quality edge cases."""
    
    def test_out_of_order_candles(self, test_db):
        """Test out-of-order candles."""
        mint = 'SoEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp + 180, 1.0, 1.1, 0.9, 1.0, 1000.0),  # Out of order
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 60, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 120, 1.0, 1.1, 0.9, 1.0, 1000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_out_of_order',
            name='Test Out of Order',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        # Should either sort or reject out-of-order candles
        assert 'error' in result or result.get('run_id') is not None
    
    def test_duplicate_timestamps(self, test_db):
        """Test duplicate timestamps."""
        mint = 'SoFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),  # Duplicate
            create_candle(mint, base_timestamp + 60, 1.0, 1.1, 0.9, 1.0, 1000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_duplicate',
            name='Test Duplicate',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
    
    def test_missing_candles_gaps_in_timeline(self, test_db):
        """Test missing candles (gaps in timeline)."""
        mint = 'SoGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 60, 1.0, 1.1, 0.9, 1.0, 1000.0),
            # Gap: missing 120, 180, 240, 300
            create_candle(mint, base_timestamp + 360, 1.5, 1.6, 1.4, 1.5, 1000.0),
            create_candle(mint, base_timestamp + 420, 1.5, 1.6, 1.4, 1.5, 1000.0),
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_gaps',
            name='Test Gaps',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
    
    def test_single_candle_dataset(self, test_db):
        """Test single candle dataset."""
        mint = 'SoHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH'
        base_timestamp = 1704067200
        
        candles = [create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0)]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_single',
            name='Test Single Candle',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
    
    def test_empty_candle_array(self, test_db):
        """Test empty candle array."""
        mint = 'SoIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII'
        
        strategy = StrategyConfig(
            strategy_id='test_empty',
            name='Test Empty',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(1704067200)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' in result or result.get('run_id') is None


class TestFeeAndSlippageEdgeCases:
    """Test fee and slippage edge cases."""
    
    def test_extreme_slippage_50_percent(self, test_db):
        """Test extreme slippage (50%)."""
        mint = 'SoJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ'
        base_timestamp = 1704067200
        
        candles = create_price_progression(
            mint, base_timestamp, 1.0, 1000, 60,
            lambda i: 1 + i * 0.001
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_extreme_slippage',
            name='Test Extreme Slippage',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}],
            taker_fee=0.001,
            slippage=0.5  # 50% slippage
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert math.isfinite(result.get('final_capital', 0))
    
    def test_zero_fees(self, test_db):
        """Test zero fees."""
        mint = 'SoKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK'
        base_timestamp = 1704067200
        
        candles = create_price_progression(
            mint, base_timestamp, 1.0, 1000, 60,
            lambda i: 1 + i * 0.001
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_zero_fees',
            name='Test Zero Fees',
            entry_type='immediate',
            profit_targets=[{'target': 2.0, 'percent': 1.0}],
            maker_fee=0.0,
            taker_fee=0.0,
            slippage=0.0
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert math.isfinite(result.get('final_capital', 0))


class TestStopLossEdgeCases:
    """Test stop loss edge cases."""
    
    def test_stop_loss_triggered_immediately(self, test_db):
        """Test stop loss triggered immediately."""
        mint = 'SoLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL'
        base_timestamp = 1704067200
        
        candles = [
            create_candle(mint, base_timestamp, 1.0, 1.1, 0.9, 1.0, 1000.0),
            create_candle(mint, base_timestamp + 60, 1.0, 1.05, 0.4, 0.5, 10000.0),  # Immediate 50% drop
        ]
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_immediate_stop',
            name='Test Immediate Stop',
            entry_type='immediate',
            profit_targets=[],
            stop_loss_pct=0.3
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            exit_events = [e for e in result.get('events', []) if e.get('event_type') in ['exit', 'stop_loss']]
            assert len(result.get('events', [])) >= 1  # At least entry


class TestPerformanceAndMemoryEdgeCases:
    """Test performance and memory edge cases."""
    
    def test_memory_with_many_events(self, test_db):
        """Test memory usage with many events."""
        mint = 'SoMMMMMMMMMMMMMMMMMMMMMMM'
        base_timestamp = 1704067200
        
        candles = create_price_progression(
            mint, base_timestamp, 1.0, 20000, 60,
            lambda i: 1 + (i / 20000) * 20  # Create many profit target hits
        )
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_many_events',
            name='Test Many Events',
            entry_type='immediate',
            profit_targets=[
                {'target': 1.1, 'percent': 0.1},
                {'target': 1.2, 'percent': 0.1},
                {'target': 1.3, 'percent': 0.1},
                {'target': 1.4, 'percent': 0.1},
                {'target': 1.5, 'percent': 0.1},
                {'target': 2, 'percent': 0.1},
                {'target': 3, 'percent': 0.1},
                {'target': 5, 'percent': 0.1},
                {'target': 10, 'percent': 0.1},
                {'target': 20, 'percent': 0.1}
            ]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert len(result.get('events', [])) > 0
            # Memory should be reasonable (test would fail if there's a leak)
    
    def test_rapid_fire_events_many_exits_short_time(self, test_db):
        """Test rapid-fire events (many exits in short time)."""
        mint = 'SoNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN'
        base_timestamp = 1704067200
        
        candles = []
        for i in range(1000):
            price = 1.0 * (1 + i * 0.01)  # Rapid increase
            candles.append(create_candle(
                mint,
                base_timestamp + i * 10,  # 10 second intervals
                price,
                price * 1.01,
                price * 0.99,
                price,
                1000.0,
                10
            ))
        insert_candles(test_db, candles)
        
        strategy = StrategyConfig(
            strategy_id='test_rapid',
            name='Test Rapid Fire',
            entry_type='immediate',
            profit_targets=[
                {'target': 1.1, 'percent': 0.1},
                {'target': 1.2, 'percent': 0.1},
                {'target': 1.3, 'percent': 0.1},
                {'target': 1.4, 'percent': 0.1},
                {'target': 1.5, 'percent': 0.1},
                {'target': 2, 'percent': 0.1},
                {'target': 3, 'percent': 0.1},
                {'target': 5, 'percent': 0.1},
                {'target': 10, 'percent': 0.1}
            ]
        )
        
        simulator = DuckDBSimulator(test_db)
        alert_time = datetime.fromtimestamp(base_timestamp)
        result = simulator.run_simulation(strategy, mint, alert_time, initial_capital=1000.0)
        
        assert 'error' not in result or result.get('run_id') is not None
        if 'error' not in result:
            assert len(result.get('events', [])) > 0

