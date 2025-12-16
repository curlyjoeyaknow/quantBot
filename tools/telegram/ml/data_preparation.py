"""
Prepare data for ML model training.
"""

import duckdb
import json
from typing import List, Dict, Any, Tuple, Optional

try:
    import numpy as np
    import pandas as pd
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    np = None
    pd = None
    StandardScaler = None
    LabelEncoder = None

import logging

logger = logging.getLogger(__name__)

class MLDataPreparator:
    """Prepare data for ML model training"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        if HAS_SKLEARN:
            self.scaler = StandardScaler()
            self.label_encoders = {}
        else:
            logger.warning("sklearn not available, data preparation will be limited")
    
    def prepare_training_data(
        self,
        target_col: str = 'ath_multiple',
        feature_cols: Optional[List[str]] = None,
        min_samples: int = 100,
        test_size: float = 0.2
    ) -> Tuple:
        """
        Prepare training and test datasets.
        
        Returns:
            X_train, X_test, y_train, y_test (as numpy arrays if sklearn available)
        """
        if not HAS_SKLEARN:
            raise ImportError("sklearn is required for data preparation")
        
        # Fetch data from DuckDB
        df = self._fetch_training_data(target_col, feature_cols, min_samples)
        
        if df.empty:
            raise ValueError("No training data available")
        
        # Separate features and target
        if feature_cols is None:
            feature_cols = [col for col in df.columns if col != target_col]
        
        X = df[feature_cols].values
        y = df[target_col].values
        
        # Handle categorical features
        X = self._encode_categorical_features(X, feature_cols, df)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Split train/test
        split_idx = int(len(X_scaled) * (1 - test_size))
        X_train = X_scaled[:split_idx]
        X_test = X_scaled[split_idx:]
        y_train = y[:split_idx]
        y_test = y[split_idx:]
        
        return X_train, X_test, y_train, y_test
    
    def prepare_sequence_data(
        self,
        sequence_length: int = 60,
        target_col: str = 'ath_multiple',
        min_sequences: int = 50
    ) -> Tuple:
        """
        Prepare sequence data for time series models (LSTM, Transformer).
        
        Returns:
            X_sequences: (n_sequences, sequence_length, n_features)
            y_sequences: (n_sequences,)
        """
        if not HAS_SKLEARN:
            raise ImportError("sklearn is required for sequence data preparation")
        
        try:
            # Fetch sequence features
            sequences = self.con.execute("""
                SELECT features_array, target
                FROM sequence_features_with_targets
                WHERE LENGTH(features_array) >= ?
                LIMIT ?
            """, [sequence_length, min_sequences * 10]).fetchall()
            
            X_list = []
            y_list = []
            
            for seq_data, target in sequences:
                try:
                    features_array = json.loads(seq_data)
                    
                    if len(features_array) < sequence_length:
                        continue
                    
                    # Extract features from sequence
                    sequence_features = []
                    for feat_dict in features_array[-sequence_length:]:
                        # Convert feature dict to array (assume numeric features)
                        feat_array = [float(feat_dict.get(f'feature_{i}', 0.0)) for i in range(len(feat_dict))]
                        sequence_features.append(feat_array)
                    
                    X_list.append(sequence_features)
                    y_list.append(float(target))
                except Exception as e:
                    logger.warning(f"Failed to process sequence: {e}")
                    continue
            
            if not X_list:
                raise ValueError("No valid sequences found")
            
            X_sequences = np.array(X_list)
            y_sequences = np.array(y_list)
            
            return X_sequences, y_sequences
        except Exception as e:
            logger.error(f"Failed to prepare sequence data: {e}")
            raise
    
    def _fetch_training_data(
        self,
        target_col: str,
        feature_cols: Optional[List[str]],
        min_samples: int
    ):
        """Fetch training data from DuckDB"""
        if not HAS_SKLEARN:
            raise ImportError("pandas is required for data fetching")
        
        try:
            # Build query - simplified version
            # In practice, you'd have a view with features already computed
            if feature_cols:
                cols = ', '.join(feature_cols + [target_col])
            else:
                cols = '*'
            
            query = f"""
                SELECT {cols}
                FROM v_training_data
                WHERE {target_col} IS NOT NULL
                LIMIT ?
            """
            
            result = self.con.execute(query, [min_samples]).df()
            return result
        except Exception as e:
            logger.error(f"Failed to fetch training data: {e}")
            # Return empty dataframe
            return pd.DataFrame()
    
    def _encode_categorical_features(
        self,
        X,
        feature_cols: List[str],
        df
    ):
        """Encode categorical features"""
        if not HAS_SKLEARN:
            return X
        
        X_encoded = X.copy()
        
        for i, col in enumerate(feature_cols):
            if df[col].dtype == 'object' or df[col].dtype.name == 'category':
                if col not in self.label_encoders:
                    self.label_encoders[col] = LabelEncoder()
                    X_encoded[:, i] = self.label_encoders[col].fit_transform(df[col])
                else:
                    X_encoded[:, i] = self.label_encoders[col].transform(df[col])
        
        return X_encoded

