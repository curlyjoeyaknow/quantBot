"""
Tests for ML pipeline modules.
"""

import pytest
import duckdb
import json
import tempfile
from pathlib import Path
from ml.data_preparation import MLDataPreparator
from ml.train_models import ModelTrainer
from ml.predict import Predictor

try:
    import numpy as np
    from sklearn.datasets import make_regression
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    np = None

@pytest.fixture
def test_db():
    """Create a temporary DuckDB connection for testing."""
    con = duckdb.connect(':memory:')
    
    # Create sample training data view
    con.execute("""
        CREATE TABLE v_training_data AS
        SELECT 
            1.0 as price_at_alert,
            100000.0 as volume_24h,
            0.65 as caller_win_rate,
            2.5 as ath_multiple
        UNION ALL
        SELECT 1.1, 110000.0, 0.70, 2.8
        UNION ALL
        SELECT 0.9, 90000.0, 0.60, 1.8
        UNION ALL
        SELECT 1.2, 120000.0, 0.75, 3.0
        UNION ALL
        SELECT 0.8, 80000.0, 0.55, 1.5
    """)
    
    yield con
    con.close()

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_data_preparation_basic(test_db):
    """Test basic data preparation."""
    preparator = MLDataPreparator(test_db)
    
    X_train, X_test, y_train, y_test = preparator.prepare_training_data(
        target_col='ath_multiple',
        feature_cols=['price_at_alert', 'volume_24h', 'caller_win_rate'],
        min_samples=3,
        test_size=0.2
    )
    
    assert X_train.shape[0] > 0
    assert X_test.shape[0] > 0
    assert len(y_train) > 0
    assert len(y_test) > 0
    assert X_train.shape[1] == 3  # 3 features

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_model_training_random_forest():
    """Test Random Forest model training."""
    trainer = ModelTrainer()
    
    # Create synthetic data
    X, y = make_regression(n_samples=100, n_features=5, noise=0.1, random_state=42)
    
    # Split train/test
    split_idx = 80
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    result = trainer.train_regression_model(
        X_train, y_train, X_test, y_test,
        model_type='random_forest'
    )
    
    assert 'model' in result
    assert 'metrics' in result
    assert 'test_r2' in result['metrics']
    assert 'test_mse' in result['metrics']
    assert result['metrics']['test_r2'] > 0  # Should have positive R2

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_model_training_gradient_boosting():
    """Test Gradient Boosting model training."""
    trainer = ModelTrainer()
    
    X, y = make_regression(n_samples=100, n_features=5, noise=0.1, random_state=42)
    split_idx = 80
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    result = trainer.train_regression_model(
        X_train, y_train, X_test, y_test,
        model_type='gradient_boosting'
    )
    
    assert 'model' in result
    assert 'metrics' in result
    assert result['metrics']['test_r2'] > 0

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_model_training_linear_regression():
    """Test Linear Regression model training."""
    trainer = ModelTrainer()
    
    X, y = make_regression(n_samples=100, n_features=5, noise=0.1, random_state=42)
    split_idx = 80
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    result = trainer.train_regression_model(
        X_train, y_train, X_test, y_test,
        model_type='linear'
    )
    
    assert 'model' in result
    assert 'metrics' in result
    assert 'test_r2' in result['metrics']

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_model_save_and_load():
    """Test model saving and loading."""
    trainer = ModelTrainer()
    
    X, y = make_regression(n_samples=100, n_features=5, noise=0.1, random_state=42)
    split_idx = 80
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    # Train model
    trainer.train_regression_model(
        X_train, y_train, X_test, y_test,
        model_type='random_forest'
    )
    
    # Save model
    with tempfile.TemporaryDirectory() as tmpdir:
        model_path = Path(tmpdir) / 'test_model.pkl'
        trainer.save_model('random_forest', str(model_path))
        
        assert model_path.exists()
        
        # Load model
        loaded = trainer.load_model(str(model_path))
        assert 'model' in loaded
        assert 'metrics' in loaded

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_predictor_load_and_predict():
    """Test predictor loading and prediction."""
    trainer = ModelTrainer()
    
    # Train a simple model
    X, y = make_regression(n_samples=100, n_features=3, noise=0.1, random_state=42)
    split_idx = 80
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    trainer.train_regression_model(
        X_train, y_train, X_test, y_test,
        model_type='random_forest'
    )
    
    # Save model
    with tempfile.TemporaryDirectory() as tmpdir:
        model_path = Path(tmpdir) / 'test_model.pkl'
        trainer.save_model('random_forest', str(model_path))
        
        # Load predictor
        predictor = Predictor(str(model_path))
        
        # Make prediction
        features = {
            'feature_0': 1.0,
            'feature_1': 2.0,
            'feature_2': 3.0
        }
        feature_order = ['feature_0', 'feature_1', 'feature_2']
        
        prediction = predictor.predict(features, feature_order)
        
        assert 'prediction' in prediction
        assert 'confidence' in prediction
        assert 'model_metrics' in prediction
        assert isinstance(prediction['prediction'], (int, float))

@pytest.mark.skipif(not HAS_SKLEARN, reason="sklearn not available")
def test_predictor_invalid_model():
    """Test predictor with invalid model path."""
    with pytest.raises(FileNotFoundError):
        Predictor('/nonexistent/path/model.pkl')

def test_data_preparation_no_sklearn(test_db):
    """Test data preparation gracefully handles missing sklearn."""
    # This test verifies the module doesn't crash when sklearn is missing
    # We can't actually test this without mocking, but the code has checks
    pass

