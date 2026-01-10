#!/usr/bin/env python3
"""
Migrate calls from caller_links_d to user_calls_d

This script populates the user_calls_d table from caller_links_d data.
It handles the schema differences and deduplicates calls.
"""

import duckdb
import sys
from datetime import datetime
from pathlib import Path

def migrate(db_path: str, dry_run: bool = False):
    """Migrate calls from caller_links_d to user_calls_d"""
    con = duckdb.connect(db_path)
    
    print(f"Connecting to: {db_path}")
    
    # Check if user_calls_d exists
    tables = [t[0] for t in con.execute("SHOW TABLES").fetchall()]
    if 'user_calls_d' not in tables:
        print("ERROR: user_calls_d table does not exist!")
        print("Run the schema creation script first.")
        sys.exit(1)
    
    # Check caller_links_d
    if 'caller_links_d' not in tables:
        print("ERROR: caller_links_d table does not exist!")
        sys.exit(1)
    
    # Count existing calls in user_calls_d
    existing_count = con.execute("SELECT COUNT(*) FROM user_calls_d").fetchone()[0]
    print(f"Existing calls in user_calls_d: {existing_count:,}")
    
    # Count calls in caller_links_d
    caller_links_count = con.execute("""
        SELECT COUNT(DISTINCT trigger_chat_id || '|' || CAST(trigger_message_id AS VARCHAR))
        FROM caller_links_d
        WHERE mint IS NOT NULL 
          AND TRIM(CAST(mint AS VARCHAR)) != ''
          AND trigger_ts_ms IS NOT NULL
    """).fetchone()[0]
    print(f"Unique calls in caller_links_d: {caller_links_count:,}")
    
    # Query to extract calls from caller_links_d
    # We need to deduplicate by (chat_id, message_id) and pick the best bot reply
    migration_query = """
    WITH ranked_calls AS (
        SELECT DISTINCT
            trigger_chat_id as chat_id,
            trigger_message_id as message_id,
            trigger_ts_ms as call_ts_ms,
            to_timestamp(trigger_ts_ms / 1000.0) as call_datetime,
            trigger_from_name as caller_name,
            trigger_from_id as caller_id,
            trigger_text,
            -- Prefer rick bot reply, then phanes, then any other
            FIRST_VALUE(bot_message_id) OVER (
                PARTITION BY trigger_chat_id, trigger_message_id
                ORDER BY 
                    CASE bot_type 
                        WHEN 'rick' THEN 1
                        WHEN 'phanes' THEN 2
                        ELSE 3
                    END,
                    bot_message_id
            ) as bot_reply_id_1,
            FIRST_VALUE(bot_message_id) OVER (
                PARTITION BY trigger_chat_id, trigger_message_id
                ORDER BY 
                    CASE bot_type 
                        WHEN 'phanes' THEN 1
                        WHEN 'rick' THEN 2
                        ELSE 3
                    END,
                    bot_message_id
            ) as bot_reply_id_2,
            mint,
            ticker,
            mcap_usd,
            price_usd,
            -- Mark as first caller if this is the earliest call for this mint+chat
            ROW_NUMBER() OVER (
                PARTITION BY mint, trigger_chat_id
                ORDER BY trigger_ts_ms ASC
            ) = 1 as first_caller,
            -- Determine token resolution method
            CASE 
                WHEN mint_validation_status = 'pass2_accepted' THEN 'bot_reply_validation'
                WHEN mint IS NOT NULL AND mint != '' THEN 'bot_reply_extraction'
                ELSE 'unknown'
            END as token_resolution_method,
            run_id,
            inserted_at
        FROM caller_links_d
        WHERE mint IS NOT NULL 
          AND TRIM(CAST(mint AS VARCHAR)) != ''
          AND trigger_ts_ms IS NOT NULL
    ),
    deduplicated AS (
        SELECT 
            chat_id,
            message_id,
            call_ts_ms,
            call_datetime,
            caller_name,
            caller_id,
            trigger_text,
            bot_reply_id_1,
            bot_reply_id_2,
            mint,
            ticker,
            mcap_usd,
            price_usd,
            first_caller,
            token_resolution_method,
            run_id,
            inserted_at,
            ROW_NUMBER() OVER (
                PARTITION BY chat_id, message_id
                ORDER BY 
                    CASE WHEN bot_reply_id_1 IS NOT NULL THEN 1 ELSE 2 END,
                    call_ts_ms
            ) as rn
        FROM ranked_calls
    )
    SELECT 
        chat_id,
        message_id,
        call_ts_ms,
        call_datetime,
        caller_name,
        caller_id,
        trigger_text,
        bot_reply_id_1,
        bot_reply_id_2,
        mint,
        ticker,
        mcap_usd,
        price_usd,
        first_caller,
        token_resolution_method,
        run_id,
        inserted_at
    FROM deduplicated
    WHERE rn = 1
    ORDER BY call_ts_ms DESC
    """
    
    # Get calls to migrate
    calls_to_migrate = con.execute(migration_query).fetchall()
    cols = [desc[0] for desc in con.execute(migration_query).description]
    
    print(f"\nCalls to migrate: {len(calls_to_migrate):,}")
    
    if dry_run:
        print("\nDRY RUN - Would insert:")
        for i, call in enumerate(calls_to_migrate[:5]):
            call_dict = dict(zip(cols, call))
            print(f"  {i+1}. {call_dict['caller_name']} - {call_dict['mint'][:20]}... - {call_dict['call_datetime']}")
        if len(calls_to_migrate) > 5:
            print(f"  ... and {len(calls_to_migrate) - 5} more")
        return
    
    # Check for duplicates (calls that already exist)
    existing_calls = con.execute("""
        SELECT chat_id, message_id, run_id
        FROM user_calls_d
    """).fetchall()
    existing_keys = {(r[0], r[1], r[2]) for r in existing_calls}
    
    new_calls = []
    duplicate_count = 0
    
    for call in calls_to_migrate:
        call_dict = dict(zip(cols, call))
        key = (call_dict['chat_id'], call_dict['message_id'], call_dict['run_id'])
        if key not in existing_keys:
            new_calls.append(call)
        else:
            duplicate_count += 1
    
    print(f"New calls to insert: {len(new_calls):,}")
    print(f"Duplicates (skipping): {duplicate_count:,}")
    
    if len(new_calls) == 0:
        print("\nNo new calls to migrate.")
        return
    
    # Insert calls
    print("\nInserting calls...")
    insert_query = """
    INSERT INTO user_calls_d (
        chat_id, message_id, call_ts_ms, call_datetime,
        caller_name, caller_id, trigger_text,
        bot_reply_id_1, bot_reply_id_2,
        mint, ticker, mcap_usd, price_usd,
        first_caller, token_resolution_method,
        run_id, inserted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    
    inserted = 0
    for call in new_calls:
        call_dict = dict(zip(cols, call))
        try:
            con.execute(insert_query, [
                call_dict['chat_id'],
                call_dict['message_id'],
                call_dict['call_ts_ms'],
                call_dict['call_datetime'],
                call_dict['caller_name'],
                call_dict['caller_id'],
                call_dict['trigger_text'],
                call_dict['bot_reply_id_1'],
                call_dict['bot_reply_id_2'],
                call_dict['mint'],
                call_dict['ticker'],
                call_dict['mcap_usd'],
                call_dict['price_usd'],
                call_dict['first_caller'],
                call_dict['token_resolution_method'],
                call_dict['run_id'],
                call_dict['inserted_at'] or datetime.now(),
            ])
            inserted += 1
            if inserted % 100 == 0:
                print(f"  Inserted {inserted:,} calls...")
        except Exception as e:
            print(f"  Error inserting call {call_dict['chat_id']}/{call_dict['message_id']}: {e}")
    
    con.commit()
    print(f"\n✓ Migration complete!")
    print(f"  Inserted: {inserted:,} calls")
    
    # Final count
    final_count = con.execute("SELECT COUNT(*) FROM user_calls_d").fetchone()[0]
    print(f"  Total calls in user_calls_d: {final_count:,}")
    
    con.close()

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Migrate calls from caller_links_d to user_calls_d')
    parser.add_argument('--db', default='data/result.duckdb', help='Path to DuckDB file')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be migrated without inserting')
    args = parser.parse_args()
    
    if not Path(args.db).exists():
        print(f"ERROR: Database not found: {args.db}")
        sys.exit(1)
    
    migrate(args.db, dry_run=args.dry_run)

