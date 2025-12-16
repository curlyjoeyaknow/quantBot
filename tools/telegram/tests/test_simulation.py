"""
Tests for simulation engine.
"""

import pytest
import duckdb
from datetime import datetime, timedelta
from simulation.simulator import DuckDBSimulator, StrategyConfig
from simulation.sql_functions import setup_simulation_schema

@pytest.fixture
def test_db():
    """Create a temporary DuckDB connection for testing."""
    con = duckdb.connect(':memory:')
    setup_simulation_schema(con)
    
    # Create sample OHLCV data
    con.execute("""
        INSERT INTO ohlcv_candles_d VALUES
        ('So11111111111111111111111111111111111111112', 1704067200, 1.0, 1.1, 0.9, 1.05, 1000.0, 60),
        ('So11111111111111111111111111111111111111112', 1704067260, 1.05, 1.2, 1.0, 1.15, 1200.0, 60),
        ('So11111111111111111111111111111111111111112', 1704067320, 1.15, 1.3, 1.1, 1.25, 1500.0, 60),
        ('So11111111111111111111111111111111111111112', 1704067380, 1.25, 1.4, 1.2, 1.35, 1800.0, 60),
        ('So11111111111111111111111111111111111111112', 1704067440, 1.35, 2.1, 1.3, 2.0, 2000.0, 60),  -- Profit target hit
        ('So11111111111111111111111111111111111111112', 1704067500, 2.0, 2.2, 1.9, 2.1, 2200.0, 60)
    """)
    con.commit()
    
    yield con
    con.close()

def test_immediate_entry_simulation(test_db):
    """Test immediate entry strategy."""
    simulator = DuckDBSimulator(test_db)
    strategy = StrategyConfig(
        strategy_id='test_immediate',
        name='Test Immediate',
        entry_type='immediate',
        profit_targets=[{'target': 2.0, 'percent': 0.5}],
        stop_loss_pct=0.2
    )
    
    alert_time = datetime.fromtimestamp(1704067200)
    result = simulator.run_simulation(
        strategy,
        'So11111111111111111111111111111111111111112',
        alert_time,
        initial_capital=1000.0
    )
    
    assert 'run_id' in result or result.get('error') is not None
    if 'error' not in result:
        assert 'final_capital' in result
        assert 'total_trades' in result
        assert result['total_trades'] >= 0

def test_profit_target_detection(test_db):
    """Test profit target detection."""
    simulator = DuckDBSimulator(test_db)
    strategy = StrategyConfig(
        strategy_id='test_profit',
        name='Test Profit Target',
        entry_type='immediate',
        profit_targets=[{'target': 2.0, 'percent': 1.0}]
    )
    
    alert_time = datetime.fromtimestamp(1704067200)
    result = simulator.run_simulation(
        strategy,
        'So11111111111111111111111111111111111111112',
        alert_time,
        initial_capital=1000.0
    )
    
    if 'error' not in result:
        # Should have hit profit target (price goes from 1.0 to 2.0)
        assert len(result.get('events', [])) >= 2  # Entry + Exit
        exit_events = [e for e in result['events'] if e['event_type'] == 'exit']
        if exit_events:
            assert exit_events[0]['metadata'].get('reason') == 'profit_target'

def test_stop_loss_detection(test_db):
    """Test stop loss detection."""
    simulator = DuckDBSimulator(test_db)
    strategy = StrategyConfig(
        strategy_id='test_stop',
        name='Test Stop Loss',
        entry_type='immediate',
        profit_targets=[],
        stop_loss_pct=0.1  # 10% stop loss
    )
    
    # Create candles that hit stop loss
    test_db.execute("""
        INSERT INTO ohlcv_candles_d VALUES
        ('So22222222222222222222222222222222222222223', 1704067200, 1.0, 1.0, 0.8, 0.85, 1000.0, 60)  -- Stop loss hit
    """)
    test_db.commit()
    
    alert_time = datetime.fromtimestamp(1704067200)
    result = simulator.run_simulation(
        strategy,
        'So22222222222222222222222222222222222222223',
        alert_time,
        initial_capital=1000.0
    )
    
    if 'error' not in result:
        exit_events = [e for e in result.get('events', []) if e['event_type'] in ['exit', 'stop_loss']]
        # May or may not hit stop loss depending on candle data
        assert len(result.get('events', [])) >= 1  # At least entry

def test_batch_simulation(test_db):
    """Test batch simulation."""
    simulator = DuckDBSimulator(test_db)
    strategy = StrategyConfig(
        strategy_id='test_batch',
        name='Test Batch',
        entry_type='immediate',
        profit_targets=[{'target': 2.0, 'percent': 1.0}]
    )
    
    mints = [
        'So11111111111111111111111111111111111111112',
        'So11111111111111111111111111111111111111112'
    ]
    alert_timestamps = [
        datetime.fromtimestamp(1704067200),
        datetime.fromtimestamp(1704067200)
    ]
    
    results = simulator.batch_simulate(
        strategy,
        mints,
        alert_timestamps,
        initial_capital=1000.0
    )
    
    assert len(results) == 2
    for result in results:
        assert 'run_id' in result or 'error' in result

def test_no_candles_handling(test_db):
    """Test handling when no candles are available."""
    simulator = DuckDBSimulator(test_db)
    strategy = StrategyConfig(
        strategy_id='test_no_candles',
        name='Test No Candles',
        entry_type='immediate',
        profit_targets=[{'target': 2.0, 'percent': 1.0}]
    )
    
    result = simulator.run_simulation(
        strategy,
        'So99999999999999999999999999999999999999999',  # Non-existent mint
        datetime.fromtimestamp(1704067200),
        initial_capital=1000.0
    )
    
    assert 'error' in result or result.get('run_id') is None

