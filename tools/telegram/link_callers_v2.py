#!/usr/bin/env python3

"""
Caller linking v2: Retroactive approach
1. Find bot replies (Rick/Phanes)
2. Look backwards 60s for user messages with same ticker/mint
3. Only record FIRST call per user per token
4. Combine Rick + Phanes data, quarantine conflicts
"""

import argparse
import json
import re
import sqlite3
from typing import Optional, List, Dict, Any, Tuple, Set
from datetime import datetime, timezone, timedelta

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

# Use DuckDB parsers - they're more lenient and handle more edge cases
try:
    from tools.telegram.duckdb_punch_pipeline import parse_bot, find_address_candidates
    HAS_DUCKDB_PARSER = True
except ImportError:
    HAS_DUCKDB_PARSER = False
    # Fallback to original parser
    from tools.telegram.parse_bot_cards import parse_any_bot_card

from tools.telegram.parse_bot_cards import find_mint_addresses, BASE58_RE
import re

TICKER_RE = re.compile(r"\$\$?([A-Za-z0-9_]+)")


BOT_NAMES = {"Rick", "Phanes [Gold]"}


def find_tickers(text: str) -> List[str]:
    """Extract tickers like $TOKEN or $$TOKEN"""
    matches = TICKER_RE.findall(text or "")
    return [t.upper() for t in matches if len(t) >= 2]


def is_bot_message(msg: Dict[str, Any]) -> bool:
    """Check if message is from Rick or Phanes"""
    from_name = msg.get("from_name") or ""
    return from_name in BOT_NAMES


def extract_mints_and_tickers(text: str) -> Tuple[List[str], List[str]]:
    """Extract mints and tickers from text"""
    mints = find_mint_addresses(text)
    # Also extract EVM addresses (0x followed by 40 hex characters)
    evm_pattern = re.compile(r'0x[a-fA-F0-9]{40}')
    evm_addresses = evm_pattern.findall(text or "")
    mints.extend(evm_addresses)
    # Deduplicate while preserving order
    mints = list(dict.fromkeys(mints))
    tickers = find_tickers(text)
    
    # Filter out common false positives if there's a mint address in the same message
    # These will be on a new line, next msg, or with a space from the mint
    if mints and tickers:
        # Filter out: "js", "/hm", "/lb", "/last" (case-insensitive)
        excluded_tickers = {"JS", "HM", "LB", "LAST"}
        tickers = [t for t in tickers if t.upper() not in excluded_tickers]
    
    return mints, tickers


def find_trigger_message_by_reply(
    bot_message_id: int,
    bot_reply_to_id: Optional[int],
    chat_id: str,
    messages_dict: Dict[Tuple[str, int], Dict]
) -> Optional[Dict]:
    """Find the trigger message using reply_to_message_id"""
    if not bot_reply_to_id:
        return None
    
    # Look up the message directly by chat_id and message_id
    key = (chat_id, bot_reply_to_id)
    trigger = messages_dict.get(key)
    
    if not trigger:
        return None
    
    # Skip if it's a bot message (shouldn't happen, but safety check)
    if is_bot_message(trigger):
        return None
    
    # Skip service messages
    if trigger.get("is_service", 0):
        return None
    
    return trigger


