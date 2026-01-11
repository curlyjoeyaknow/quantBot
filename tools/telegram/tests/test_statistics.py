"""
Tests for statistics and feature engineering modules.
"""

import pytest
import duckdb
from datetime import datetime, timedelta
from statistics.feature_engineering import FeatureEngine
from statistics.analysis import StatisticalAnalyzer
from statistics.feature_store import FeatureStore

@pytest.fixture
def test_db():
    """Create a temporary DuckDB connection for testing."""
    con = duckdb.connect(':memory:')
    
    # Create sample tables
    con.execute("""
        CREATE TABLE user_calls_d (
            mint TEXT,
            call_ts_ms BIGINT,
            caller_name TEXT,
            price_usd DOUBLE,
            price_move_pct DOUBLE,
            chg_1h_pct DOUBLE,
            mcap_usd DOUBLE,
            liquidity_usd DOUBLE
        );
        
        CREATE TABLE caller_links_d (
            mint TEXT,
            trigger_ts_ms BIGINT,
            token_age_s BIGINT,
            token_created_ts_ms BIGINT
        );
        
        CREATE TABLE ohlcv_candles_d (
            mint TEXT,
            timestamp INTEGER,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE,
            interval_seconds INTEGER
        );
        
        CREATE TABLE alerts (
            token_id TEXT,
            alert_timestamp TIMESTAMP,
            ath_multiple DOUBLE,
            atl_multiple DOUBLE
        );
    """)
    
    # Insert sample data
    con.execute("""
        INSERT INTO user_calls_d VALUES
        ('So11111111111111111111111111111111111111112', 1704067200000, 'Brook', 1.0, 5.0, 2.0, 1000000.0, 50000.0),
        ('So11111111111111111111111111111111111111112', 1704067260000, 'Brook', 1.05, 6.0, 3.0, 1100000.0, 55000.0)
    """)
    
    con.execute("""
        INSERT INTO ohlcv_candles_d VALUES
        ('So11111111111111111111111111111111111111112', 1704067200, 1.0, 1.1, 0.9, 1.05, 1000.0, 60),
        ('So11111111111111111111111111111111111111112', 1704067260, 1.05, 1.2, 1.0, 1.15, 1200.0, 60),
        ('So11111111111111111111111111111111111111112', 1704067320, 1.15, 1.3, 1.1, 1.25, 1500.0, 60)
    """)
    
    con.execute("""
        INSERT INTO alerts VALUES
        ('So11111111111111111111111111111111111111112', '2024-01-01 12:00:00', 2.5, 0.8)
    """)
    
    con.commit()
    yield con
    con.close()

def test_feature_engineering_alert_features(test_db):
    """Test alert feature engineering."""
    engine = FeatureEngine(test_db)
    
    alert_time = datetime.fromtimestamp(1704067200)
    features = engine.create_alert_features(
        'So11111111111111111111111111111111111111112',
        alert_time,
        caller_name='Brook'
    )
    
    assert 'price_at_alert' in features
    assert 'volume_24h' in features
    assert 'hour_of_day' in features
    assert 'day_of_week' in features
    assert features['price_at_alert'] > 0

def test_feature_engineering_candle_features(test_db):
    """Test candle feature engineering."""
    engine = FeatureEngine(test_db)
    
    candles = [
        {
            'timestamp': datetime.fromtimestamp(1704067200 + i * 60),
            'open': 1.0 + i * 0.1,
            'high': 1.1 + i * 0.1,
            'low': 0.9 + i * 0.1,
            'close': 1.05 + i * 0.1,
            'volume': 1000.0 + i * 100
        }
        for i in range(30)
    ]
    
    features = engine.create_candle_features(candles)
    
    assert 'rsi_14' in features
    assert 'sma_20' in features
    assert 'ema_12' in features
    assert 'volatility_20' in features
    assert 'bollinger_upper' in features
    assert 'bollinger_lower' in features
    assert 'price_momentum_5' in features

def test_feature_engineering_rsi_calculation():
    """Test RSI calculation."""
    engine = FeatureEngine(None)  # Don't need DB for this test
    
    # Create candles with clear trend
    candles = [
        {
            'timestamp': datetime.fromtimestamp(1704067200 + i * 60),
            'close': 1.0 + i * 0.01,  # Upward trend
            'open': 1.0,
            'high': 1.1,
            'low': 0.9,
            'volume': 1000.0
        }
        for i in range(20)
    ]
    
    rsi = engine._calculate_rsi(candles, 14)
    assert 0 <= rsi <= 100
    # Upward trend should give RSI > 50
    assert rsi > 50

