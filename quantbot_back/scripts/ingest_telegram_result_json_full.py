#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import duckdb

UTC = timezone.utc

# Solana base58-like (Telegram text tends to be noisy; keep conservative but useful)
MINT_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")

HANDLE_RE = re.compile(r"@([A-Za-z0-9_]{3,32})")
WS_RE = re.compile(r"\s+")

ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"), None)


# ----------------------------
# Normalization helpers
# ----------------------------
def norm_ws(s: str) -> str:
    s = (s or "").translate(ZERO_WIDTH)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = WS_RE.sub(" ", s).strip()
    return s


def norm_caller(raw: str) -> str:
    """
    Caller normalization:
    - collapse whitespace
    - strip obvious separators
    - keep emojis in raw, but norm version is simplified for grouping
    """
    s = norm_ws(raw)
    # Remove common suffix fragments that blow up grouping
    # e.g. "Name | @handle", "Name || 010 ETH/SO"
    for sep in ["||", "|", "—", "–", "•"]:
        if sep in s:
            left = s.split(sep, 1)[0].strip()
            if len(left) >= 2:
                s = left
                break
    return s.lower()


def extract_handle(text: str) -> Optional[str]:
    m = HANDLE_RE.search(text or "")
    return f"@{m.group(1)}" if m else None


def stable_chat_id(title: str, fallback: int = 0) -> int:
    """
    Stable BIGINT chat_id from title when export doesn't give numeric chat id.
    """
    t = norm_ws(title)
    if not t:
        return fallback
    h = hashlib.sha256(t.encode("utf-8")).hexdigest()[:16]
    # Fit into signed 63-bit
    return int(h, 16) & ((1 << 63) - 1)


def to_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        if isinstance(x, bool):
            return int(x)
        if isinstance(x, int):
            return int(x)
        if isinstance(x, float):
            return int(x)
        s = str(x).strip()
        if not s:
            return None
        # sometimes "12345" or "12345.0"
        return int(float(s))
    except Exception:
        return None


def parse_dt_any(msg: Dict[str, Any]) -> Optional[datetime]:
    """
    Accepts:
    - date_unixtime (seconds)
    - date (ISO or "YYYY-MM-DD HH:MM:SS")
    - timestamp / ts / time (seconds)
    - timestamp_ms / ts_ms (ms)
    """
    # ms-first if present
    for k in ["timestamp_ms", "ts_ms", "time_ms"]:
        if k in msg and msg[k] is not None:
            ms = to_int(msg.get(k))
            if ms is None:
                continue
            return datetime.fromtimestamp(ms / 1000.0, tz=UTC)

    # seconds keys
    for k in ["date_unixtime", "timestamp", "ts", "time", "unix", "unix_time"]:
        if k in msg and msg[k] is not None:
            sec = to_int(msg.get(k))
            if sec is None:
                continue
            # guard: sometimes it's already ms
            if sec > 10_000_000_000:
                return datetime.fromtimestamp(sec / 1000.0, tz=UTC)
            return datetime.fromtimestamp(sec, tz=UTC)

    # ISO-like keys
    for k in ["date", "datetime", "created_at"]:
        v = msg.get(k)
        if v is None:
            continue
        if isinstance(v, str):
            s = v.strip()
            if not s:
                continue
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            if "T" not in s and " " in s and "+" not in s:
                # "YYYY-MM-DD HH:MM:SS"
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
                continue

    return None


