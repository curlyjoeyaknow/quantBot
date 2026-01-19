#!/usr/bin/env python3
"""
Interactive CLI for QuantBot Backtest Operations

Simple menu-driven interface for running backtests and viewing reports.
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

import duckdb

# Add parent directory to path
tools_backtest_dir = str(Path(__file__).parent)
sys.path.insert(0, tools_backtest_dir)

def clear_screen():
    """Clear terminal screen."""
    os.system('clear' if os.name != 'nt' else 'cls')

def print_header(title: str):
    """Print a formatted header."""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70 + "\n")

def print_menu(title: str, options: List[Dict[str, str]]):
    """Print a menu with numbered options."""
    print_header(title)
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt['label']}")
    print(f"  0. Back/Exit\n")

def get_choice(max_choice: int) -> Optional[int]:
    """Get user choice from menu."""
    try:
        choice = input("Enter choice: ").strip()
        if choice == '0':
            return None
        choice_num = int(choice)
        if 1 <= choice_num <= max_choice:
            return choice_num
        print(f"Invalid choice. Please enter 1-{max_choice} or 0 to exit.")
        return get_choice(max_choice)
    except ValueError:
        print("Invalid input. Please enter a number.")
        return get_choice(max_choice)
    except KeyboardInterrupt:
        print("\n\nExiting...")
        sys.exit(0)

def list_backtest_runs(conn: duckdb.DuckDBPyConnection) -> List[Dict]:
    """List all backtest runs from DuckDB."""
    runs = []
    
    # Try to query baseline runs
    try:
        query = """
        SELECT 
            run_id,
            'baseline' as run_type,
            created_at,
            interval,
            time_from,
            time_to,
            CAST(COUNT(*) AS INTEGER) as call_count
        FROM baseline.runs_d
        GROUP BY run_id, created_at, interval, time_from, time_to
        ORDER BY created_at DESC
        LIMIT 20
        """
        baseline_runs = conn.execute(query).fetchall()
        for row in baseline_runs:
            runs.append({
                'run_id': row[0],
                'run_type': 'baseline',
                'created_at': row[2],
                'interval': row[3],
                'time_from': row[4],
                'time_to': row[5],
                'call_count': row[6],
            })
    except Exception as e:
        pass  # Schema might not exist
    
    # Try to query optimizer runs
    try:
        query = """
        SELECT 
            run_id,
            'optimizer' as run_type,
            created_at,
            interval,
            time_from,
            time_to,
            CAST(COUNT(*) AS INTEGER) as policy_count
        FROM optimizer.runs_d
        GROUP BY run_id, created_at, interval, time_from, time_to
        ORDER BY created_at DESC
        LIMIT 20
        """
        optimizer_runs = conn.execute(query).fetchall()
        for row in optimizer_runs:
            runs.append({
                'run_id': row[0],
                'run_type': 'optimizer',
                'created_at': row[2],
                'interval': row[3],
                'time_from': row[4],
                'time_to': row[5],
                'call_count': row[6] if len(row) > 6 else 0,
            })
    except Exception as e:
        pass
    
    return runs

def run_baseline_backtest_menu(conn: duckdb.DuckDBPyConnection):
    """Interactive menu for running baseline backtest."""
    print_header("Run Baseline Backtest")
    print("This will run a baseline backtest on your alerts data.")
    print("\nExample command:")
    print("  quantbot backtest v1-baseline \\")
    print("    --interval 5m \\")
    print("    --from 2024-01-01 \\")
    print("    --to 2024-12-31 \\")
    print("    --duckdb data/alerts.duckdb")
    print("\nPress Enter to run this example, or 'q' to go back.")
    
    choice = input().strip().lower()
    if choice == 'q':
        return
    
    # Here you could spawn the actual command
    print("\nTo run the backtest, use the command shown above.")
    input("\nPress Enter to continue...")

def view_reports_menu(conn: duckdb.DuckDBPyConnection):
    """Menu for viewing reports."""
    while True:
        runs = list_backtest_runs(conn)
        
        if not runs:
            print("\nNo backtest runs found.")
            input("Press Enter to continue...")
            return
        
        options = [{'label': f"{r['run_type'].upper()}: {r['run_id'][:20]}... ({r.get('call_count', 0)} calls) - {r['created_at']}"} for r in runs]
        options.append({'label': 'View in Web Dashboard'})
        
        print_menu("Available Backtest Runs", options)
        choice = get_choice(len(options))
        
        if choice is None:
            return
        elif choice == len(options):  # Web dashboard option
            print("\nStarting web dashboard...")
            print("Open your browser to: http://localhost:8080/")
            print("\nStarting server in background...")
            # You could spawn the server here
            input("Press Enter after opening the dashboard...")
        elif 1 <= choice <= len(runs):
            selected_run = runs[choice - 1]
            print(f"\nSelected: {selected_run['run_id']}")
            print(f"Type: {selected_run['run_type']}")
            print(f"Created: {selected_run['created_at']}")
            print(f"\nTo view full report, open: http://localhost:8080/run/{selected_run['run_id']}?type={selected_run['run_type']}")
            input("\nPress Enter to continue...")

def main_menu(conn: duckdb.DuckDBPyConnection):
    """Main menu loop."""
    while True:
        options = [
            {'label': 'Run Baseline Backtest'},
            {'label': 'View Reports'},
            {'label': 'Open Web Dashboard'},
        ]
        
        print_menu("QuantBot Backtest - Main Menu", options)
        choice = get_choice(len(options))
        
        if choice is None:
            break
        elif choice == 1:
            run_baseline_backtest_menu(conn)
        elif choice == 2:
            view_reports_menu(conn)
        elif choice == 3:
            print("\nStarting web dashboard...")
            print("Open your browser to: http://localhost:8080/")
            print("\nThe dashboard provides:")
            print("  - Query builder for filtering alerts")
            print("  - Caller analytics (% alerts that go 2x, 3x, 100k+)")
            print("  - Market cap filters")
            print("  - Interactive reports")
            input("\nPress Enter to continue...")

def main():
    parser = argparse.ArgumentParser(description='Interactive CLI for QuantBot Backtest')
    parser.add_argument('--duckdb', default='data/alerts.duckdb', help='Path to DuckDB file')
    args = parser.parse_args()
    
    duckdb_path = Path(args.duckdb)
    if not duckdb_path.exists():
        print(f"Error: DuckDB file not found: {duckdb_path}")
        print(f"Expected path: {duckdb_path.absolute()}")
        sys.exit(1)
    
    conn = duckdb.connect(str(duckdb_path))
    
    try:
        clear_screen()
        print_header("QuantBot Backtest - Interactive CLI")
        main_menu(conn)
    finally:
        conn.close()
        print("\nGoodbye!\n")

if __name__ == '__main__':
    main()

