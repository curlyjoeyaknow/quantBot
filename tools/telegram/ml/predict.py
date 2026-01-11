"""
Make predictions using trained models.
"""

import pickle
from typing import Dict, Any, List, Optional
from pathlib import Path
import logging

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    np = None

logger = logging.getLogger(__name__)

class Predictor:
    """Make predictions on new alerts"""
    
    def __init__(self, model_path: str):
        if not HAS_NUMPY:
            raise ImportError("numpy is required for predictions")
        
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")
        
        with open(model_path, 'rb') as f:
            model_data = pickle.load(f)
        
        self.model = model_data['model']
        self.metrics = model_data.get('metrics', {})
        logger.info(f"Loaded model from {model_path}")
    
    def predict(
        self,
        features: Dict[str, Any],
        feature_order: List[str]
    ) -> Dict[str, Any]:
        """
        Predict target value for given features.
        
        Args:
            features: Dict of feature values
            feature_order: Order of features expected by model
        
        Returns:
            Prediction and confidence
        """
        if not HAS_NUMPY:
            raise ImportError("numpy is required for predictions")
        
        # Convert features to array in correct order
        feature_array = np.array([[features.get(f, 0.0) for f in feature_order]])
        
        # Predict
        prediction = self.model.predict(feature_array)[0]
        
        # Calculate confidence (simplified - could use prediction intervals)
        # For now, use model R2 as a proxy for confidence
        confidence = min(0.95, max(0.5, self.metrics.get('test_r2', 0.5)))
        
        return {
            'prediction': float(prediction),
            'confidence': float(confidence),
            'model_metrics': self.metrics
        }