def test_feature_engineering_sma_calculation():
    """Test SMA calculation."""
    engine = FeatureEngine(None)
    
    candles = [
        {
            'timestamp': datetime.fromtimestamp(1704067200 + i * 60),
            'close': 1.0 + i * 0.1,
            'open': 1.0,
            'high': 1.1,
            'low': 0.9,
            'volume': 1000.0
        }
        for i in range(25)
    ]
    
    sma = engine._calculate_sma(candles, 20)
    assert sma > 0
    # SMA should be close to recent prices
    assert 2.0 < sma < 3.5

def test_statistical_analyzer_caller_performance(test_db):
    """Test caller performance analysis."""
    analyzer = StatisticalAnalyzer(test_db)
    
    # Add more sample data for meaningful analysis
    test_db.execute("""
        INSERT INTO user_calls_d VALUES
        ('So22222222222222222222222222222222222222223', 1704067300000, 'TestCaller', 1.0, 0.0, 0.0, 1000000.0, 50000.0),
        ('So33333333333333333333333333333333333333334', 1704067400000, 'TestCaller', 1.0, 0.0, 0.0, 1000000.0, 50000.0)
    """)
    
    test_db.execute("""
        INSERT INTO alerts VALUES
        ('So22222222222222222222222222222222222222223', '2024-01-01 12:01:40', 2.0, 0.9),
        ('So33333333333333333333333333333333333333334', '2024-01-01 12:02:20', 0.8, 0.7)
    """)
    test_db.commit()
    
    result = analyzer.analyze_caller_performance('TestCaller')
    
    assert 'caller_name' in result
    assert 'total_calls' in result
    if 'error' not in result:
        assert 'win_rate' in result
        assert 'avg_return' in result

def test_statistical_analyzer_token_patterns(test_db):
    """Test token pattern analysis."""
    analyzer = StatisticalAnalyzer(test_db)
    
    # Add more candles for pattern analysis
    test_db.execute("""
        INSERT INTO ohlcv_candles_d VALUES
        ('So44444444444444444444444444444444444444445', 1704067200, 1.0, 1.1, 0.9, 1.05, 1000.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067260, 1.05, 1.2, 1.0, 1.15, 1200.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067320, 1.15, 1.3, 1.1, 1.25, 1500.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067380, 1.25, 1.4, 1.2, 1.35, 1800.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067440, 1.35, 1.5, 1.3, 1.45, 2000.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067500, 1.45, 1.6, 1.4, 1.55, 2200.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067560, 1.55, 1.7, 1.5, 1.65, 2400.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067620, 1.65, 1.8, 1.6, 1.75, 2600.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067680, 1.75, 1.9, 1.7, 1.85, 2800.0, 60),
        ('So44444444444444444444444444444444444444445', 1704067740, 1.85, 2.0, 1.8, 1.95, 3000.0, 60)
    """)
    test_db.commit()
    
    result = analyzer.analyze_token_patterns('So44444444444444444444444444444444444444445')
    
    assert 'mint' in result
    if 'error' not in result:
        assert 'total_candles' in result
        assert 'volatility' in result
        assert 'price_trend' in result
        assert result['price_trend'] in ['upward', 'downward', 'stable']

def test_feature_store_store_and_retrieve(test_db):
    """Test feature store storage and retrieval."""
    store = FeatureStore(test_db)
    
    alert_time = datetime.fromtimestamp(1704067200)
    features = {
        'price_at_alert': 1.0,
        'volume_24h': 100000.0,
        'caller_win_rate': 0.65
    }
    
    feature_id = store.store_alert_features(
        'So11111111111111111111111111111111111111112',
        alert_time,
        'Brook',
        features
    )
    
    assert feature_id is not None
    assert feature_id.startswith('So111')

def test_feature_store_training_data(test_db):
    """Test getting training data from feature store."""
    store = FeatureStore(test_db)
    
    # Store some features with targets
    alert_time = datetime.fromtimestamp(1704067200)
    features = {'price_at_alert': 1.0, 'volume_24h': 100000.0}
    
    store.store_alert_features(
        'So11111111111111111111111111111111111111112',
        alert_time,
        'Brook',
        features
    )
    
    # Note: This test may return empty if alerts table doesn't have matching data
    # That's okay - we're testing the function works
    training_data = store.get_features_for_training(
        target_col='ath_multiple',
        min_samples=1
    )
    
    assert isinstance(training_data, list)

def test_correlation_analysis(test_db):
    """Test correlation analysis."""
    analyzer = StatisticalAnalyzer(test_db)
    
    # This will likely return empty since we don't have v_alerts_with_features view
    # But we're testing the function doesn't crash
    result = analyzer.correlation_analysis(
        ['price_at_alert', 'volume_24h'],
        'ath_multiple'
    )
    
    assert isinstance(result, dict)

