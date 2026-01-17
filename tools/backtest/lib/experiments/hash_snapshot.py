"""
Data Snapshot Hash Computation

Computes SHA-256 hash of data snapshot for experiment tracking.
This ensures reproducible experiment identification.
"""

import json
import hashlib
import sys
from typing import Dict, Any, List


def compute_snapshot_hash(data: Dict[str, Any], params: Dict[str, Any]) -> str:
    """
    Compute content hash from snapshot data and parameters.
    
    Args:
        data: Snapshot data with candles and calls
        params: Snapshot creation parameters (timeRange, sources, filters)
        
    Returns:
        SHA-256 hash as hex string
    """
    # Create deterministic representation of data
    data_repr = {
        'params': {
            'timeRange': params.get('timeRange'),
            'sources': params.get('sources'),
            'filters': params.get('filters'),
        },
        'data': {
            'candles': [
                {
                    't': c.get('timestamp'),
                    'o': c.get('open'),
                    'h': c.get('high'),
                    'l': c.get('low'),
                    'c': c.get('close'),
                    'v': c.get('volume'),
                    'm': c.get('mint'),
                }
                for c in data.get('candles', [])
            ],
            'calls': [
                {
                    'id': c.get('id'),
                    'caller': c.get('caller'),
                    'mint': c.get('mint'),
                    'createdAt': c.get('createdAt'),
                    'price': c.get('price'),
                    'volume': c.get('volume'),
                }
                for c in data.get('calls', [])
            ],
        },
    }
    
    # Sort for determinism
    data_repr['data']['candles'].sort(key=lambda c: (c.get('t', 0), c.get('m', '')))
    data_repr['data']['calls'].sort(key=lambda c: c.get('createdAt', ''))
    
    # Compute hash
    json_str = json.dumps(data_repr, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(json_str.encode('utf-8')).hexdigest()


def main():
    """Main entry point for PythonEngine calls."""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Missing input JSON'}), file=sys.stderr)
        sys.exit(1)
    
    try:
        # Parse input JSON from stdin or first argument
        input_data = json.loads(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read())
        
        data = input_data.get('data', {})
        params = input_data.get('params', {})
        
        hash_value = compute_snapshot_hash(data, params)
        
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

