#!/usr/bin/env python3

"""

Caller linking logic:

1. Find trigger messages (human messages with mint addresses or tickers like $TOKEN)
2. Find bot replies (Rick/Phanes) within 0-60s window in same chat
3. Parse bot cards and link to trigger sender
4. Validate: mint from bot card should match mint/ticker from trigger
"""

import argparse
import json
import re
import sqlite3
import sys
import os
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from tools.telegram.parse_bot_cards import parse_any_bot_card, find_mint_addresses, BASE58_RE


TICKER_RE = re.compile(r"\$\$?([A-Za-z0-9_]+)")
BOT_NAMES = {"Rick", "Phanes [Gold]"}


def find_tickers(text: str) -> List[str]:
    """Extract tickers like $TOKEN or $$TOKEN"""
    matches = TICKER_RE.findall(text or "")
    return [t.upper() for t in matches if len(t) >= 2]


def is_trigger_message(msg: Dict[str, Any]) -> bool:
    """Check if message is a trigger (human message with mint or ticker)"""
    if msg.get("is_service", 0):
        return False
    
    from_name = msg.get("from_name") or ""
    if from_name in BOT_NAMES:
        return False
    
    text = msg.get("text") or ""
    mints = find_mint_addresses(text)
    tickers = find_tickers(text)
    
    return len(mints) > 0 or len(tickers) > 0


def is_bot_message(msg: Dict[str, Any]) -> bool:
    """Check if message is from Rick or Phanes"""
    from_name = msg.get("from_name") or ""
    return from_name in BOT_NAMES


def extract_trigger_mints_and_tickers(text: str) -> Tuple[List[str], List[str]]:
    """Extract mints and tickers from trigger message"""
    mints = find_mint_addresses(text)
    tickers = find_tickers(text)
    
    # Filter out common false positives if there's a mint address in the same message
    # These will be on a new line, next msg, or with a space from the mint
    if mints and tickers:
        # Filter out: "js", "/hm", "/lb", "/last" (case-insensitive)
        excluded_tickers = {"JS", "HM", "LB", "LAST"}
        tickers = [t for t in tickers if t.upper() not in excluded_tickers]
    
    return mints, tickers


def validate_link(trigger_mints: List[str], trigger_tickers: List[str], bot_card: Dict[str, Any]) -> bool:
    """Validate that bot card mint/ticker matches trigger"""
    bot_mint = bot_card.get("mint")
    bot_ticker = bot_card.get("ticker")
    
    # Check mint match
    if bot_mint and trigger_mints:
        if bot_mint in trigger_mints:
            return True
    
    # Check ticker match
    if bot_ticker and trigger_tickers:
        if bot_ticker.upper() in [t.upper() for t in trigger_tickers]:
            return True
    
    return False


def link_callers(db_path: str, window_seconds: int = 60):
    """Main linking logic"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    # Create caller_links table if it doesn't exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS caller_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_message_id INTEGER NOT NULL,
            trigger_chat_id TEXT NOT NULL,
            trigger_ts_ms INTEGER NOT NULL,
            trigger_from_id TEXT,
            trigger_from_name TEXT,
            trigger_text TEXT,
            trigger_mints TEXT,  -- JSON array
            trigger_tickers TEXT,  -- JSON array
            
            bot_message_id INTEGER NOT NULL,
            bot_from_name TEXT NOT NULL,
            bot_card_json TEXT NOT NULL,  -- parsed card as JSON
            bot_mint TEXT,
            bot_ticker TEXT,
            
            validation_passed INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            UNIQUE(trigger_message_id, bot_message_id)
        )
    """)
    
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_caller_links_trigger 
        ON caller_links(trigger_chat_id, trigger_ts_ms)
    """)
    
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_caller_links_bot 
        ON caller_links(bot_message_id)
    """)
    
    # Get all messages ordered by chat and timestamp
    messages = conn.execute("""
        SELECT 
            message_id,
            chat_id,
            ts_ms,
            from_name,
            from_id,
            text,
            is_service
        FROM tg_norm
        ORDER BY chat_id, ts_ms
    """).fetchall()
    
    linked_count = 0
    trigger_count = 0
    
    # Process messages in order
    for i, msg in enumerate(messages):
        msg_dict = {
            "message_id": msg["message_id"],
            "chat_id": msg["chat_id"],
            "ts_ms": msg["ts_ms"],
            "from_name": msg["from_name"],
            "from_id": msg["from_id"],
            "text": msg["text"],
            "is_service": msg["is_service"],
        }
        
        if not is_trigger_message(msg_dict):
            continue
        
        trigger_count += 1
        trigger_mints, trigger_tickers = extract_trigger_mints_and_tickers(msg_dict["text"])
        
        # Look ahead for bot messages within window
        window_end_ms = msg_dict["ts_ms"] + (window_seconds * 1000)
        bot_cards_found = []
        
        for j in range(i + 1, len(messages)):
            next_msg = messages[j]
            
            # Stop if we've left the chat or exceeded time window
            if next_msg["chat_id"] != msg_dict["chat_id"]:
                break
            if next_msg["ts_ms"] > window_end_ms:
                break
            
            # Skip if not a bot message
            if not is_bot_message({
                "from_name": next_msg["from_name"],
                "is_service": next_msg["is_service"],
            }):
                continue
            
            # Parse bot card
            bot_text = next_msg["text"]
            bot_card = parse_any_bot_card(bot_text)
            
            if not bot_card:
                continue
            
            # Validate link
            validation_passed = validate_link(trigger_mints, trigger_tickers, bot_card)
            
            # Store link
            conn.execute("""
                INSERT OR IGNORE INTO caller_links (
                    trigger_message_id,
                    trigger_chat_id,
                    trigger_ts_ms,
                    trigger_from_id,
                    trigger_from_name,
                    trigger_text,
                    trigger_mints,
                    trigger_tickers,
                    bot_message_id,
                    bot_from_name,
                    bot_card_json,
                    bot_mint,
                    bot_ticker,
                    validation_passed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                msg_dict["message_id"],
                msg_dict["chat_id"],
                msg_dict["ts_ms"],
                msg_dict["from_id"],
                msg_dict["from_name"],
                msg_dict["text"],
                json.dumps(trigger_mints),
                json.dumps(trigger_tickers),
                next_msg["message_id"],
                next_msg["from_name"],
                json.dumps(bot_card, ensure_ascii=False),
                bot_card.get("mint"),
                bot_card.get("ticker"),
                1 if validation_passed else 0,
            ))
            
            bot_cards_found.append({
                "bot": bot_card["bot"],
                "validated": validation_passed,
            })
            linked_count += 1
        
        if bot_cards_found and (trigger_count % 100 == 0):
            print(f"Processed {trigger_count} triggers, {linked_count} links created...")
    
    conn.commit()
    conn.close()
    
    return trigger_count, linked_count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="tele.db", help="SQLite database path")
    ap.add_argument("--window", type=int, default=60, help="Time window in seconds (default: 60)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    
    if not args.quiet:
        print(f"Linking callers in {args.db}...")
        print(f"Window: {args.window}s")
    
    trigger_count, linked_count = link_callers(args.db, args.window)
    
    if not args.quiet:
        print(f"\nDONE")
        print(f"Triggers found: {trigger_count}")
        print(f"Bot card links created: {linked_count}")


if __name__ == "__main__":
    main()