def merge_bot_cards(rick_card: Optional[Dict], phanes_card: Optional[Dict]) -> Tuple[Dict, List[Dict]]:
    """
    Merge Rick and Phanes cards into one record.
    Returns (merged_card, quarantine_conflicts)
    """
    merged = {}
    conflicts = []
    
    # Helper to compare and merge fields
    def merge_field(field_name: str, rick_val, phanes_val, allow_different=False):
        if rick_val is not None and phanes_val is not None:
            if rick_val == phanes_val or allow_different:
                merged[field_name] = rick_val  # Prefer Rick (more detailed)
            else:
                # Conflict - quarantine
                conflicts.append({
                    "field_name": field_name,
                    "rick_value": rick_val,
                    "phanes_value": phanes_val,
                })
                merged[field_name] = rick_val  # Use Rick as default
        elif rick_val is not None:
            merged[field_name] = rick_val
        elif phanes_val is not None:
            merged[field_name] = phanes_val
    
    # Basic fields
    merge_field("mint", rick_card.get("mint") if rick_card else None, phanes_card.get("mint") if phanes_card else None)
    merge_field("ticker", rick_card.get("ticker") if rick_card else None, phanes_card.get("ticker") if phanes_card else None)
    merge_field("token_name", rick_card.get("token_name") if rick_card else None, phanes_card.get("token_name") if phanes_card else None)
    merge_field("chain", rick_card.get("chain") if rick_card else None, phanes_card.get("chain") if phanes_card else None)
    merge_field("platform", rick_card.get("platform") if rick_card else None, phanes_card.get("platform") if phanes_card else None)
    
    # Price - allow small differences
    rick_price = rick_card.get("price_usd") if rick_card else None
    phanes_price = phanes_card.get("price_usd") if phanes_card else None
    if rick_price and phanes_price:
        if abs(rick_price - phanes_price) / max(rick_price, phanes_price) < 0.1:  # 10% tolerance
            merged["price_usd"] = rick_price
        else:
            conflicts.append({
                "field_name": "price_usd",
                "rick_value": rick_price,
                "phanes_value": phanes_price,
            })
            merged["price_usd"] = rick_price
    elif rick_price:
        merged["price_usd"] = rick_price
    elif phanes_price:
        merged["price_usd"] = phanes_price
    
    # Market cap - prefer Rick's fdv_now_usd, fallback to mcap_usd
    rick_mcap = rick_card.get("fdv_now_usd") or rick_card.get("mcap_usd") if rick_card else None
    phanes_mcap = phanes_card.get("mcap_usd") if phanes_card else None
    merge_field("mcap_usd", rick_mcap, phanes_mcap, allow_different=True)
    
    # ATH
    rick_ath = rick_card.get("ath_mcap_usd") if rick_card else None
    phanes_ath = phanes_card.get("ath_mcap_usd") if phanes_card else None
    merge_field("ath_mcap_usd", rick_ath, phanes_ath, allow_different=True)
    
    # ATH age (for calculating ATH date)
    rick_ath_age = rick_card.get("ath_age_days") if rick_card else None
    phanes_ath_age = phanes_card.get("ath_age_days") if phanes_card else None
    merge_field("ath_age_days", rick_ath_age, phanes_ath_age)
    
    # Liquidity
    rick_liq = rick_card.get("liquidity_usd") if rick_card else None
    phanes_liq = phanes_card.get("liquidity_usd") if phanes_card else None
    merge_field("liquidity_usd", rick_liq, phanes_liq)
    
    # Volume - DuckDB parser uses vol_usd for both
    rick_vol = rick_card.get("vol_usd") or rick_card.get("volume_usd") if rick_card else None
    phanes_vol = phanes_card.get("vol_usd") if phanes_card else None
    merge_field("volume_usd", rick_vol, phanes_vol)
    
    # Social links - combine from both
    socials = {}
    if rick_card:
        # Rick doesn't have structured socials, skip
        pass
    if phanes_card:
        phanes_socials = phanes_card.get("socials_present") or []
        if "X" in phanes_socials:
            socials["social_x"] = True
        if "TG" in phanes_socials:
            socials["social_telegram"] = True
        if "Web" in phanes_socials:
            socials["social_website"] = True
    
    merged.update(socials)
    
    # Holder distribution (Rick only)
    if rick_card:
        merged["top_holders_pct"] = rick_card.get("top_holders_pct")
        merged["total_holders"] = rick_card.get("total_holders")
    
    # Chart links (Rick only)
    if rick_card:
        merged["chart_links"] = rick_card.get("links_present")
    
    # Tags (Rick only)
    if rick_card:
        merged["tags"] = rick_card.get("tags")
    
    return merged, conflicts


def calculate_ath_date(message_ts_ms: int, ath_age_days: Optional[int]) -> Optional[datetime]:
    """Calculate ATH date from message timestamp and age"""
    if not ath_age_days:
        return None
    msg_dt = datetime.fromtimestamp(message_ts_ms / 1000, tz=timezone.utc)
    ath_dt = msg_dt - timedelta(days=ath_age_days)
    return ath_dt


