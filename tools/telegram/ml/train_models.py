"""
Train ML models on alert/call data.
"""

import json
import pickle
from typing import Dict, Any, Optional
from pathlib import Path
import logging

try:
    import numpy as np
    from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    np = None
    RandomForestRegressor = None
    GradientBoostingRegressor = None
    LinearRegression = None

logger = logging.getLogger(__name__)

class ModelTrainer:
    """Train ML models for prediction"""
    
    def __init__(self):
        self.models = {}
        self.model_metrics = {}
        if not HAS_SKLEARN:
            logger.warning("sklearn not available, model training will not work")
    
    def train_regression_model(
        self,
        X_train,
        y_train,
        X_test,
        y_test,
        model_type: str = 'random_forest'
    ) -> Dict[str, Any]:
        """
        Train a regression model to predict target (e.g., ATH multiple).
        
        Returns:
            Model object and metrics
        """
        if not HAS_SKLEARN:
            raise ImportError("sklearn is required for model training")
        
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
            'train_mse': float(mean_squared_error(y_train, y_pred_train)),
            'test_mse': float(mean_squared_error(y_test, y_pred_test)),
            'train_r2': float(r2_score(y_train, y_pred_train)),
            'test_r2': float(r2_score(y_test, y_pred_test)),
            'train_mae': float(mean_absolute_error(y_train, y_pred_train)),
            'test_mae': float(mean_absolute_error(y_test, y_pred_test))
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
        
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)
        
        with open(filepath, 'wb') as f:
            pickle.dump({
                'model': self.models[model_type],
                'metrics': self.model_metrics[model_type]
            }, f)
        
        logger.info(f"Saved model to {filepath}")
    
    def load_model(self, filepath: str) -> Dict[str, Any]:
        """Load trained model from file"""
        with open(filepath, 'rb') as f:
            return pickle.load(f)

