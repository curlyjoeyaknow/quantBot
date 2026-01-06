#!/usr/bin/env python3
"""
Telegram result.json ingestion (PHANES-ONLY, bot-only extraction)

Rules (per spec):
- Process ONLY messages where from_name matches "PHANES" (case-insensitive).
- Extract addresses ONLY from PHANES messages (never from user messages).
- Chain/type extraction:
    - Extract FIRST hashtag token as type_tag (e.g. #sol/#eth/#base...)
    - Derive chain:
        - #sol -> solana
        - any other hashtag -> evm
    - Fallback ONLY if hashtag missing:
        - base58-ish (Sol mint) -> solana
        - 0x + 40 hex -> evm
    - If still undecidable, chain='unknown' (but still store)
- Link each PHANES message back to ORIGINAL user message by walking reply_to_message_id backwards
  until reaching first non-PHANES message.
- If no reply chain exists -> DROP (no proximity guesses).

Outputs (DuckDB):
- raw.messages_f: all messages ingested (audit)
- core.alerts_d: original (non-PHANES) trigger messages that PHANES replied to
- caller_links_d: linkage rows with extracted address + chain/tag

Usage:
  python3 scripts/ingest_telegram_result_json_bot_only.py \
    --duckdb data/alerts.duckdb \
    --result-json /path/to/result.json

If your export does not include a chat id at the top-level / chat object, supply:
  --chat-id 123456789
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import duckdb

UTC = timezone.utc

# Match "Phanes" anywhere in the name (e.g., "Phanes [Gold]", "PHANES", etc.)
PHANES_RE = re.compile(r"phanes", re.IGNORECASE)

EVM_RE = re.compile(r"\b0x[a-fA-F0-9]{40}\b")
BASE58_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
HASHTAG_RE = re.compile(r"(?:^|\s)(#[A-Za-z0-9_]+)")

def now_utc() -> datetime:
    return datetime.now(UTC)

def to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)

def norm_text(t: Any) -> str:
    """Telegram export text can be string or list of strings/dicts with 'text'."""
    if t is None:
        return ""
    if isinstance(t, str):
        return t
    if isinstance(t, list):
        parts: List[str] = []
        for item in t:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                txt = item.get("text")
                if isinstance(txt, str):
                    parts.append(txt)
            else:
                parts.append(str(item))
        return "".join(parts)
    if isinstance(t, dict):
        txt = t.get("text")
        return txt if isinstance(txt, str) else json.dumps(t, ensure_ascii=False)
    return str(t)

def get_message_id(m: Dict[str, Any]) -> Optional[int]:
    mid = m.get("id")
    if isinstance(mid, int):
        return mid
    if isinstance(mid, str) and mid.isdigit():
        return int(mid)
    return None

def parse_date_to_ms(m: Dict[str, Any]) -> Optional[int]:
    d_ux = m.get("date_unixtime")
    if isinstance(d_ux, str) and d_ux.isdigit():
        return int(d_ux) * 1000
    if isinstance(d_ux, int):
        return int(d_ux) * 1000

    ds = m.get("date")
    if isinstance(ds, str):
        try:
            dt = datetime.fromisoformat(ds.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return to_ms(dt.astimezone(UTC))
        except Exception:
            return None
    return None

def sender_name(m: Dict[str, Any]) -> str:
    fn = m.get("from")
    if isinstance(fn, str):
        return fn.strip()
    a = m.get("actor")
    if isinstance(a, str):
        return a.strip()
    return ""

def reply_to_message_id(m: Dict[str, Any]) -> Optional[int]:
    r = m.get("reply_to_message_id")
    if isinstance(r, int):
        return r
    if isinstance(r, str) and r.isdigit():
        return int(r)
    reply = m.get("reply_to")
    if isinstance(reply, dict):
        x = reply.get("message_id")
        if isinstance(x, int):
            return x
        if isinstance(x, str) and x.isdigit():
            return int(x)
    return None

def first_hashtag(text: str) -> Optional[str]:
    m = HASHTAG_RE.search(text or "")
    if not m:
        return None
    return m.group(1)

def normalize_tag(tag: str) -> str:
    return tag.strip().lower()

def chain_from_tag(tag: str) -> str:
    t = normalize_tag(tag)
    if t == "#sol":
        return "solana"
    return "evm"

def chain_from_address_shape(addr: str) -> Optional[str]:
    if addr.startswith("0x") and len(addr) == 42:
        return "evm"
    if BASE58_RE.fullmatch(addr):
        return "solana"
    return None

def first_address(text: str) -> Optional[str]:
    """Extract FIRST address only (earliest appearance)."""
    if not text:
        return None
    evm = EVM_RE.search(text)
    b58 = BASE58_RE.search(text)
    if evm and b58:
        return evm.group(0) if evm.start() < b58.start() else b58.group(0)
    if evm:
        return evm.group(0)
    if b58:
        return b58.group(0)
    return None

def is_phanes(name: str) -> bool:
    return bool(PHANES_RE.match((name or "").strip()))

@dataclass
class Msg:
    chat_id: int
    message_id: int
    ts_ms: int
    from_name: str
    text: str
    reply_to_id: Optional[int]
    raw_json: str

def iter_messages_from_result_json(root: Dict[str, Any]) -> Iterable[Tuple[Optional[int], Dict[str, Any]]]:
    """
    Supports:
      - single chat export: root["messages"]
      - multi chat export: root["chats"]["list"][i]["messages"]
    Yields: (chat_id_or_none, msg_dict)
    """
    chats = root.get("chats")
    if isinstance(chats, dict):
        lst = chats.get("list")
        if isinstance(lst, list):
            for chat in lst:
                cid = chat.get("id")
                chat_id: Optional[int] = None
                if isinstance(cid, int):
                    chat_id = cid
                elif isinstance(cid, str) and cid.isdigit():
                    chat_id = int(cid)

                msgs = chat.get("messages")
                if isinstance(msgs, list):
                    for m in msgs:
                        if isinstance(m, dict):
                            yield (chat_id, m)
            return

    msgs = root.get("messages")
    if isinstance(msgs, list):
        # may have top-level id for chat, but sometimes not
        cid = root.get("id")
        chat_id: Optional[int] = None
        if isinstance(cid, int):
            chat_id = cid
        elif isinstance(cid, str) and cid.isdigit():
            chat_id = int(cid)

        for m in msgs:
            if isinstance(m, dict):
                yield (chat_id, m)
        return

def ensure_tables(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS raw")
    con.execute("CREATE SCHEMA IF NOT EXISTS core")

    con.execute("""
        CREATE TABLE IF NOT EXISTS raw.messages_f (
          chat_id BIGINT,
          message_id BIGINT,
          ts_ms BIGINT,
          from_name VARCHAR,
          text VARCHAR,
          reply_to_message_id BIGINT,
          raw_json VARCHAR,
          parse_run_id VARCHAR,
          ingested_at TIMESTAMP,
          PRIMARY KEY(chat_id, message_id)
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS core.alerts_d (
          chat_id BIGINT,
          message_id BIGINT,
          alert_ts_ms BIGINT,
          from_name VARCHAR,
          text VARCHAR,
          parse_run_id VARCHAR,
          ingested_at TIMESTAMP,
          PRIMARY KEY(chat_id, message_id)
        )
    """)

    # Note: caller_links_d already exists with the canonical schema.
    # This CREATE TABLE is kept for standalone use but won't run if table exists.
    # Primary key is (trigger_chat_id, trigger_message_id, bot_message_id, run_id)
    con.execute("""
        CREATE TABLE IF NOT EXISTS caller_links_d (
          trigger_chat_id TEXT NOT NULL,
          trigger_message_id BIGINT NOT NULL,
          trigger_ts_ms BIGINT,
          trigger_from_name VARCHAR,
          bot_message_id BIGINT NOT NULL,
          bot_ts_ms BIGINT,
          bot_from_name VARCHAR,
          bot_type VARCHAR,
          mint VARCHAR,
          chain VARCHAR,
          run_id TEXT NOT NULL DEFAULT 'legacy',
          inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(trigger_chat_id, trigger_message_id, bot_message_id, run_id)
        )
    """)

def upsert_raw(con: duckdb.DuckDBPyConnection, msg: Msg, parse_run_id: str, ingested_at: datetime) -> None:
    con.execute("""
        INSERT OR REPLACE INTO raw.messages_f
        (chat_id, message_id, ts_ms, from_name, text, reply_to_message_id, raw_json, parse_run_id, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        msg.chat_id, msg.message_id, msg.ts_ms, msg.from_name, msg.text,
        msg.reply_to_id, msg.raw_json, parse_run_id, ingested_at
    ])

