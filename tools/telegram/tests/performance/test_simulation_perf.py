"""
Performance Benchmarks for Python Simulation

Ensures simulations meet performance thresholds.
"""

import pytest
import time
import duckdb
import random
from simulation.contracts import SimInput, EntryConfig, ExitConfig, Candle
from simulation.simulator import DuckDBSimulator


def generate_candles(count: int):
    """Generate test candles"""
    candles = []
    price = 1.0
    for i in range(count):
        price += (random.random() - 0.5) * 0.1
        candles.append(Candle(
            timestamp=1704110400 + i * 60,
            open=price,
            high=price * 1.05,
            low=price * 0.95,
            close=price,
            volume=1000 + random.random() * 500,
        ))
    return candles


@pytest.mark.performance
def test_performance_100_candles():
    """Test performance with 100 candles"""
    con = duckdb.connect(':memory:')
    simulator = DuckDBSimulator(con)
    
    input_data = SimInput(
        run_id='perf_test_001',
        strategy_id='PT2_SL25',
        mint='So11111111111111111111111111111111111111112',
        alert_timestamp='2024-01-01T12:00:00Z',
        candles=generate_candles(100),
        entry_config=EntryConfig(
            initialEntry='none',
            trailingEntry='none',
            maxWaitTime=60.0,
        ),
        exit_config=ExitConfig(
            profit_targets=[{'target': 2.0, 'percent': 1.0}],
            stop_loss={'initial': -0.25},
        )
    )
    
    start = time.time()
    simulator.run_from_contract(input_data)
    duration = (time.time() - start) * 1000  # Convert to ms
    
    assert duration < 200  # 200ms threshold for Python
    con.close()


@pytest.mark.performance
def test_performance_1000_candles():
    """Test performance with 1000 candles"""
    con = duckdb.connect(':memory:')
    simulator = DuckDBSimulator(con)
    
    input_data = SimInput(
        run_id='perf_test_002',
        strategy_id='PT2_SL25',
        mint='So11111111111111111111111111111111111111112',
        alert_timestamp='2024-01-01T12:00:00Z',
        candles=generate_candles(1000),
        entry_config=EntryConfig(
            initialEntry='none',
            trailingEntry='none',
            maxWaitTime=60.0,
        ),
        exit_config=ExitConfig(
            profit_targets=[{'target': 2.0, 'percent': 1.0}],
            stop_loss={'initial': -0.25},
        )
    )
    
    start = time.time()
    simulator.run_from_contract(input_data)
    duration = (time.time() - start) * 1000  # Convert to ms
    
    assert duration < 1000  # 1000ms threshold for Python
    con.close()


@pytest.mark.performance
def test_performance_10000_candles():
    """Test performance with 10000 candles"""
    con = duckdb.connect(':memory:')
    simulator = DuckDBSimulator(con)
    
    input_data = SimInput(
        run_id='perf_test_003',
        strategy_id='PT2_SL25',
        mint='So11111111111111111111111111111111111111112',
        alert_timestamp='2024-01-01T12:00:00Z',
        candles=generate_candles(10000),
        entry_config=EntryConfig(
            initialEntry='none',
            trailingEntry='none',
            maxWaitTime=60.0,
        ),
        exit_config=ExitConfig(
            profit_targets=[{'target': 2.0, 'percent': 1.0}],
            stop_loss={'initial': -0.25},
        )
    )
    
    start = time.time()
    simulator.run_from_contract(input_data)
    duration = (time.time() - start) * 1000  # Convert to ms
    
    assert duration < 5000  # 5000ms threshold for Python
    con.close()

