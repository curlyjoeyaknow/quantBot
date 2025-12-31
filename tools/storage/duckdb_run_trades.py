#!/usr/bin/env python3
"""
DuckDB RunTradesRepository - Trade storage for simulation runs
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def safe_connect(db_path: str):
    """Safely connect to DuckDB, handling empty/invalid files"""
    db_file = Path(db_path)
    if db_file.exists():
        # Check if file is empty (0 bytes)
        if db_file.stat().st_size == 0:
            db_file.unlink()  # Delete empty file
        else:
            # Try to connect to validate it's a valid DuckDB file
            try:
                test_con = duckdb.connect(db_path)
                test_con.close()
            except Exception:
                # File exists but is invalid - delete it
                db_file.unlink()
    
    return duckdb.connect(db_path)


def init_database(db_path: str) -> dict:
    """Initialize DuckDB database and schema"""
    try:
        con = safe_connect(db_path)
        
        # Create table if it doesn't exist
        con.execute("""
            CREATE TABLE IF NOT EXISTS run_trades (
                run_id TEXT NOT NULL,
                token TEXT NOT NULL,
                trade_id TEXT NOT NULL,
                entry_ts TIMESTAMP NOT NULL,
                exit_ts TIMESTAMP NOT NULL,
                entry_price REAL NOT NULL,
                exit_price REAL NOT NULL,
                pnl_pct REAL NOT NULL,
                exit_reason TEXT NOT NULL,
                PRIMARY KEY (run_id, trade_id)
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_run_trades_run_id 
            ON run_trades(run_id);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_run_trades_token 
            ON run_trades(token);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_run_trades_entry_ts 
            ON run_trades(entry_ts);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def insert_many(db_path: str, trades: list) -> dict:
    """Insert multiple trades"""
    try:
        con = safe_connect(db_path)
        
        for trade in trades:
            con.execute(
                """
                INSERT INTO run_trades (
                    run_id, token, trade_id, entry_ts, exit_ts,
                    entry_price, exit_price, pnl_pct, exit_reason
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (run_id, trade_id) DO UPDATE SET
                    token = EXCLUDED.token,
                    entry_ts = EXCLUDED.entry_ts,
                    exit_ts = EXCLUDED.exit_ts,
                    entry_price = EXCLUDED.entry_price,
                    exit_price = EXCLUDED.exit_price,
                    pnl_pct = EXCLUDED.pnl_pct,
                    exit_reason = EXCLUDED.exit_reason
                """,
                [
                    trade["run_id"],
                    trade["token"],
                    trade["trade_id"],
                    trade["entry_ts"],
                    trade["exit_ts"],
                    trade["entry_price"],
                    trade["exit_price"],
                    trade["pnl_pct"],
                    trade["exit_reason"],
                ]
            )
        
        con.close()
        
        return {"success": True, "count": len(trades)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def list_by_run_id(db_path: str, run_id: str, limit: int = 1000) -> dict:
    """List trades for a run"""
    try:
        con = safe_connect(db_path)
        
        results = con.execute(
            """
            SELECT run_id, token, trade_id, entry_ts, exit_ts,
                   entry_price, exit_price, pnl_pct, exit_reason
            FROM run_trades
            WHERE run_id = ?
            ORDER BY entry_ts DESC
            LIMIT ?
            """,
            [run_id, limit]
        ).fetchall()
        
        con.close()
        
        trades = []
        for row in results:
            trades.append({
                "run_id": row[0],
                "token": row[1],
                "trade_id": row[2],
                "entry_ts": row[3].isoformat() if row[3] else None,
                "exit_ts": row[4].isoformat() if row[4] else None,
                "entry_price": row[5],
                "exit_price": row[6],
                "pnl_pct": row[7],
                "exit_reason": row[8],
            })
        
        return {"trades": trades}
    except Exception as e:
        return {"error": str(e)}


def list_by_token(db_path: str, token: str, limit: int = 1000) -> dict:
    """List trades for a token"""
    try:
        con = safe_connect(db_path)
        
        results = con.execute(
            """
            SELECT run_id, token, trade_id, entry_ts, exit_ts,
                   entry_price, exit_price, pnl_pct, exit_reason
            FROM run_trades
            WHERE token = ?
            ORDER BY entry_ts DESC
            LIMIT ?
            """,
            [token, limit]
        ).fetchall()
        
        con.close()
        
        trades = []
        for row in results:
            trades.append({
                "run_id": row[0],
                "token": row[1],
                "trade_id": row[2],
                "entry_ts": row[3].isoformat() if row[3] else None,
                "exit_ts": row[4].isoformat() if row[4] else None,
                "entry_price": row[5],
                "exit_price": row[6],
                "pnl_pct": row[7],
                "exit_reason": row[8],
            })
        
        return {"trades": trades}
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB RunTradesRepository")
    parser.add_argument("--operation", required=True, choices=["init", "insert_many", "list_by_run_id", "list_by_token"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--run-id", help="Run ID")
    parser.add_argument("--token", help="Token address")
    parser.add_argument("--limit", type=int, default=1000, help="Limit for list operations")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "insert_many":
        if not args.data:
            print("ERROR: Data required for insert_many operation", file=sys.stderr)
            sys.exit(1)
        else:
            try:
                trades = json.loads(args.data)
                if not isinstance(trades, list):
                    trades = [trades]
                result = insert_many(args.db_path, trades)
            except (json.JSONDecodeError, ValueError, RuntimeError) as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)
                sys.exit(1)
    elif args.operation == "list_by_run_id":
        if not args.run_id:
            print("ERROR: run-id required for list_by_run_id operation", file=sys.stderr)
            sys.exit(1)
        result = list_by_run_id(args.db_path, args.run_id, args.limit)
    elif args.operation == "list_by_token":
        if not args.token:
            print("ERROR: token required for list_by_token operation", file=sys.stderr)
            sys.exit(1)
        result = list_by_token(args.db_path, args.token, args.limit)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

