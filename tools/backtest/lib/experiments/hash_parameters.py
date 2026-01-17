"""
Parameter Vector Hash Computation

Computes SHA-256 hash of parameter vector for experiment tracking and deduplication.
This ensures reproducible experiment identification.
"""

import json
import hashlib
import sys
from typing import Dict, Any


def serialize_parameters(
    strategy_config: Dict[str, Any],
    execution_model: Dict[str, Any] = None,
    risk_model: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Serialize simulation parameters to parameter vector.
    
    Args:
        strategy_config: Strategy configuration
        execution_model: Execution model configuration (optional)
        risk_model: Risk model configuration (optional)
        
    Returns:
        Parameter vector (flat key-value representation)
    """
    vector = {}
    
    # Serialize strategy config
    def flatten_dict(d: Dict[str, Any], prefix: str = 'strategy') -> None:
        """Recursively flatten nested dictionary."""
        for key, value in d.items():
            full_key = f'{prefix}.{key}' if prefix else key
            if isinstance(value, dict):
                flatten_dict(value, full_key)
            else:
                # Convert value to string for hashing
                if value is None:
                    vector[full_key] = None
                elif isinstance(value, (str, int, float, bool)):
                    vector[full_key] = value
                else:
                    vector[full_key] = json.dumps(value, sort_keys=True)
    
    flatten_dict(strategy_config, 'strategy')
    
    if execution_model:
        flatten_dict(execution_model, 'execution')
    
    if risk_model:
        flatten_dict(risk_model, 'risk')
    
    return vector


def hash_parameter_vector(vector: Dict[str, Any]) -> str:
    """
    Hash parameter vector for quick comparison.
    
    Args:
        vector: Parameter vector (flat key-value representation)
        
    Returns:
        SHA-256 hash as hex string
    """
    # Sort keys for deterministic hashing
    sorted_items = sorted(vector.items())
    sorted_str = '&'.join(f'{key}={json.dumps(value, sort_keys=True)}' for key, value in sorted_items)
    
    return hashlib.sha256(sorted_str.encode('utf-8')).hexdigest()


def compute_parameter_hash(
    strategy_config: Dict[str, Any],
    execution_model: Dict[str, Any] = None,
    risk_model: Dict[str, Any] = None
) -> str:
    """
    Compute parameter vector hash from simulation parameters.
    
    Args:
        strategy_config: Strategy configuration
        execution_model: Execution model configuration (optional)
        risk_model: Risk model configuration (optional)
        
    Returns:
        SHA-256 hash as hex string
    """
    vector = serialize_parameters(strategy_config, execution_model, risk_model)
    return hash_parameter_vector(vector)


def main():
    """Main entry point for PythonEngine calls."""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Missing input JSON'}), file=sys.stderr)
        sys.exit(1)
    
    try:
        # Parse input JSON from stdin or first argument
        input_data = json.loads(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read())
        
        strategy_config = input_data.get('strategyConfig', {})
        execution_model = input_data.get('executionModel')
        risk_model = input_data.get('riskModel')
        
        hash_value = compute_parameter_hash(strategy_config, execution_model, risk_model)
        
        # Output result as JSON
        result = {
            'hash': hash_value,
        }
        print(json.dumps(result))
    except Exception as e:
        error_result = {
            'error': str(e),
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