def flatten_text_field(text_field: Any) -> str:
    """
    Telegram export "text" can be:
    - string
    - list of strings and dicts with {type,text}
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
                    # sometimes dicts contain url or other fields
                    if "href" in item and isinstance(item.get("href"), str):
                        parts.append(item["href"])
            else:
                parts.append(str(item))
        return "".join(parts)
    return str(text_field)


def extract_mints_all(text: str) -> List[str]:
    if not text:
        return []
    # preserve order, dedupe
    seen = set()
    out: List[str] = []
    for m in MINT_RE.findall(text):
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


# ----------------------------
# Telegram JSON shape handling
# ----------------------------
def iter_messages_from_result(root: Any, chat_title_filter: Optional[str]) -> Iterable[Tuple[int, str, Dict[str, Any]]]:
    """
    Yields (chat_id, chat_title, message_dict)

    Supports:
    1) { "id": <chatid>, "name": <title>, "messages": [...] }
    2) { "messages": [...] } (chat_id derived from title or 0)
    3) { "chats": { "list": [ { "id":..., "name":..., "messages":[...] }, ... ] } }
    4) [ ...messages... ] (chat_id=0)
    """
    if isinstance(root, list):
        for msg in root:
            if isinstance(msg, dict):
                yield (0, "", msg)
        return

    if not isinstance(root, dict):
        return

    # direct messages list
    if isinstance(root.get("messages"), list):
        title = str(root.get("name") or root.get("title") or "")
        chat_id = to_int(root.get("id")) or stable_chat_id(title, fallback=0)
        for msg in root["messages"]:
            if isinstance(msg, dict):
                yield (chat_id, title, msg)
        return

    chats = root.get("chats")
    if isinstance(chats, dict) and isinstance(chats.get("list"), list):
        for chat in chats["list"]:
            if not isinstance(chat, dict):
                continue
            title = str(chat.get("name") or chat.get("title") or "")
            if chat_title_filter and chat_title_filter.lower() not in title.lower():
                continue
            chat_id = to_int(chat.get("id")) or stable_chat_id(title, fallback=0)
            msgs = chat.get("messages")
            if isinstance(msgs, list):
                for msg in msgs:
                    if isinstance(msg, dict):
                        yield (chat_id, title, msg)
        return

    # nothing matched
    return


# ----------------------------
# DuckDB schema-adaptive insert
# ----------------------------
def table_columns(con: duckdb.DuckDBPyConnection, table: str) -> List[str]:
    # table can be schema.table or just table
    rows = con.execute(f"PRAGMA table_info('{table}')").fetchall()
    # row: (cid, name, type, notnull, dflt_value, pk)
    return [r[1] for r in rows]


def ensure_tables(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS raw")
    con.execute("CREATE SCHEMA IF NOT EXISTS telegram")

    # Raw normalized messages
    con.execute("""
      CREATE TABLE IF NOT EXISTS raw.telegram_messages_f(
        chat_id BIGINT,
        chat_title VARCHAR,
        message_id BIGINT,
        ts_ms BIGINT,
        dt_utc TIMESTAMP,
        from_name_raw VARCHAR,
        from_name_norm VARCHAR,
        handle VARCHAR,
        text VARCHAR,
        json VARCHAR,
        source_file VARCHAR,
        parse_run_id VARCHAR
      )
    """)

    # Caller dimension (for stable grouping)
    con.execute("""
      CREATE TABLE IF NOT EXISTS telegram.callers_d(
        from_name_raw VARCHAR,
        from_name_norm VARCHAR,
        handle VARCHAR,
        first_seen_ts_ms BIGINT,
        last_seen_ts_ms BIGINT,
        source_system VARCHAR,
        parse_run_id VARCHAR
      )
    """)

    # Your standard derived tables (create if missing; if already exists, we adapt)
    con.execute("""
      CREATE TABLE IF NOT EXISTS caller_links_d(
        chat_id BIGINT,
        trigger_message_id BIGINT,
        trigger_ts_ms BIGINT,
        trigger_from_name VARCHAR,
        caller_name VARCHAR,
        caller_norm VARCHAR,
        handle VARCHAR,
        mint VARCHAR,
        chain VARCHAR,
        source_system VARCHAR,
        parse_run_id VARCHAR,
        message_text VARCHAR
      )
    """)

    con.execute("""
      CREATE TABLE IF NOT EXISTS user_calls_d(
        chat_id BIGINT,
        message_id BIGINT,
        call_ts_ms BIGINT,
        call_datetime TIMESTAMP,
        caller_name VARCHAR,
        caller_norm VARCHAR,
        handle VARCHAR,
        mint VARCHAR,
        chain VARCHAR,
        source_system VARCHAR,
        parse_run_id VARCHAR,
        text VARCHAR
      )
    """)


def exists_by_key(con: duckdb.DuckDBPyConnection, table: str, key_cols: Sequence[str], key_vals: Sequence[Any]) -> bool:
    where = " AND ".join([f"{c}=?" for c in key_cols])
    q = f"SELECT 1 FROM {table} WHERE {where} LIMIT 1"
    return con.execute(q, list(key_vals)).fetchone() is not None


def insert_row_adaptive(con: duckdb.DuckDBPyConnection, table: str, row: Dict[str, Any]) -> None:
    cols = table_columns(con, table)
    usable = [c for c in row.keys() if c in cols]
    if not usable:
        return
    placeholders = ", ".join(["?"] * len(usable))
    collist = ", ".join(usable)
    vals = [row[c] for c in usable]
    con.execute(f"INSERT INTO {table} ({collist}) VALUES ({placeholders})", vals)


# ----------------------------
# Main ingestion
# ----------------------------
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
        root = json.load(f)

    con = duckdb.connect(duckdb_path)
    try:
        ensure_tables(con)

        inserted_raw = 0
        skipped_raw = 0
        inserted_calls = 0
        skipped_calls = 0
        inserted_links = 0
        skipped_links = 0
        upserted_callers = 0

        n_seen = 0

        for chat_id, chat_title, msg in iter_messages_from_result(root, chat_title_filter):
            if chat_id_override is not None:
                chat_id = chat_id_override

            # message id normalization
            message_id = to_int(msg.get("id") or msg.get("message_id") or msg.get("mid"))
            if message_id is None:
                continue

            # timestamp normalization
            dt = parse_dt_any(msg)
            if dt is None:
                continue
            ts_ms = int(dt.timestamp() * 1000)

            # from/caller normalization
            from_raw = msg.get("from") or msg.get("from_name") or msg.get("sender") or msg.get("author") or ""
            if isinstance(from_raw, dict):
                from_raw = from_raw.get("name") or from_raw.get("username") or ""
            from_raw = norm_ws(str(from_raw))
            from_norm = norm_caller(from_raw) if from_raw else ""
            handle = extract_handle(from_raw) or extract_handle(flatten_text_field(msg.get("text"))) or None

            # text normalization (flatten + normalize whitespace)
            text = flatten_text_field(msg.get("text"))
            if not text:
                text = flatten_text_field(msg.get("caption"))
            text = norm_ws(text)

            msg_json = json.dumps(msg, ensure_ascii=False)

            # ---- raw table (idempotent on chat_id+message_id)
            if exists_by_key(con, "raw.telegram_messages_f", ["chat_id", "message_id"], [chat_id, message_id]):
                skipped_raw += 1
            else:
                inserted_raw += 1
                if not dry_run:
                    insert_row_adaptive(con, "raw.telegram_messages_f", {
                        "chat_id": chat_id,
                        "chat_title": chat_title,
                        "message_id": message_id,
                        "ts_ms": ts_ms,
                        "dt_utc": dt.replace(tzinfo=None),  # DuckDB TIMESTAMP is naive; treat as UTC
                        "from_name_raw": from_raw,
                        "from_name_norm": from_norm,
                        "handle": handle,
                        "text": text,
                        "json": msg_json,
                        "source_file": os.path.abspath(result_json_path),
                        "parse_run_id": parse_run_id,
                    })

            # ---- caller dimension upsert-ish (best-effort)
            if from_raw:
                # Try to update caller stats; if not present, insert
                # Use (from_name_raw, source_system) as key to avoid merging unrelated raw aliases
                key_exists = con.execute(
                    "SELECT 1 FROM telegram.callers_d WHERE from_name_raw=? AND source_system=? LIMIT 1",
                    [from_raw, source_system],
                ).fetchone() is not None

                if not dry_run:
                    if not key_exists:
                        insert_row_adaptive(con, "telegram.callers_d", {
                            "from_name_raw": from_raw,
                            "from_name_norm": from_norm,
                            "handle": handle,
                            "first_seen_ts_ms": ts_ms,
                            "last_seen_ts_ms": ts_ms,
                            "source_system": source_system,
                            "parse_run_id": parse_run_id,
                        })
                        upserted_callers += 1
                    else:
                        con.execute(
                            """
                            UPDATE telegram.callers_d
                            SET
                              from_name_norm = COALESCE(NULLIF(from_name_norm,''), ?),
                              handle = COALESCE(handle, ?),
                              first_seen_ts_ms = LEAST(first_seen_ts_ms, ?),
                              last_seen_ts_ms  = GREATEST(last_seen_ts_ms,  ?)
                            WHERE from_name_raw=? AND source_system=?
                            """,
                            [from_norm, handle, ts_ms, ts_ms, from_raw, source_system],
                        )

            # ---- derived: alerts (mint extraction)
            if extract_alerts:
                mints = extract_mints_all(text)
                if mints:
                    for mint in mints:
                        # caller_links_d idempotent on (chat_id, trigger_message_id, mint)
                        if exists_by_key(con, "caller_links_d", ["chat_id", "trigger_message_id", "mint"], [chat_id, message_id, mint]):
                            skipped_links += 1
                        else:
                            inserted_links += 1
                            if not dry_run:
                                insert_row_adaptive(con, "caller_links_d", {
                                    "chat_id": chat_id,
                                    "trigger_message_id": message_id,
                                    "trigger_ts_ms": ts_ms,
                                    "trigger_from_name": from_raw,
                                    "caller_name": from_raw,
                                    "caller_norm": from_norm,
                                    "handle": handle,
                                    "mint": mint,
                                    "chain": chain,
                                    "source_system": source_system,
                                    "parse_run_id": parse_run_id,
                                    "message_text": text,
                                })

                        # user_calls_d idempotent on (chat_id, message_id, mint)
                        if exists_by_key(con, "user_calls_d", ["chat_id", "message_id", "mint"], [chat_id, message_id, mint]):
                            skipped_calls += 1
                        else:
                            inserted_calls += 1
                            if not dry_run:
                                insert_row_adaptive(con, "user_calls_d", {
                                    "chat_id": chat_id,
                                    "message_id": message_id,
                                    "call_ts_ms": ts_ms,
                                    "call_datetime": dt.replace(tzinfo=None),
                                    "caller_name": from_raw,
                                    "caller_norm": from_norm,
                                    "handle": handle,
                                    "mint": mint,
                                    "chain": chain,
                                    "source_system": source_system,
                                    "parse_run_id": parse_run_id,
                                    "text": text,
                                })

            n_seen += 1
            if max_messages and n_seen >= max_messages:
                break

        if not dry_run:
            con.commit()

        print(f"[ok] parse_run_id={parse_run_id}")
        print(f"[raw.telegram_messages_f] inserted={inserted_raw} skipped_existing={skipped_raw}")
        print(f"[telegram.callers_d] upserts/first_inserts={upserted_callers} (plus updates)")
        if extract_alerts:
            print(f"[caller_links_d] inserted={inserted_links} skipped_existing={skipped_links}")
            print(f"[user_calls_d]   inserted={inserted_calls} skipped_existing={skipped_calls}")
        else:
            print("[derived alerts] disabled (no mint extraction)")

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
    ap.add_argument("--extract-alerts", action="store_true", help="Extract ALL mint-like tokens into caller_links_d + user_calls_d")
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