def link_callers_v2(db_path: str, window_seconds: int = 60, quiet: bool = False):
    """Main linking logic - retroactive approach"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    # Initialize schema
    schema_sql = open(os.path.join(os.path.dirname(__file__), "schema_calls.sql"), "r", encoding="utf-8").read()
    conn.executescript(schema_sql)
    conn.commit()
    
    # Get all messages ordered by chat and timestamp
    messages = conn.execute("""
        SELECT 
            message_id,
            chat_id,
            ts_ms,
            from_name,
            from_id,
            text,
            is_service,
            norm_json
        FROM tg_norm
        ORDER BY chat_id, ts_ms
    """).fetchall()
    
    # Convert to dicts and create lookup dict by (chat_id, message_id)
    messages_list = [dict(msg) for msg in messages]
    messages_dict: Dict[Tuple[str, int], Dict] = {}
    for msg in messages_list:
        key = (msg["chat_id"], msg["message_id"])
        messages_dict[key] = msg
    
    # Track first caller per token
    first_callers: Dict[str, str] = {}  # mint -> first caller name
    first_call_ts: Dict[str, int] = {}  # mint -> first call timestamp
    
    # Track which users have called which tokens (to avoid duplicates)
    user_token_calls: Set[Tuple[str, str]] = set()  # (caller_name, mint)
    
    linked_count = 0
    bot_pairs: Dict[int, Dict] = {}  # message_id -> {rick: card, phanes: card}
    
    bot_count = 0
    bot_with_reply = 0
    bot_with_trigger = 0
    
    # First pass: find all bot replies and parse them
    for msg in messages_list:
        if not is_bot_message(msg):
            continue
        
        bot_count += 1
        
        # Extract reply_to_message_id from norm_json first
        norm_json = json.loads(msg.get("norm_json", "{}"))
        reply_to_id = norm_json.get("reply_to_message_id")
        
        # Find trigger message using reply_to (even if card parsing fails)
        if reply_to_id:
            bot_with_reply += 1
        
        trigger = find_trigger_message_by_reply(
            msg["message_id"],
            reply_to_id,
            msg["chat_id"],
            messages_dict
        )
        
        if not trigger:
            continue
        
        bot_with_trigger += 1
        
        # Now try to parse the bot card using DuckDB parser (more lenient)
        trigger_text = trigger.get("text") if trigger else None
        # Use DuckDB parser if available, otherwise fallback to original
        if HAS_DUCKDB_PARSER:
            bot_card = parse_bot(msg["from_name"], msg["text"], trigger_text)
        else:
            bot_card = parse_any_bot_card(msg["text"])
            if bot_card:
                bot_card = bot_card.get("card") if isinstance(bot_card, dict) else bot_card
        
        if not bot_card:
            # Still link it, but without card data
            bot_name = msg["from_name"]
            trigger_id = trigger["message_id"]
            if trigger_id not in bot_pairs:
                bot_pairs[trigger_id] = {"trigger": trigger, "rick": None, "phanes": None}
            # Store with empty card
            if bot_name == "Rick":
                bot_pairs[trigger_id]["rick"] = {"card": None, "message_id": msg["message_id"]}
            elif bot_name == "Phanes [Gold]":
                bot_pairs[trigger_id]["phanes"] = {"card": None, "message_id": msg["message_id"]}
            continue
        
        bot_name = msg["from_name"]
        
        # Group bot replies by trigger message
        trigger_id = trigger["message_id"]
        if trigger_id not in bot_pairs:
            bot_pairs[trigger_id] = {"trigger": trigger, "rick": None, "phanes": None}
        
        if bot_name == "Rick":
            bot_pairs[trigger_id]["rick"] = {"card": bot_card, "message_id": msg["message_id"]}
        elif bot_name == "Phanes [Gold]":
            bot_pairs[trigger_id]["phanes"] = {"card": bot_card, "message_id": msg["message_id"]}
    
    # Second pass: process bot pairs and create user_calls
    cur = conn.cursor()
    
    if not quiet:
        print(f"Bot messages: {bot_count}, with reply_to: {bot_with_reply}, with valid trigger: {bot_with_trigger}")
        print(f"Found {len(bot_pairs)} trigger messages with bot replies")
    
    for trigger_id, pair in bot_pairs.items():
        trigger = pair["trigger"]
        rick_data = pair.get("rick")
        phanes_data = pair.get("phanes")
        
        rick_card = rick_data["card"] if rick_data else None
        phanes_card = phanes_data["card"] if phanes_data else None
        
        # Merge bot cards
        merged_card, conflicts = merge_bot_cards(rick_card, phanes_card)
        
        mint = merged_card.get("mint")
        ticker = merged_card.get("ticker")
        caller_name = trigger["from_name"]
        
        # Extract mint/ticker from trigger text
        # If bot replied directly to this message (via reply_to_message_id),
        # we can trust the mint/address in the trigger text - ESPECIALLY for EVM addresses
        trigger_text = trigger.get("text") or ""
        trigger_mints, trigger_tickers = extract_mints_and_tickers(trigger_text)
        
        # ALWAYS prioritize EVM addresses (0x...) from trigger text if present
        # The bot replied to this message, so the 0x address IS the mint address
        evm_addresses = [m for m in trigger_mints if m.startswith('0x')]
        if evm_addresses:
            mint = evm_addresses[0]  # Use first EVM address from trigger
        # Otherwise, use mint from bot cards if available
        elif (mint is None or mint == "") and trigger_mints:
            mint = trigger_mints[0]
        
        # Use trigger ticker if bot cards don't have one
        if (ticker is None or ticker == "") and trigger_tickers:
            ticker = trigger_tickers[0]
        
        # Still skip if we have absolutely no identifier
        if not mint and not ticker:
            continue
        
        # Check if this user already called this token
        if mint and (caller_name, mint) in user_token_calls:
            continue
        if ticker and not mint:
            # Can't track by ticker alone reliably, skip duplicates
            pass
        
        # Determine if first caller
        is_first = False
        if mint:
            if mint not in first_callers:
                first_callers[mint] = caller_name
                first_call_ts[mint] = trigger["ts_ms"]
                is_first = True
            elif first_callers[mint] == caller_name:
                is_first = True
        
        # Record user call
        call_dt = datetime.fromtimestamp(trigger["ts_ms"] / 1000, tz=timezone.utc)
        
        cur.execute("""
            INSERT OR REPLACE INTO user_calls (
                caller_name, caller_id, call_datetime, call_ts_ms, message_id, chat_id,
                bot_reply_id_1, bot_reply_id_2, mint, ticker, mcap_usd, price_usd,
                first_caller, trigger_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            caller_name,
            trigger.get("from_id"),
            call_dt.isoformat(),
            trigger["ts_ms"],
            trigger["message_id"],
            trigger["chat_id"],
            rick_data["message_id"] if rick_data else None,
            phanes_data["message_id"] if phanes_data else None,
            mint,
            ticker,
            merged_card.get("mcap_usd"),
            merged_card.get("price_usd"),
            1 if is_first else 0,
            trigger.get("text"),
        ))
        
        # Record conflicts
        for conflict in conflicts:
            cur.execute("""
                INSERT INTO token_quarantine (
                    mint, ticker, field_name, rick_value, phanes_value,
                    message_id_rick, message_id_phanes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                mint,
                ticker,
                conflict["field_name"],
                str(conflict["rick_value"]),
                str(conflict["phanes_value"]),
                rick_data["message_id"] if rick_data else None,
                phanes_data["message_id"] if phanes_data else None,
            ))
        
        # Update tokens_metadata
        if mint:
            cur.execute("""
                INSERT OR IGNORE INTO tokens_metadata (mint) VALUES (?)
            """, (mint,))
            
            cur.execute("""
                UPDATE tokens_metadata SET
                    name = COALESCE(name, ?),
                    ticker = COALESCE(ticker, ?),
                    social_x = COALESCE(social_x, ?),
                    social_telegram = COALESCE(social_telegram, ?),
                    social_website = COALESCE(social_website, ?),
                    first_call_date = COALESCE(first_call_date, ?),
                    first_caller_name = COALESCE(first_caller_name, ?),
                    first_mcap = COALESCE(first_mcap, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE mint = ?
            """, (
                merged_card.get("token_name"),
                ticker,
                "1" if merged_card.get("social_x") else None,
                "1" if merged_card.get("social_telegram") else None,
                "1" if merged_card.get("social_website") else None,
                call_dt.isoformat() if is_first else None,
                caller_name if is_first else None,
                merged_card.get("mcap_usd") if is_first else None,
                mint,
            ))
        
        # Store bot observations (raw, before merging)
        if rick_data:
            # Get actual timestamp from message
            rick_msg = next((m for m in messages_list if m["message_id"] == rick_data["message_id"]), None)
            rick_ts_ms = rick_msg["ts_ms"] if rick_msg else trigger["ts_ms"]
            rick_obs_dt = datetime.fromtimestamp(rick_ts_ms / 1000, tz=timezone.utc)
            top_holders = rick_card.get("top_holders_pct") or [] if rick_card else []
            cur.execute("""
                INSERT OR IGNORE INTO bot_observations (
                    mint, ticker, bot_name, message_id, observed_at_ms, observed_at,
                    card_json, mcap_usd, price_usd, liquidity_usd, volume_usd,
                    ath_mcap_usd, ath_age_days,
                    top_holders_pct_1, top_holders_pct_2, top_holders_pct_3,
                    top_holders_pct_4, top_holders_pct_5, top_holders_sum_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                mint, ticker, "rick", rick_data["message_id"],
                rick_ts_ms, rick_obs_dt.isoformat(),
                json.dumps(rick_card, ensure_ascii=False),
                rick_card.get("mcap_usd") or rick_card.get("fdv_now_usd") if rick_card else None,
                rick_card.get("price_usd") if rick_card else None,
                rick_card.get("liquidity_usd") if rick_card else None,
                rick_card.get("vol_usd") or rick_card.get("volume_usd") if rick_card else None,
                rick_card.get("ath_mcap_usd") if rick_card else None,
                rick_card.get("ath_age_days") if rick_card else None,
                top_holders[0] if len(top_holders) > 0 else None,
                top_holders[1] if len(top_holders) > 1 else None,
                top_holders[2] if len(top_holders) > 2 else None,
                top_holders[3] if len(top_holders) > 3 else None,
                top_holders[4] if len(top_holders) > 4 else None,
                rick_card.get("top_holders_sum_pct") if rick_card else None,
            ))
        
        if phanes_data:
            # Get actual timestamp from message
            phanes_msg = next((m for m in messages_list if m["message_id"] == phanes_data["message_id"]), None)
            phanes_ts_ms = phanes_msg["ts_ms"] if phanes_msg else trigger["ts_ms"]
            phanes_obs_dt = datetime.fromtimestamp(phanes_ts_ms / 1000, tz=timezone.utc)
            top_holders = []  # Phanes doesn't have holder data
            cur.execute("""
                INSERT OR IGNORE INTO bot_observations (
                    mint, ticker, bot_name, message_id, observed_at_ms, observed_at,
                    card_json, mcap_usd, price_usd, liquidity_usd, volume_usd,
                    ath_mcap_usd, ath_age_days,
                    top_holders_pct_1, top_holders_pct_2, top_holders_pct_3,
                    top_holders_pct_4, top_holders_pct_5, top_holders_sum_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                mint, ticker, "phanes", phanes_data["message_id"],
                phanes_ts_ms, phanes_obs_dt.isoformat(),
                json.dumps(phanes_card, ensure_ascii=False),
                phanes_card.get("mcap_usd") if phanes_card else None,
                phanes_card.get("price_usd") if phanes_card else None,
                phanes_card.get("liquidity_usd") if phanes_card else None,
                phanes_card.get("vol_usd") if phanes_card else None,
                phanes_card.get("ath_mcap_usd") if phanes_card else None,
                phanes_card.get("ath_age_days") if phanes_card else None,
                None, None, None, None, None, None,
            ))
        
        # Update tokens_data
        if mint:
            ath_date = calculate_ath_date(
                trigger["ts_ms"],
                merged_card.get("ath_age_days")
            )
            
            # Compute supply = mcap / price
            supply = None
            if merged_card.get("mcap_usd") and merged_card.get("price_usd") and merged_card["price_usd"] > 0:
                supply = merged_card["mcap_usd"] / merged_card["price_usd"]
            
            liquidity_x = None
            if merged_card.get("mcap_usd") and merged_card.get("liquidity_usd") and merged_card["liquidity_usd"] > 0:
                liquidity_x = merged_card["mcap_usd"] / merged_card["liquidity_usd"]
            
            top_holders = merged_card.get("top_holders_pct") or []
            
            cur.execute("""
                INSERT OR REPLACE INTO tokens_data (
                    mint, ticker, mcap, current_mcap, last_update, price,
                    supply, ath_mcap, ath_date, liquidity, liquidity_x,
                    top_holders_pct_1, top_holders_pct_2, top_holders_pct_3,
                    top_holders_pct_4, top_holders_pct_5, top_holders_sum_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                mint,
                ticker,
                merged_card.get("mcap_usd"),
                merged_card.get("mcap_usd"),  # Initial = current
                call_dt.isoformat(),
                merged_card.get("price_usd"),
                supply,
                merged_card.get("ath_mcap_usd"),
                ath_date.isoformat() if ath_date else None,
                merged_card.get("liquidity_usd"),
                liquidity_x,
                top_holders[0] if len(top_holders) > 0 else None,
                top_holders[1] if len(top_holders) > 1 else None,
                top_holders[2] if len(top_holders) > 2 else None,
                top_holders[3] if len(top_holders) > 3 else None,
                top_holders[4] if len(top_holders) > 4 else None,
                merged_card.get("top_holders_sum_pct"),
            ))
        
        if mint:
            user_token_calls.add((caller_name, mint))
        
        linked_count += 1
        
        if linked_count % 100 == 0:
            conn.commit()
            print(f"Processed {linked_count} calls...")
    
    conn.commit()
    conn.close()
    
    return linked_count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="tele.db", help="SQLite database path")
    ap.add_argument("--window", type=int, default=60, help="Time window in seconds (default: 60)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    
    if not args.quiet:
        print(f"Linking callers (v2 - retroactive) in {args.db}...")
        print(f"Window: {args.window}s")
    
    linked_count = link_callers_v2(args.db, args.window, quiet=args.quiet)
    
    if not args.quiet:
        print(f"\nDONE: {linked_count} calls linked")


if __name__ == "__main__":
    main()

