# ML Pipeline

Machine learning pipeline for model training and prediction.

## Features

- Data preparation for regression and time-series models
- Model training (Random Forest, Gradient Boosting, Linear Regression)
- Model persistence and loading
- Prediction interface
- Sequence data preparation for LSTM/Transformer models

## Usage

### Data Preparation

```python
import duckdb
from ml import MLDataPreparator

con = duckdb.connect('tele.duckdb')
preparator = MLDataPreparator(con)

# Prepare training data
X_train, X_test, y_train, y_test = preparator.prepare_training_data(
    target_col='ath_multiple',
    min_samples=100,
    test_size=0.2
)

# Prepare sequence data for time series models
X_sequences, y_sequences = preparator.prepare_sequence_data(
    sequence_length=60,
    min_sequences=50
)
```

### Model Training

```python
from ml import ModelTrainer

trainer = ModelTrainer()

# Train model
result = trainer.train_regression_model(
    X_train, y_train, X_test, y_test,
    model_type='random_forest'
)

print(f"Test R2: {result['metrics']['test_r2']:.4f}")
print(f"Test MAE: {result['metrics']['test_mae']:.4f}")

# Save model
trainer.save_model('random_forest', 'models/rf_model.pkl')
```

### Prediction

```python
from ml import Predictor

# Load model
predictor = Predictor('models/rf_model.pkl')

# Make prediction
prediction = predictor.predict(
    features={
        'price_at_alert': 0.001,
        'volume_24h': 100000.0,
        'caller_win_rate': 0.65,
        ...
    },
    feature_order=['price_at_alert', 'volume_24h', 'caller_win_rate', ...]
)

print(f"Predicted ATH multiple: {prediction['prediction']:.2f}x")
print(f"Confidence: {prediction['confidence']:.2%}")
```

## Model Types

- **Random Forest**: Good for non-linear relationships, feature importance
- **Gradient Boosting**: High accuracy, good for complex patterns
- **Linear Regression**: Fast, interpretable, good baseline

## Requirements

- `scikit-learn>=1.3.0`
- `numpy>=1.24.0`
- `pandas>=2.0.0`

