#!/usr/bin/env python3
"""
Seed Strategy Presets to DuckDB
=================================
Migrates strategy presets to DuckDB
"""

import json
import sys
from pathlib import Path

# Add tools directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'tools' / 'storage'))

from duckdb_strategies import safe_connect, create_strategy

# Strategy presets based on packages/simulation/src/strategies/presets.ts
STRATEGIES = [
    {
        'name': 'Basic_6h_20pctSL',
        'version': '1',
        'category': 'general',
        'description': 'Basic strategy with 6h hold duration | Stop loss: 20%',
        'config': {
            'name': 'Basic_6h_20pctSL',
            'profitTargets': [],
            'stopLoss': {
                'initial': -0.2,
                'trailing': 'none',
            },
            'holdHours': 6,
        },
        'is_active': True,
    },
    {
        'name': 'Conservative_24h',
        'version': '1',
        'category': 'conservative',
        'description': 'Profit targets: 2x, 3x, 5x | Stop loss: 30% | Trailing stop: 20% | Hold duration: 24h',
        'config': {
            'name': 'Conservative_24h',
            'profitTargets': [
                {'target': 2.0, 'percent': 0.5},
                {'target': 3.0, 'percent': 0.3},
                {'target': 5.0, 'percent': 0.2},
            ],
            'stopLoss': {
                'initial': -0.3,
                'trailing': 2.0,
                'trailingPercent': 0.2,
            },
            'holdHours': 24,
        },
        'is_active': True,
    },
    {
        'name': 'Aggressive_MultiTP',
        'version': '1',
        'category': 'aggressive',
        'description': 'Profit targets: 2x, 5x, 10x | Stop loss: 40% | Hold duration: 24h',
        'config': {
            'name': 'Aggressive_MultiTP',
            'profitTargets': [
                {'target': 2.0, 'percent': 0.2},
                {'target': 5.0, 'percent': 0.3},
                {'target': 10.0, 'percent': 0.5},
            ],
            'stopLoss': {
                'initial': -0.4,
                'trailing': 'none',
            },
            'holdHours': 24,
        },
        'is_active': True,
    },
    {
        'name': 'Trailing_20pct',
        'version': '1',
        'category': 'general',
        'description': 'Profit targets: 2x, 3x | Stop loss: 20% | Trailing stop: 20% | Hold duration: 24h',
        'config': {
            'name': 'Trailing_20pct',
            'profitTargets': [
                {'target': 2.0, 'percent': 0.3},
                {'target': 3.0, 'percent': 0.3},
            ],
            'stopLoss': {
                'initial': -0.2,
                'trailing': 2.0,
                'trailingPercent': 0.2,
            },
            'holdHours': 24,
        },
        'is_active': True,
    },
    {
        'name': 'BuyTheDip_30pct',
        'version': '1',
        'category': 'dip-buying',
        'description': 'Profit targets: 2x, 5x | Stop loss: 20% | Entry: 30% dip | Hold duration: 6h',
        'config': {
            'name': 'BuyTheDip_30pct',
            'profitTargets': [
                {'target': 2.0, 'percent': 0.5},
                {'target': 5.0, 'percent': 0.5},
            ],
            'stopLoss': {
                'initial': -0.2,
                'trailing': 'none',
            },
            'entry': {
                'initialEntry': -0.3,
                'trailingEntry': 'none',
                'maxWaitTime': 60,
            },
            'holdHours': 6,
        },
        'is_active': True,
    },
]

def main():
    import os
    db_path = os.environ.get('DUCKDB_PATH', 'data/quantbot.db')
    
    print('🌱 Seeding strategy presets to DuckDB...\n')
    
    created = 0
    skipped = 0
    errors = 0
    
    for strategy_data in STRATEGIES:
        try:
            # Check if strategy already exists
            con = safe_connect(db_path)
            existing = con.execute(
                'SELECT id FROM strategies WHERE name = ? AND version = ?',
                (strategy_data['name'], strategy_data['version'])
            ).fetchone()
            con.close()
            
            if existing:
                print(f"⏭️  Skipping {strategy_data['name']} (already exists)")
                skipped += 1
                continue
            
            # Create strategy - convert 'config' to 'config_json' for the function
            strategy_data_for_db = {
                'name': strategy_data['name'],
                'version': strategy_data['version'],
                'category': strategy_data['category'],
                'description': strategy_data['description'],
                'config_json': strategy_data['config'],  # Convert 'config' to 'config_json'
                'is_active': strategy_data['is_active'],
            }
            result = create_strategy(db_path, strategy_data_for_db)
            
            if 'id' in result:
                print(f"✅ Created {strategy_data['name']} (ID: {result['id']})")
                print(f"   Category: {strategy_data['category']}")
                print(f"   Description: {strategy_data['description']}")
                created += 1
            else:
                print(f"❌ Failed to create {strategy_data['name']}: {result.get('error', 'Unknown error')}")
                errors += 1
        except Exception as e:
            print(f"❌ Error creating {strategy_data['name']}: {str(e)}")
            errors += 1
    
    print(f'\n📊 Summary:')
    print(f'   Created: {created}')
    print(f'   Skipped: {skipped}')
    print(f'   Errors: {errors}')
    print(f'   Total: {len(STRATEGIES)}')
    
    if created > 0:
        print(f'\n🎯 Strategies are now available in DuckDB')
    
    if errors > 0:
        sys.exit(1)

if __name__ == '__main__':
    main()

