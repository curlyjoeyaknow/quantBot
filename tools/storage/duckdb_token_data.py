#!/usr/bin/env python3
"""
DuckDB TokenDataRepository - OHLCV Coverage Tracking
Tracks which tokens have OHLCV data in ClickHouse and coverage statistics.
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
        
        con.execute("""
            CREATE TABLE IF NOT EXISTS token_data (
                mint TEXT NOT NULL,
                chain TEXT NOT NULL,
                interval TEXT NOT NULL,
                earliest_timestamp TIMESTAMP,
                latest_timestamp TIMESTAMP,
                candle_count INTEGER NOT NULL DEFAULT 0,
                coverage_percent DOUBLE NOT NULL DEFAULT 0,
                last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (mint, chain, interval)
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_token_data_mint 
            ON token_data(mint);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_token_data_chain 
            ON token_data(chain);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_token_data_interval 
            ON token_data(interval);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_coverage(db_path: str, data: dict) -> dict:
    """Upsert OHLCV coverage record"""
    try:
        con = safe_connect(db_path)
        
        mint = data.get("mint")
        chain = data.get("chain")
        interval = data.get("interval")
        earliest_timestamp = data.get("earliest_timestamp")
        latest_timestamp = data.get("latest_timestamp")
        candle_count = data.get("candle_count", 0)
        coverage_percent = data.get("coverage_percent", 0.0)
        
        con.execute("""
            INSERT INTO token_data (
                mint, chain, interval, earliest_timestamp, latest_timestamp,
                candle_count, coverage_percent, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (mint, chain, interval)
            DO UPDATE SET
                earliest_timestamp = COALESCE(EXCLUDED.earliest_timestamp, token_data.earliest_timestamp),
                latest_timestamp = COALESCE(EXCLUDED.latest_timestamp, token_data.latest_timestamp),
                candle_count = EXCLUDED.candle_count,
                coverage_percent = EXCLUDED.coverage_percent,
                last_updated = CURRENT_TIMESTAMP
        """, (
            mint,
            chain,
            interval,
            earliest_timestamp,
            latest_timestamp,
            candle_count,
            coverage_percent,
        ))
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_coverage(db_path: str, mint: str, chain: str, interval: str) -> dict:
    """Get OHLCV coverage for a token"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute("""
            SELECT 
                mint, chain, interval,
                earliest_timestamp, latest_timestamp,
                candle_count, coverage_percent, last_updated
            FROM token_data
            WHERE mint = ? AND chain = ? AND interval = ?
        """, (mint, chain, interval)).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "mint": result[0],
            "chain": result[1],
            "interval": result[2],
            "earliest_timestamp": result[3].isoformat() if result[3] else None,
            "latest_timestamp": result[4].isoformat() if result[4] else None,
            "candle_count": result[5],
            "coverage_percent": float(result[6]),
            "last_updated": result[7].isoformat(),
        }
    except Exception as e:
        return {"error": str(e)}


def list_coverage(db_path: str, chain: str = None, interval: str = None, min_coverage: float = None) -> dict:
    """List all tokens with OHLCV coverage"""
    try:
        con = safe_connect(db_path)
        
        query = """
            SELECT 
                mint, chain, interval,
                earliest_timestamp, latest_timestamp,
                candle_count, coverage_percent, last_updated
            FROM token_data
            WHERE 1=1
        """
        
        params = []
        
        if chain:
            query += " AND chain = ?"
            params.append(chain)
        
        if interval:
            query += " AND interval = ?"
            params.append(interval)
        
        if min_coverage is not None:
            query += " AND coverage_percent >= ?"
            params.append(min_coverage)
        
        query += " ORDER BY last_updated DESC"
        
        results = con.execute(query, params).fetchall()
        
        con.close()
        
        return [
            {
                "mint": row[0],
                "chain": row[1],
                "interval": row[2],
                "earliest_timestamp": row[3].isoformat() if row[3] else None,
                "latest_timestamp": row[4].isoformat() if row[4] else None,
                "candle_count": row[5],
                "coverage_percent": float(row[6]),
                "last_updated": row[7].isoformat(),
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB TokenDataRepository")
    parser.add_argument("--operation", required=True, choices=["init", "upsert", "get", "list"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--mint", help="Token mint address")
    parser.add_argument("--chain", help="Chain name")
    parser.add_argument("--interval", help="Candle interval")
    parser.add_argument("--min-coverage", type=float, help="Minimum coverage percent")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "upsert":
        if not args.data:
            result = {"success": False, "error": "Data required for upsert operation"}
        else:
            try:
                data = json.loads(args.data)
                result = upsert_coverage(args.db_path, data)
            except json.JSONDecodeError as e:
                result = {"success": False, "error": f"Invalid JSON: {str(e)}"}
    elif args.operation == "get":
        if not args.mint or not args.chain or not args.interval:
            result = None
        else:
            result = get_coverage(args.db_path, args.mint, args.chain, args.interval)
    elif args.operation == "list":
        result = list_coverage(args.db_path, args.chain, args.interval, args.min_coverage)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

