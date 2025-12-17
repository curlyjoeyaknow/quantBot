"""
Feature store for ML pipeline.
Stores computed features in DuckDB for model training.
"""

import duckdb
import json
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class FeatureStore:
    """Store and retrieve features for ML models"""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        self._setup_feature_tables()
    
    def _setup_feature_tables(self):
        """Create feature storage tables"""
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS alert_features (
                feature_id TEXT PRIMARY KEY,
                mint TEXT NOT NULL,
                alert_timestamp TIMESTAMP NOT NULL,
                caller_name TEXT,
                features JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS candle_features (
                feature_id TEXT PRIMARY KEY,
                mint TEXT NOT NULL,
                candle_timestamp TIMESTAMP NOT NULL,
                features JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS sequence_features (
                sequence_id TEXT PRIMARY KEY,
                mint TEXT NOT NULL,
                start_timestamp TIMESTAMP NOT NULL,
                end_timestamp TIMESTAMP NOT NULL,
                features_array JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_alert_features_mint ON alert_features(mint);
            CREATE INDEX IF NOT EXISTS idx_alert_features_timestamp ON alert_features(alert_timestamp);
        """)
        self.con.commit()
    
    def store_alert_features(
        self,
        mint: str,
        alert_timestamp: datetime,
        caller_name: Optional[str],
        features: Dict[str, Any]
    ) -> str:
        """Store features for an alert"""
        feature_id = f"{mint}_{int(alert_timestamp.timestamp())}"
        
        try:
            self.con.execute("""
                INSERT OR REPLACE INTO alert_features
                (feature_id, mint, alert_timestamp, caller_name, features, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, [
                feature_id,
                mint,
                alert_timestamp,
                caller_name,
                json.dumps(features),
                datetime.now()
            ])
            self.con.commit()
            return feature_id
        except Exception as e:
            logger.error(f"Failed to store alert features: {e}")
            raise
    
    def get_features_for_training(
        self,
        target_col: str = 'ath_multiple',
        min_samples: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get features and targets for model training.
        
        Returns list of dicts with 'features' and 'target' keys.
        """
        try:
            # Join features with targets from alerts
            query = """
                SELECT 
                    af.features,
                    COALESCE(a.ath_multiple, 0) as target
                FROM alert_features af
                LEFT JOIN alerts a ON af.mint = a.token_id AND af.alert_timestamp = a.alert_timestamp
                WHERE a.ath_multiple IS NOT NULL AND a.ath_multiple > 0
                LIMIT ?
            """
            
            rows = self.con.execute(query, [min_samples]).fetchall()
            
            training_data = []
            for row in rows:
                try:
                    features = json.loads(row[0])
                    target = float(row[1])
                    training_data.append({
                        'features': features,
                        'target': target
                    })
                except Exception as e:
                    logger.warning(f"Failed to parse training data row: {e}")
                    continue
            
            return training_data
        except Exception as e:
            logger.error(f"Failed to get features for training: {e}")
            return []

