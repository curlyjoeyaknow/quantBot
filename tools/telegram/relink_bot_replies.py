#!/usr/bin/env python3

import argparse
import json
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.telegram.parse_bot_cards import parse_any_bot_card, find_mint_addresses

TICKER_RE = re.compile(r"(?<!\w)\${1,2}([A-Za-z0-9_]{2,20})(?!\w)")

def extract_trigger_mints_tickers(text: str) -> Tuple[List[str], List[str]]:
    mints = find_mint_addresses(text or "")
    tickers = []
    for m in TICKER_RE.finditer(text or ""):
        t = (m.group(1) or "").upper()
        if t:
            tickers.append(t)
    mints = list(dict.fromkeys(mints))
    tickers = list(dict.fromkeys(tickers))
    return mints, tickers

def rel_diff(a: float, b: float) -> float:
    denom = (abs(a) + abs(b)) / 2.0
    if denom == 0:
        return 0.0
    return abs(a - b) / denom

def score_candidate(trigger_mints: List[str], trigger_tickers: List[str], card: Dict[str, Any], dt_ms: int) -> Tuple[int, List[str]]:
    reasons: List[str] = []
    score = 0

    bot_mint = card.get("mint")
    bot_ticker = card.get("ticker")
    if bot_ticker:
        bot_ticker = str(bot_ticker).upper()

    if trigger_mints and bot_mint:
        if bot_mint in trigger_mints:
            score += 100
            reasons.append("mint_match")
        else:
            score -= 100
            reasons.append("mint_conflict")

    if trigger_tickers and bot_ticker:
        if bot_ticker in trigger_tickers:
            score += 50
            reasons.append("ticker_match")

    dt_s = max(0, int(dt_ms // 1000))
    score -= min(120, dt_s)
    reasons.append(f"dt_s={dt_s}")

    return score, reasons

def validation_passed(trigger_mints: List[str], trigger_tickers: List[str], bot_mint: Optional[str], bot_ticker: Optional[str]) -> int:
    if bot_mint and trigger_mints and bot_mint in trigger_mints:
        return 1
    if bot_ticker and trigger_tickers and str(bot_ticker).upper() in trigger_tickers:
        return 1
    return 0

def maybe_insert_token_quarantine(cur: sqlite3.Cursor,
                                 mint: Optional[str],
                                 ticker: Optional[str],
                                 field: str,
                                 rick_val: Any,
                                 phanes_val: Any,
                                 msg_rick: Optional[int],
                                 msg_phanes: Optional[int]) -> None:
    cur.execute(
        """
        SELECT 1 FROM token_quarantine
        WHERE field_name = ?
          AND COALESCE(mint,'') = COALESCE(?, '')
          AND COALESCE(message_id_rick,-1) = COALESCE(?, -1)
          AND COALESCE(message_id_phanes,-1) = COALESCE(?, -1)
        LIMIT 1
        """,
        (field, mint, msg_rick, msg_phanes)
    )
    if cur.fetchone():
        return

    cur.execute(
        """
        INSERT INTO token_quarantine(mint, ticker, field_name, rick_value, phanes_value, message_id_rick, message_id_phanes)
        VALUES (?,?,?,?,?,?,?)
        """,
        (
            mint,
            ticker,
            field,
            None if rick_val is None else str(rick_val),
            None if phanes_val is None else str(phanes_val),
            msg_rick,
            msg_phanes,
        )
    )

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="path to tele.db")
    ap.add_argument("--window-s", type=int, default=90, help="lookahead window for bot replies")
    ap.add_argument("--since-ms", type=int, default=None, help="only relink calls >= this ms timestamp")
    ap.add_argument("--limit", type=int, default=None, help="limit number of user_calls processed")
    ap.add_argument("--chat-id", default=None, help="only process one chat_id")
    ap.add_argument("--overwrite", action="store_true", help="delete existing caller_links for trigger before inserting")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--mcap-conflict-pct", type=float, default=0.20, help="relative diff threshold for mcap conflict")
    ap.add_argument("--price-conflict-pct", type=float, default=0.10, help="relative diff threshold for price conflict")
    ap.add_argument("--liq-conflict-pct", type=float, default=0.20, help="relative diff threshold for liquidity conflict")
    ap.add_argument("--vol-conflict-pct", type=float, default=0.25, help="relative diff threshold for volume conflict")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")

    where = []
    params: List[Any] = []

    if args.chat_id:
        where.append("chat_id = ?")
        params.append(args.chat_id)

    if args.since_ms is not None:
        where.append("call_ts_ms >= ?")
        params.append(args.since_ms)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    limit_sql = f"LIMIT {int(args.limit)}" if args.limit else ""

    calls = list(cur.execute(
        f"""
        SELECT
          id, caller_name, caller_id, call_datetime, call_ts_ms,
          message_id, chat_id, bot_reply_id_1, bot_reply_id_2,
          mint, ticker, mcap_usd, price_usd, first_caller, trigger_text
        FROM user_calls
        {where_sql}
        ORDER BY call_ts_ms ASC
        {limit_sql}
        """,
        params
    ))

    processed = 0
    linked_rick = 0
    linked_phanes = 0
    conflicts = 0
    caller_links_written = 0

    window_ms = args.window_s * 1000

    for call in calls:
        processed += 1

        trigger_chat_id = call["chat_id"]
        trigger_message_id = call["message_id"]
        trigger_ts_ms = call["call_ts_ms"]
        trigger_from_id = call["caller_id"]
        trigger_from_name = call["caller_name"]
        trigger_text = call["trigger_text"] or ""

        trigger_mints, trigger_tickers = extract_trigger_mints_tickers(trigger_text)
        if call["mint"]:
            trigger_mints = [call["mint"]] if call["mint"] not in trigger_mints else [call["mint"]] + [m for m in trigger_mints if m != call["mint"]]
        if call["ticker"]:
            t = str(call["ticker"]).upper()
            trigger_tickers = [t] if t not in trigger_tickers else [t] + [x for x in trigger_tickers if x != t]

        candidates = list(cur.execute(
            """
            SELECT message_id, ts_ms, from_name, from_id, text
            FROM tg_norm
            WHERE chat_id = ?
              AND ts_ms IS NOT NULL
              AND ts_ms >= ?
              AND ts_ms <= ?
              AND message_id != ?
            ORDER BY ts_ms ASC
            """,
            (trigger_chat_id, trigger_ts_ms, trigger_ts_ms + window_ms, trigger_message_id)
        ))

        best: Dict[str, Optional[sqlite3.Row]] = {"rick": None, "phanes": None}
        best_card: Dict[str, Optional[Dict[str, Any]]] = {"rick": None, "phanes": None}
        best_score: Dict[str, int] = {"rick": -10**9, "phanes": -10**9}
        best_reasons: Dict[str, List[str]] = {"rick": [], "phanes": []}

        for row in candidates:
            txt = row["text"] or ""
            card = parse_any_bot_card(txt)
            if not card:
                continue

            bot = card.get("bot")
            if bot not in ("rick", "phanes"):
                continue

            dt_ms = int(row["ts_ms"] - trigger_ts_ms)
            score, reasons = score_candidate(trigger_mints, trigger_tickers, card, dt_ms)

            if score > best_score[bot]:
                best_score[bot] = score
                best_reasons[bot] = reasons
                best[bot] = row
                best_card[bot] = {
                    "card": card,
                    "link": {
                        "score": score,
                        "reasons": reasons,
                        "trigger_mints": trigger_mints,
                        "trigger_tickers": trigger_tickers
                    }
                }

        rick_row = best["rick"]
        ph_row = best["phanes"]
        rick_json = best_card["rick"]
        ph_json = best_card["phanes"]

        if args.overwrite and not args.dry_run:
            cur.execute(
                "DELETE FROM caller_links WHERE trigger_message_id = ? AND trigger_chat_id = ?",
                (trigger_message_id, trigger_chat_id)
            )

        def insert_link(bot_row: sqlite3.Row, bot_json: Dict[str, Any]) -> int:
            nonlocal caller_links_written
            bot_message_id = bot_row["message_id"]
            bot_from_name = bot_row["from_name"] or ""

            inner_card = (bot_json or {}).get("card") or {}
            bot_mint = inner_card.get("mint")
            bot_ticker = inner_card.get("ticker")
            vp = validation_passed(trigger_mints, trigger_tickers, bot_mint, bot_ticker)

            if not args.dry_run:
                cur.execute(
                    """
                    INSERT OR REPLACE INTO caller_links(
                        trigger_message_id, trigger_chat_id, trigger_ts_ms,
                        trigger_from_id, trigger_from_name, trigger_text,
                        trigger_mints, trigger_tickers,
                        bot_message_id, bot_from_name, bot_card_json, bot_mint, bot_ticker,
                        validation_passed
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        trigger_message_id, trigger_chat_id, trigger_ts_ms,
                        trigger_from_id, trigger_from_name, trigger_text,
                        json.dumps(trigger_mints, ensure_ascii=False),
                        json.dumps(trigger_tickers, ensure_ascii=False),
                        bot_message_id, bot_from_name,
                        json.dumps(bot_json, ensure_ascii=False),
                        bot_mint, (str(bot_ticker).upper() if bot_ticker else None),
                        vp
                    )
                )
            caller_links_written += 1
            return vp

        rick_id = rick_row["message_id"] if rick_row else None
        ph_id = ph_row["message_id"] if ph_row else None

        vp_rick = 0
        vp_ph = 0
        if rick_row and rick_json:
            vp_rick = insert_link(rick_row, rick_json)
            linked_rick += 1
        if ph_row and ph_json:
            vp_ph = insert_link(ph_row, ph_json)
            linked_phanes += 1

        r_card = (rick_json or {}).get("card") if rick_json else None
        p_card = (ph_json or {}).get("card") if ph_json else None

        canon_mint = None
        canon_ticker = None
        mcap_usd = None
        price_usd = None

        if r_card:
            canon_mint = r_card.get("mint") or canon_mint
            canon_ticker = (r_card.get("ticker") or canon_ticker)
            mcap_usd = r_card.get("mcap_usd") or r_card.get("fdv_now_usd") if r_card.get("mcap_usd") or r_card.get("fdv_now_usd") else mcap_usd
            price_usd = r_card.get("price_usd") if r_card.get("price_usd") is not None else price_usd

        if p_card:
            canon_mint = canon_mint or p_card.get("mint")
            canon_ticker = canon_ticker or p_card.get("ticker")
            if mcap_usd is None and p_card.get("mcap_usd") is not None:
                mcap_usd = p_card.get("mcap_usd")
            if price_usd is None and p_card.get("price_usd") is not None:
                price_usd = p_card.get("price_usd")

        if canon_ticker:
            canon_ticker = str(canon_ticker).upper()

        if not args.dry_run:
            cur.execute(
                """
                UPDATE user_calls
                SET bot_reply_id_1 = ?,
                    bot_reply_id_2 = ?,
                    mint = COALESCE(?, mint),
                    ticker = COALESCE(?, ticker),
                    mcap_usd = COALESCE(?, mcap_usd),
                    price_usd = COALESCE(?, price_usd)
                WHERE id = ?
                """,
                (rick_id, ph_id, canon_mint, canon_ticker, mcap_usd, price_usd, call["id"])
            )

        if r_card and p_card:
            r_mint = r_card.get("mint")
            p_mint = p_card.get("mint")
            if r_mint and p_mint and r_mint != p_mint:
                if not args.dry_run:
                    maybe_insert_token_quarantine(cur, canon_mint, canon_ticker, "mint", r_mint, p_mint, rick_id, ph_id)
                conflicts += 1

            # Normalize chain names for comparison (case-insensitive, strip brackets)
            def normalize_chain(chain: Any) -> str:
                if not chain:
                    return ""
                s = str(chain).strip().upper()
                # Remove brackets
                s = s.replace("[", "").replace("]", "")
                # Common aliases
                if s in ("SOL", "SOLANA"):
                    return "SOLANA"
                return s

            r_chain = normalize_chain(r_card.get("chain"))
            p_chain = normalize_chain(p_card.get("chain"))
            if r_chain and p_chain and r_chain != p_chain:
                if not args.dry_run:
                    maybe_insert_token_quarantine(cur, canon_mint, canon_ticker, "chain", r_card.get("chain"), p_card.get("chain"), rick_id, ph_id)
                conflicts += 1

            def conflict_num(field: str, r_val: Any, p_val: Any, thresh: float):
                nonlocal conflicts
                if r_val is None or p_val is None:
                    return
                try:
                    ra = float(r_val)
                    pa = float(p_val)
                except Exception:
                    return
                if rel_diff(ra, pa) > thresh:
                    if not args.dry_run:
                        maybe_insert_token_quarantine(cur, canon_mint, canon_ticker, field, ra, pa, rick_id, ph_id)
                    conflicts += 1

            conflict_num("mcap_usd", r_card.get("mcap_usd") or r_card.get("fdv_now_usd"), p_card.get("mcap_usd"), args.mcap_conflict_pct)
            conflict_num("price_usd", r_card.get("price_usd"), p_card.get("price_usd"), args.price_conflict_pct)
            conflict_num("liquidity_usd", r_card.get("liquidity_usd"), p_card.get("liquidity_usd"), args.liq_conflict_pct)
            conflict_num("volume_usd", r_card.get("volume_usd"), p_card.get("vol_usd"), args.vol_conflict_pct)

        if (processed % 500) == 0 and not args.dry_run:
            conn.commit()

    if not args.dry_run:
        conn.commit()
    conn.close()

    print(json.dumps({
        "processed_user_calls": processed,
        "linked_rick": linked_rick,
        "linked_phanes": linked_phanes,
        "caller_links_written": caller_links_written,
        "token_quarantine_conflicts_added": conflicts,
        "dry_run": args.dry_run
    }, indent=2))

if __name__ == "__main__":
    main()

