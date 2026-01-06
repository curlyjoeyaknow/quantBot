#!/usr/bin/env python3
"""
Ingest Telegram export from a SINGLE result.json into DuckDB.

What it does
- Parses Telegram Desktop export-ish JSON (and a couple common variants)
- Stores raw messages into: raw.messages_f
- Optionally extracts "alerts" (mint mentions) into:
  - core.alerts_d
  - caller_links_d

Idempotent-ish:
- raw/messages: inserts only rows not already present for (chat_id, message_id)
- derived alerts: inserts only rows not already present for (chat_id, message_id, mint)

Usage:
  python3 ./scripts/ingest_telegram_result_json.py \
    --duckdb data/alerts.duckdb \
    --result-json /path/to/result.json \
    --chain solana \
    --extract-alerts

Notes
- This is NOT your full multi-file export ingester; it’s the “single result.json” version.
- Mint extraction is conservative: first Solana base58-like 32-44 char token found in text.

Tables created (if missing):
  raw.messages_f(
    chat_id BIGINT,
    message_id BIGINT,
    ts_ms BIGINT,
    dt_utc TIMESTAMP,
    from_name VARCHAR,
    text VARCHAR,
    json VARCHAR,
    source_file VARCHAR,
    parse_run_id VARCHAR
  )

  core.alerts_d(
    chat_id BIGINT,
    message_id BIGINT,
    alert_ts_ms BIGINT,
    alert_dt_utc TIMESTAMP,
    mint VARCHAR,
    caller_name VARCHAR,
    chain VARCHAR,
    source_system VARCHAR,
    parse_run_id VARCHAR
  )

  caller_links_d(
    trigger_chat_id TEXT,
    trigger_message_id BIGINT,
    trigger_ts_ms BIGINT,
    trigger_from_name VARCHAR,
    mint VARCHAR,
    chain VARCHAR,
    bot_message_id BIGINT,
    run_id TEXT
  )
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import duckdb

UTC = timezone.utc

# Solana base58 alphabet excludes 0,O,I,l
MINT_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")

def _to_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        if isinstance(x, bool):
            return int(x)
        if isinstance(x, (int,)):
            return int(x)
        if isinstance(x, float):
            return int(x)
        s = str(x).strip()
        if s == "":
            return None
        return int(float(s))
    except Exception:
        return None

def _parse_dt_any(d: Any) -> Optional[datetime]:
    """
    Accepts:
    - unix seconds (int/str)
    - ISO strings "2025-01-01T12:34:56" or "...Z"
    - Telegram export often has: "date": "2025-..." and/or "date_unixtime": "173..."
    """
    if d is None:
        return None

    # unix seconds?
    if isinstance(d, (int, float)) or (isinstance(d, str) and d.strip().isdigit()):
        sec = _to_int(d)
        if sec is None:
            return None
        return datetime.fromtimestamp(sec, tz=UTC)

    if isinstance(d, str):
        s = d.strip()
        if not s:
            return None
        # handle Z
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        # sometimes Telegram export uses "YYYY-MM-DD HH:MM:SS"
        if "T" not in s and " " in s and "+" not in s:
            try:
                dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
                return dt
            except Exception:
                pass
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(UTC)
        except Exception:
            return None

    return None

def _text_from_telegram_field(text_field: Any) -> str:
    """
    Telegram export "text" may be:
    - string
    - list of {type,text} objects and strings
    """
    if text_field is None:
        return ""
    if isinstance(text_field, str):
        return text_field
    if isinstance(text_field, list):
        parts: List[str] = []
        for item in text_field:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
            else:
                parts.append(str(item))
        return "".join(parts)
    return str(text_field)

def _extract_mint(text: str) -> Optional[str]:
    if not text:
        return None
    m = MINT_RE.search(text)
    return m.group(0) if m else None

def _iter_messages_from_result(obj: Dict[str, Any], chat_title_filter: Optional[str]) -> Iterable[Tuple[int, Dict[str, Any]]]:
    """
    Yields: (chat_id, message_obj)
    Handles a few shapes:
    1) { "id": 123, "messages": [...] }
    2) { "messages": [...]} (chat_id unknown -> 0)
    3) { "chats": { "list": [ { "id":..., "name":..., "messages":[...] }, ... ] } }
    """
    if isinstance(obj.get("messages"), list):
        chat_id = _to_int(obj.get("id")) or 0
        for msg in obj["messages"]:
            if isinstance(msg, dict):
                yield (chat_id, msg)
        return

    chats = obj.get("chats")
    if isinstance(chats, dict) and isinstance(chats.get("list"), list):
        for chat in chats["list"]:
            if not isinstance(chat, dict):
                continue
            name = str(chat.get("name") or chat.get("title") or "")
            if chat_title_filter and chat_title_filter.lower() not in name.lower():
                continue
            chat_id = _to_int(chat.get("id")) or 0
            msgs = chat.get("messages")
            if isinstance(msgs, list):
                for msg in msgs:
                    if isinstance(msg, dict):
                        yield (chat_id, msg)
        return

    # fallback: nothing found
    return

def ensure_tables(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS raw")
    con.execute("CREATE SCHEMA IF NOT EXISTS core")

    con.execute("""
        CREATE TABLE IF NOT EXISTS raw.messages_f(
          chat_id BIGINT,
          message_id BIGINT,
          ts_ms BIGINT,
          dt_utc TIMESTAMP,
          from_name VARCHAR,
          text VARCHAR,
          json VARCHAR,
          source_file VARCHAR,
          parse_run_id VARCHAR
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS core.alerts_d(
          chat_id BIGINT,
          message_id BIGINT,
          alert_ts_ms BIGINT,
          alert_dt_utc TIMESTAMP,
          mint VARCHAR,
          caller_name VARCHAR,
          chain VARCHAR,
          source_system VARCHAR,
          parse_run_id VARCHAR
        )
    """)

    # Note: caller_links_d already exists with a richer schema.
    # The INSERT below uses only the columns needed for this ingest script.
    # Primary key is (trigger_chat_id, trigger_message_id, bot_message_id, run_id)
    # For simple ingests without bot replies, we use trigger_message_id as bot_message_id.
    con.execute("""
        CREATE TABLE IF NOT EXISTS caller_links_d(
          trigger_chat_id TEXT NOT NULL,
          trigger_message_id BIGINT NOT NULL,
          trigger_ts_ms BIGINT,
          trigger_from_name VARCHAR,
          mint VARCHAR,
          chain VARCHAR,
          bot_message_id BIGINT NOT NULL,
          run_id TEXT NOT NULL DEFAULT 'legacy',
          inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (trigger_chat_id, trigger_message_id, bot_message_id, run_id)
        )
    """)

def ingest(
    duckdb_path: str,
    result_json_path: str,
    chain: str,
    source_system: str,
    parse_run_id: str,
    chat_id_override: Optional[int],
    chat_title_filter: Optional[str],
    extract_alerts: bool,
    dry_run: bool,
    max_messages: Optional[int],
) -> None:
    with open(result_json_path, "r", encoding="utf-8") as f:
        obj = json.load(f)

    con = duckdb.connect(duckdb_path)
    try:
        ensure_tables(con)

        raw_inserts = 0
        raw_skipped = 0
        alerts_inserts = 0
        alerts_skipped = 0

        seen = 0

        for chat_id, msg in _iter_messages_from_result(obj, chat_title_filter):
            if chat_id_override is not None:
                chat_id = chat_id_override

            message_id = _to_int(msg.get("id") or msg.get("message_id") or msg.get("mid"))
            if message_id is None:
                continue

            # timestamps
            dt = None
            if msg.get("date_unixtime") is not None:
                dt = _parse_dt_any(msg.get("date_unixtime"))
            if dt is None and msg.get("date") is not None:
                dt = _parse_dt_any(msg.get("date"))
            if dt is None and msg.get("timestamp") is not None:
                dt = _parse_dt_any(msg.get("timestamp"))
            if dt is None:
                # no timestamp -> skip (better than writing nonsense)
                continue
            ts_ms = int(dt.timestamp() * 1000)

            from_name = (msg.get("from") or msg.get("from_name") or msg.get("sender") or msg.get("author") or "")
            if isinstance(from_name, dict):
                from_name = from_name.get("name") or from_name.get("username") or ""
            from_name = str(from_name).strip()

            text = _text_from_telegram_field(msg.get("text"))
            # Some exports use "text_entities"; if text is empty, try "caption"
            if not text:
                text = _text_from_telegram_field(msg.get("caption"))
            text = text.strip()

            msg_json = json.dumps(msg, ensure_ascii=False)

            # raw insert if missing
            exists = con.execute(
                "SELECT 1 FROM raw.messages_f WHERE chat_id=? AND message_id=? LIMIT 1",
                [chat_id, message_id],
            ).fetchone()
            if exists:
                raw_skipped += 1
            else:
                raw_inserts += 1
                if not dry_run:
                    con.execute(
                        """
                        INSERT INTO raw.messages_f
                          (chat_id, message_id, ts_ms, dt_utc, from_name, text, json, source_file, parse_run_id)
                        VALUES (?, ?, ?, to_timestamp(?/1000.0), ?, ?, ?, ?, ?)
                        """,
                        [
                            chat_id,
                            message_id,
                            ts_ms,
                            ts_ms,
                            from_name,
                            text,
                            msg_json,
                            os.path.abspath(result_json_path),
                            parse_run_id,
                        ],
                    )

            if extract_alerts:
                mint = _extract_mint(text)
                if mint:
                    # derived alerts insert if missing
                    a_exists = con.execute(
                        """
                        SELECT 1
                        FROM core.alerts_d
                        WHERE chat_id=? AND message_id=? AND mint=?
                        LIMIT 1
                        """,
                        [chat_id, message_id, mint],
                    ).fetchone()

                    if a_exists:
                        alerts_skipped += 1
                    else:
                        alerts_inserts += 1
                        if not dry_run:
                            con.execute(
                                """
                                INSERT INTO core.alerts_d
                                  (chat_id, message_id, alert_ts_ms, alert_dt_utc, mint, caller_name, chain, source_system, parse_run_id)
                                VALUES (?, ?, ?, to_timestamp(?/1000.0), ?, ?, ?, ?, ?)
                                """,
                                [
                                    chat_id,
                                    message_id,
                                    ts_ms,
                                    ts_ms,
                                    mint,
                                    from_name,
                                    chain,
                                    source_system,
                                    parse_run_id,
                                ],
                            )
                            con.execute(
                                """
                                INSERT INTO caller_links_d
                                  (trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_name, mint, chain, bot_message_id, run_id)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                [
                                    str(chat_id),  # trigger_chat_id (TEXT)
                                    message_id,    # trigger_message_id
                                    ts_ms,         # trigger_ts_ms
                                    from_name,     # trigger_from_name
                                    mint,          # mint
                                    chain,         # chain
                                    message_id,    # bot_message_id (use same as trigger for simple ingests)
                                    parse_run_id,  # run_id
                                ],
                            )

            seen += 1
            if max_messages and seen >= max_messages:
                break

        if not dry_run:
            con.commit()

        print(f"[ok] parse_run_id={parse_run_id}")
        print(f"[raw] inserted={raw_inserts} skipped_existing={raw_skipped}")
        if extract_alerts:
            print(f"[alerts] inserted={alerts_inserts} skipped_existing={alerts_skipped}")
        else:
            print("[alerts] disabled")
        if dry_run:
            print("[dry-run] no changes committed")

    finally:
        con.close()

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duckdb", required=True, help="DuckDB path (e.g. data/alerts.duckdb)")
    ap.add_argument("--result-json", required=True, help="Path to single Telegram result.json")
    ap.add_argument("--chain", default="solana")
    ap.add_argument("--source-system", default="telegram")
    ap.add_argument("--parse-run-id", default=None)
    ap.add_argument("--chat-id", type=int, default=None, help="Override chat_id (when file lacks it)")
    ap.add_argument("--chat-title-filter", default=None, help="When file has chats.list, only ingest chats whose name contains this substring")
    ap.add_argument("--extract-alerts", action="store_true", help="Extract mint mentions into core.alerts_d + caller_links_d")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-messages", type=int, default=None)
    args = ap.parse_args()

    parse_run_id = args.parse_run_id or str(uuid.uuid4())

    ingest(
        duckdb_path=args.duckdb,
        result_json_path=args.result_json,
        chain=args.chain,
        source_system=args.source_system,
        parse_run_id=parse_run_id,
        chat_id_override=args.chat_id,
        chat_title_filter=args.chat_title_filter,
        extract_alerts=args.extract_alerts,
        dry_run=args.dry_run,
        max_messages=args.max_messages,
    )

if __name__ == "__main__":
    main()
