#!/usr/bin/env python3
"""
Quick script to insert test simulation runs into DuckDB for UI testing.
This creates minimal test data so the strategy comparison UI has something to display.
"""

import sys
import os
import duckdb
from datetime import datetime, timedelta
import uuid

# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.insert(0, project_root)

def main():
    # Get DuckDB path from environment or use default
    duckdb_path = os.environ.get('DUCKDB_PATH', 'data/tele.duckdb')
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(duckdb_path), exist_ok=True)
    
    print(f"📊 Connecting to DuckDB: {duckdb_path}")
    con = duckdb.connect(duckdb_path)
    
    try:
        # Create simulation_runs table if it doesn't exist
        con.execute("""
            CREATE TABLE IF NOT EXISTS simulation_runs (
                run_id TEXT PRIMARY KEY,
                strategy_id TEXT,
                caller_name TEXT,
                total_return_pct REAL,
                max_drawdown_pct REAL,
                sharpe_ratio REAL,
                win_rate REAL,
                total_trades INTEGER,
                created_at TIMESTAMP,
                start_time TIMESTAMP,
                end_time TIMESTAMP
            )
        """)
        
        # Clear existing test runs
        con.execute("DELETE FROM simulation_runs WHERE run_id LIKE 'test-run-%'")
        print("🗑️  Cleared existing test runs")
        
        # Generate 5 test runs with different strategies
        # Use dates in 2025 so they show up with default filter
        base_date = datetime(2025, 6, 1, 12, 0, 0)  # June 1, 2025
        now = datetime.now()
        if hasattr(datetime, 'UTC'):
            now = datetime.now(datetime.UTC)
        else:
            # Fallback for older Python
            now = datetime.utcnow()
        
        test_runs = []
        
        strategies = [
            ("strategy-1", "Simple Momentum"),
            ("strategy-2", "Mean Reversion"),
            ("strategy-3", "Breakout"),
            ("strategy-4", "Scalping"),
            ("strategy-5", "Trend Following"),
        ]
        
        for i, (strategy_id, strategy_name) in enumerate(strategies):
            run_id = f"test-run-{uuid.uuid4().hex[:8]}"
            # Create runs in June 2025 (within default date range)
            created_at = base_date + timedelta(days=i*2, hours=i*3)
            start_time = created_at - timedelta(days=1)
            end_time = created_at
            
            # Generate realistic-looking test data
            total_return_pct = 5.0 + (i * 2.5) - 5.0  # Range: 0% to 10%
            max_drawdown_pct = -2.0 - (i * 0.5)  # Range: -2% to -4%
            sharpe_ratio = 0.5 + (i * 0.2)  # Range: 0.5 to 1.5
            win_rate = 0.45 + (i * 0.05)  # Range: 45% to 65%
            total_trades = 50 + (i * 10)  # Range: 50 to 90
            
            test_runs.append({
                'run_id': run_id,
                'strategy_id': strategy_id,
                'caller_name': f'test-caller-{i+1}',
                'total_return_pct': total_return_pct,
                'max_drawdown_pct': max_drawdown_pct,
                'sharpe_ratio': sharpe_ratio,
                'win_rate': win_rate,
                'total_trades': total_trades,
                'created_at': created_at.isoformat(),
                'start_time': start_time.isoformat(),
                'end_time': end_time.isoformat(),
            })
        
        # Insert test runs
        print(f"\n📝 Inserting {len(test_runs)} test runs...")
        for run in test_runs:
            con.execute("""
                INSERT OR REPLACE INTO simulation_runs 
                (run_id, strategy_id, caller_name, total_return_pct, max_drawdown_pct, 
                 sharpe_ratio, win_rate, total_trades, created_at, start_time, end_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run['run_id'],
                run['strategy_id'],
                run['caller_name'],
                run['total_return_pct'],
                run['max_drawdown_pct'],
                run['sharpe_ratio'],
                run['win_rate'],
                run['total_trades'],
                run['created_at'],
                run['start_time'],
                run['end_time'],
            ])
            print(f"  ✓ Inserted {run['run_id']} ({run['strategy_id']}) - {run['created_at'][:10]}")
        
        # Verify insertion
        count = con.execute("SELECT COUNT(*) FROM simulation_runs").fetchone()[0]
        print(f"\n✅ Successfully inserted test runs!")
        print(f"   Total runs in database: {count}")
        print(f"\n💡 You can now view these runs in the strategy comparison UI")
        print(f"   Run: quantbot strategy compare-web")
        print(f"   Default date range: 2025-05-01 to today")
        
    finally:
        con.close()

if __name__ == '__main__':
    main()