def upsert_alert(con: duckdb.DuckDBPyConnection, trig: Msg, parse_run_id: str, ingested_at: datetime) -> None:
    con.execute("""
        INSERT OR REPLACE INTO core.alerts_d
        (chat_id, message_id, alert_ts_ms, from_name, text, parse_run_id, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, [
        trig.chat_id, trig.message_id, trig.ts_ms, trig.from_name, trig.text, parse_run_id, ingested_at
    ])

def upsert_link(
    con: duckdb.DuckDBPyConnection,
    chat_id: int,
    bot: Msg,
    trig: Msg,
    mint: str,
    type_tag: Optional[str],
    chain: str,
    parse_run_id: str,
    ingested_at: datetime,
) -> None:
    con.execute("""
        INSERT OR REPLACE INTO caller_links_d
        (trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_name,
         bot_message_id, bot_ts_ms, bot_from_name, bot_type,
         mint, chain, run_id, inserted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        str(chat_id),  # trigger_chat_id (TEXT)
        trig.message_id, trig.ts_ms, trig.from_name,
        bot.message_id, bot.ts_ms, bot.from_name, 'phanes',  # bot_type
        mint, chain,
        parse_run_id, ingested_at
    ])

def walk_to_original_trigger(messages_by_id: Dict[int, Msg], start_reply_to: Optional[int]) -> Optional[Msg]:
    """
    Walk reply chain backwards until first non-PHANES message.
    If the chain breaks or start_reply_to is None -> return None.
    """
    if start_reply_to is None:
        return None

    seen = set()
    cur_id = start_reply_to
    while True:
        if cur_id in seen:
            return None
        seen.add(cur_id)

        m = messages_by_id.get(cur_id)
        if m is None:
            return None

        if not is_phanes(m.from_name):
            return m

        # If somehow PHANES replied to PHANES, keep walking
        nxt = m.reply_to_id
        if nxt is None:
            return None
        cur_id = nxt

