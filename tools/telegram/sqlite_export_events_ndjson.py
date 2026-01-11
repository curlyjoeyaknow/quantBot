#!/usr/bin/env python3

import argparse
import json
import sqlite3
from typing import Any, Dict

def row_to_dict(cur: sqlite3.Cursor, row: sqlite3.Row) -> Dict[str, Any]:
    return {k: row[k] for k in row.keys()}

def emit(f, event_type: str, payload: Dict[str, Any]):
    f.write(json.dumps({"type": event_type, "payload": payload}, ensure_ascii=False) + "\n")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="sqlite db path")
    ap.add_argument("--out", required=True, help="output ndjson path")
    ap.add_argument("--since-ms", type=int, default=None, help="optional lower bound timestamp (ms) filter")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    with open(args.out, "w", encoding="utf-8") as f:
        # 1) User calls (alerts/triggers)
        alert_sql = "SELECT * FROM user_calls"
        params = []
        if args.since_ms is not None:
            alert_sql += " WHERE call_ts_ms >= ?"
            params.append(args.since_ms)
        try:
            for row in cur.execute(alert_sql, params):
                emit(f, "user_call", row_to_dict(cur, row))
        except sqlite3.OperationalError as e:
            emit(f, "warning", {"table": "user_calls", "error": str(e)})

        # 2) Bot observations
        obs_sql = "SELECT * FROM bot_observations"
        params = []
        if args.since_ms is not None:
            obs_sql += " WHERE observed_at_ms >= ?"
            params.append(args.since_ms)
        try:
            for row in cur.execute(obs_sql, params):
                emit(f, "bot_observation", row_to_dict(cur, row))
        except sqlite3.OperationalError as e:
            emit(f, "warning", {"table": "bot_observations", "error": str(e)})

        # 3) Token metadata (slow-changing)
        try:
            for row in cur.execute("SELECT * FROM tokens_metadata"):
                emit(f, "token_metadata", row_to_dict(cur, row))
        except sqlite3.OperationalError as e:
            emit(f, "warning", {"table": "tokens_metadata", "error": str(e)})

        # 4) Token data (time series)
        dyn_sql = "SELECT * FROM tokens_data"
        params = []
        if args.since_ms is not None:
            dyn_sql += " WHERE last_update >= datetime(?, 'unixepoch', 'localtime')"
            params.append(args.since_ms / 1000)
        try:
            for row in cur.execute(dyn_sql, params):
                emit(f, "token_data", row_to_dict(cur, row))
        except sqlite3.OperationalError as e:
            emit(f, "warning", {"table": "tokens_data", "error": str(e)})

        # 5) Quarantine/conflicts
        q_sql = "SELECT * FROM token_quarantine"
        params = []
        if args.since_ms is not None:
            q_sql += " WHERE created_at >= datetime(?, 'unixepoch', 'localtime')"
            params.append(args.since_ms / 1000)
        try:
            for row in cur.execute(q_sql, params):
                emit(f, "token_quarantine", row_to_dict(cur, row))
        except sqlite3.OperationalError as e:
            emit(f, "warning", {"table": "token_quarantine", "error": str(e)})

    conn.close()

if __name__ == "__main__":
    main()