def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest Telegram result.json (PHANES-only, bot-only extraction)")
    ap.add_argument("--duckdb", required=True, help="DuckDB path (e.g. data/alerts.duckdb)")
    ap.add_argument("--result-json", required=True, help="Path to Telegram result.json")
    ap.add_argument("--chat-id", type=int, default=None, help="Chat ID override if missing in export")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report counts, but do not write to DuckDB")
    args = ap.parse_args()

    result_path = Path(args.result_json)
    if not result_path.exists():
        raise SystemExit(f"result.json not found: {result_path}")

    root = json.loads(result_path.read_text(encoding="utf-8"))
    parse_run_id = str(uuid.uuid4())
    ingested_at = now_utc()

    # Load + normalize all messages
    all_msgs: List[Msg] = []
    missing_chat_id = 0
    missing_ts = 0
    missing_mid = 0

    for cid_opt, m in iter_messages_from_result_json(root):
        chat_id = cid_opt if cid_opt is not None else args.chat_id
        if chat_id is None:
            missing_chat_id += 1
            continue

        mid = get_message_id(m)
        if mid is None:
            missing_mid += 1
            continue

        ts_ms = parse_date_to_ms(m)
        if ts_ms is None:
            missing_ts += 1
            continue

        from_name = sender_name(m)
        text = norm_text(m.get("text"))
        rpl = reply_to_message_id(m)
        raw_json = json.dumps(m, ensure_ascii=False)

        all_msgs.append(Msg(
            chat_id=chat_id,
            message_id=mid,
            ts_ms=ts_ms,
            from_name=from_name,
            text=text,
            reply_to_id=rpl,
            raw_json=raw_json,
        ))

    if missing_chat_id > 0 and args.chat_id is None:
        raise SystemExit(
            f"{missing_chat_id} messages had no chat_id available in export. Provide --chat-id to ingest."
        )

    # Index by message_id within chat (we assume one chat per file or consistent ids per chat_id)
    # If multi-chat, message_id can collide across chats; we keep per-chat mapping via filtering later.
    # We'll build mapping per chat in processing loop.
    msgs_by_chat: Dict[int, Dict[int, Msg]] = {}
    for msg in all_msgs:
        msgs_by_chat.setdefault(msg.chat_id, {})[msg.message_id] = msg

    # Prepare DB
    if not args.dry_run:
        con = duckdb.connect(args.duckdb)
        ensure_tables(con)
    else:
        con = None

    total_raw = 0
    total_phanes = 0
    total_phanes_with_addr = 0
    total_linked = 0
    dropped_no_reply = 0
    dropped_no_addr = 0
    dropped_unresolvable_trigger = 0

    try:
        # Upsert raw messages for audit
        for msg in all_msgs:
            total_raw += 1
            if con is not None:
                upsert_raw(con, msg, parse_run_id, ingested_at)

        # Process PHANES messages only
        for msg in all_msgs:
            if not is_phanes(msg.from_name):
                continue
            total_phanes += 1

            addr = first_address(msg.text)
            if not addr:
                dropped_no_addr += 1
                continue
            total_phanes_with_addr += 1

            # type_tag + chain per contract
            tag = first_hashtag(msg.text)
            if tag:
                chain = chain_from_tag(tag)
                type_tag = normalize_tag(tag)
            else:
                type_tag = None
                chain = chain_from_address_shape(addr) or "unknown"

            # reply-chain linking
            trig = walk_to_original_trigger(msgs_by_chat[msg.chat_id], msg.reply_to_id)
            if trig is None:
                if msg.reply_to_id is None:
                    dropped_no_reply += 1
                else:
                    dropped_unresolvable_trigger += 1
                continue

            total_linked += 1

            if con is not None:
                # Store the trigger message as an "alert"
                upsert_alert(con, trig, parse_run_id, ingested_at)
                # Store the linkage
                upsert_link(
                    con=con,
                    chat_id=msg.chat_id,
                    bot=msg,
                    trig=trig,
                    mint=addr,
                    type_tag=type_tag,
                    chain=chain,
                    parse_run_id=parse_run_id,
                    ingested_at=ingested_at,
                )

        if con is not None:
            con.commit()

    finally:
        if con is not None:
            con.close()

    # Report
    print(f"[done] parse_run_id={parse_run_id}")
    print(f"[stats] raw_ingested={total_raw} phanes_msgs={total_phanes} phanes_with_addr={total_phanes_with_addr} linked={total_linked}")
    print(f"[drops] no_addr={dropped_no_addr} no_reply={dropped_no_reply} unresolvable_trigger={dropped_unresolvable_trigger}")
    if missing_mid or missing_ts:
        print(f"[warn] skipped messages: missing_mid={missing_mid} missing_ts={missing_ts}", file=sys.stderr)
    if missing_chat_id and args.chat_id is None:
        print(f"[warn] missing_chat_id={missing_chat_id} (provide --chat-id)", file=sys.stderr)

if __name__ == "__main__":
    main()
