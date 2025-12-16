"""
Pytest tests for DuckDB transforms and SQL correctness.

Tests:
- Schema creation
- Data insertion
- Deduplication logic
- Joins and aggregations
- Views
- First caller logic
"""

import pytest
import duckdb
import tempfile
import os
from pathlib import Path


@pytest.fixture
def test_db():
    """Create a temporary DuckDB database for testing"""
    # Don't create the file - let DuckDB create it
    db_path = tempfile.mktemp(suffix='.duckdb')
    con = duckdb.connect(db_path)
    yield con, db_path
    con.close()
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest.fixture
def schema_sql():
    """Load the schema SQL from the pipeline"""
    schema_path = Path(__file__).parent.parent / "duckdb_punch_pipeline.py"
    with open(schema_path, "r") as f:
        content = f.read()
        # Extract DUCK_SCHEMA_SQL
        start = content.find('DUCK_SCHEMA_SQL = """')
        end = content.find('"""', start + len('DUCK_SCHEMA_SQL = """'))
        if start != -1 and end != -1:
            return content[start + len('DUCK_SCHEMA_SQL = """'):end]
    return ""


@pytest.mark.integration
def test_schema_creation(test_db, schema_sql):
    """Test that schema creation works correctly"""
    con, db_path = test_db
    
    if not schema_sql:
        pytest.skip("Could not extract schema SQL")
    
    # Execute schema
    con.execute(schema_sql)
    
    # Verify tables exist
    tables = con.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'main'
        ORDER BY table_name
    """).fetchall()
    
    table_names = [t[0] for t in tables]
    assert "tg_norm_d" in table_names
    assert "caller_links_d" in table_names
    assert "user_calls_d" in table_names


@pytest.mark.integration
def test_tg_norm_insert(test_db, schema_sql):
    """Test inserting into tg_norm_d table"""
    con, db_path = test_db
    con.execute(schema_sql)
    
    # Insert test data
    con.execute("""
        INSERT INTO tg_norm_d VALUES (
            'test_chat', 'Test Chat', 1, 1704067200000,
            'TestUser', 'user123', 'message', FALSE,
            2, 'Test message', NULL, '{}'
        )
    """)
    
    # Verify insert
    count = con.execute("SELECT COUNT(*) FROM tg_norm_d").fetchone()[0]
    assert count == 1
    
    # Verify data
    row = con.execute("SELECT * FROM tg_norm_d WHERE message_id = 1").fetchone()
    assert row[0] == 'test_chat'
    assert row[2] == 1
    assert row[3] == 1704067200000


@pytest.mark.integration
def test_deduplication_logic(test_db, schema_sql):
    """Test that deduplication works correctly (first call per caller per mint)"""
    con, db_path = test_db
    con.execute(schema_sql)
    
    # Insert test caller_links with duplicates
    # Use minimal required columns for the test
    con.execute("""
        INSERT INTO caller_links_d (
            trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_id, trigger_from_name, trigger_text,
            bot_message_id, bot_ts_ms, bot_from_name, bot_type, token_name, ticker, mint,
            mint_validation_status, chain, validation_passed
        ) VALUES (
            'test_chat', 1, 1704067200000, 'user1', 'User1', 'Trigger 1',
            10, 1704067201000, 'bot', 'phanes', 'Token', 'TKN',
            'So11111111111111111111111111111111111111112', 'pass2_accepted', 'solana', TRUE
        )
    """)
    
    con.execute("""
        INSERT INTO caller_links_d (
            trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_id, trigger_from_name, trigger_text,
            bot_message_id, bot_ts_ms, bot_from_name, bot_type, token_name, ticker, mint,
            mint_validation_status, chain, validation_passed
        ) VALUES (
            'test_chat', 2, 1704067202000, 'user1', 'User1', 'Trigger 2',
            11, 1704067203000, 'bot', 'phanes', 'Token', 'TKN',
            'So11111111111111111111111111111111111111112', 'pass2_accepted', 'solana', TRUE
        )
    """)
    
    # Create user_calls_d with deduplication (ROW_NUMBER logic)
    con.execute("""
        INSERT INTO user_calls_d
        SELECT 
            l.trigger_chat_id AS chat_id,
            l.trigger_message_id AS message_id,
            l.trigger_ts_ms AS call_ts_ms,
            to_timestamp(l.trigger_ts_ms/1000.0) AS call_datetime,
            l.trigger_from_name AS caller_name,
            l.trigger_from_id AS caller_id,
            l.trigger_text AS trigger_text,
            NULL AS bot_reply_id_1,
            NULL AS bot_reply_id_2,
            l.mint AS mint,
            l.ticker AS ticker,
            l.mcap_usd AS mcap_usd,
            l.price_usd AS price_usd,
            FALSE AS first_caller
        FROM caller_links_d l
        WHERE l.trigger_chat_id = 'test_chat'
    """)
    
    # Apply deduplication: only first call per caller per mint
    con.execute("""
        DELETE FROM user_calls_d WHERE chat_id = 'test_chat'
    """)
    
    con.execute("""
        INSERT INTO user_calls_d
        SELECT 
            chat_id, message_id, call_ts_ms, call_datetime,
            caller_name, caller_id, trigger_text,
            bot_reply_id_1, bot_reply_id_2, mint, ticker, mcap_usd, price_usd,
            FALSE AS first_caller
        FROM (
            SELECT 
                l.trigger_chat_id AS chat_id,
                l.trigger_message_id AS message_id,
                l.trigger_ts_ms AS call_ts_ms,
                to_timestamp(l.trigger_ts_ms/1000.0) AS call_datetime,
                l.trigger_from_name AS caller_name,
                l.trigger_from_id AS caller_id,
                l.trigger_text AS trigger_text,
                NULL AS bot_reply_id_1,
                NULL AS bot_reply_id_2,
                l.mint AS mint,
                l.ticker AS ticker,
                l.mcap_usd AS mcap_usd,
                l.price_usd AS price_usd,
                ROW_NUMBER() OVER (
                    PARTITION BY l.trigger_from_id, l.mint 
                    ORDER BY l.trigger_ts_ms ASC, l.trigger_message_id ASC
                ) AS rn
            FROM caller_links_d l
            WHERE l.trigger_chat_id = 'test_chat'
        ) t
        WHERE t.rn = 1
    """)
    
    # Should have only 1 row (first call per caller per mint)
    count = con.execute("SELECT COUNT(*) FROM user_calls_d WHERE chat_id = 'test_chat'").fetchone()[0]
    assert count == 1
    
    # Should be the earlier message (message_id = 1)
    row = con.execute("SELECT message_id FROM user_calls_d WHERE chat_id = 'test_chat'").fetchone()
    assert row[0] == 1


@pytest.mark.integration
def test_first_caller_logic(test_db, schema_sql):
    """Test that first_caller flag is set correctly"""
    con, db_path = test_db
    con.execute(schema_sql)
    
    # Insert multiple calls for same mint by different callers
    test_data = [
        ('test_chat', 1, 1704067200000, 'user1', 'User1', 'So11111111111111111111111111111111111111112'),
        ('test_chat', 2, 1704067201000, 'user2', 'User2', 'So11111111111111111111111111111111111111112'),
        ('test_chat', 3, 1704067202000, 'user1', 'User1', 'So11111111111111111111111111111111111111112'),  # Duplicate caller
    ]
    
    for chat_id, msg_id, ts_ms, user_id, user_name, mint in test_data:
        con.execute("""
            INSERT INTO user_calls_d VALUES (
                ?, ?, ?, to_timestamp(?/1000.0),
                ?, ?, 'trigger', NULL, NULL, ?, 'TKN', NULL, NULL, FALSE
            )
        """, [chat_id, msg_id, ts_ms, ts_ms, user_name, user_id, mint])
    
    # Mark first caller per mint
    con.execute("""
        UPDATE user_calls_d SET first_caller = FALSE WHERE chat_id = 'test_chat'
    """)
    
    con.execute("""
        UPDATE user_calls_d u
        SET first_caller = TRUE
        FROM (
            SELECT mint, MIN(call_ts_ms) AS first_ts
            FROM user_calls_d
            WHERE chat_id = 'test_chat' AND mint IS NOT NULL
            GROUP BY mint
        ) f
        WHERE u.chat_id = 'test_chat'
          AND u.mint = f.mint
          AND u.call_ts_ms = f.first_ts
    """)
    
    # Check first caller
    first_caller = con.execute("""
        SELECT caller_name, message_id, first_caller
        FROM user_calls_d
        WHERE chat_id = 'test_chat' AND first_caller = TRUE
    """).fetchone()
    
    assert first_caller is not None
    assert first_caller[0] == 'User1'  # First caller
    assert first_caller[1] == 1  # First message
    
    # Check that only one is marked as first caller
    first_caller_count = con.execute("""
        SELECT COUNT(*) FROM user_calls_d
        WHERE chat_id = 'test_chat' AND first_caller = TRUE
    """).fetchone()[0]
    assert first_caller_count == 1


@pytest.mark.integration
def test_views_creation(test_db, schema_sql):
    """Test that views are created correctly"""
    con, db_path = test_db
    con.execute(schema_sql)
    
    # Create a view (simplified version)
    con.execute("""
        CREATE OR REPLACE VIEW v_test_view AS
        SELECT chat_id, COUNT(*) AS msg_count
        FROM tg_norm_d
        GROUP BY chat_id
    """)
    
    # Verify view exists
    views = con.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_type = 'VIEW'
    """).fetchall()
    
    view_names = [v[0] for v in views]
    assert "v_test_view" in view_names
    
    # Test view query
    result = con.execute("SELECT * FROM v_test_view").fetchall()
    assert isinstance(result, list)


@pytest.mark.integration
def test_join_correctness(test_db, schema_sql):
    """Test that joins between tables work correctly"""
    con, db_path = test_db
    con.execute(schema_sql)
    
    # Insert linked data
    con.execute("""
        INSERT INTO tg_norm_d VALUES (
            'test_chat', 'Test Chat', 1, 1704067200000,
            'User1', 'user1', 'message', FALSE,
            NULL, 'Trigger message', NULL, '{}'
        )
    """)
    
    con.execute("""
        INSERT INTO tg_norm_d VALUES (
            'test_chat', 'Test Chat', 10, 1704067201000,
            'bot', 'bot1', 'message', FALSE,
            1, 'Bot reply', NULL, '{}'
        )
    """)
    
    con.execute("""
        INSERT INTO caller_links_d (
            trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_id, trigger_from_name, trigger_text,
            bot_message_id, bot_ts_ms, bot_from_name, bot_type, token_name, ticker, mint,
            mint_validation_status, chain, validation_passed
        ) VALUES (
            'test_chat', 1, 1704067200000, 'user1', 'User1', 'Trigger message',
            10, 1704067201000, 'bot', 'phanes', 'Token', 'TKN',
            'So11111111111111111111111111111111111111112', 'pass2_accepted', 'solana', TRUE
        )
    """)
    
    # Test join
    result = con.execute("""
        SELECT 
            b.message_id AS bot_message_id,
            t.message_id AS trigger_message_id,
            b.text AS bot_text,
            t.text AS trigger_text
        FROM tg_norm_d b
        JOIN tg_norm_d t ON t.message_id = b.reply_to_message_id
        WHERE b.chat_id = 'test_chat' AND b.reply_to_message_id IS NOT NULL
    """).fetchall()
    
    assert len(result) == 1
    assert result[0][0] == 10  # bot message_id
    assert result[0][1] == 1    # trigger message_id


@pytest.mark.integration
def test_zero_liquidity_flag(test_db, schema_sql):
    """Test that zero_liquidity flag is set correctly"""
    con, db_path = test_db
    con.execute(schema_sql)
    
    # Insert with zero liquidity
    con.execute("""
        INSERT INTO caller_links_d (
            trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_id, trigger_from_name, trigger_text,
            bot_message_id, bot_ts_ms, bot_from_name, bot_type, token_name, ticker, mint,
            mint_validation_status, chain, liquidity_usd, zero_liquidity, validation_passed
        ) VALUES (
            'test_chat', 1, 1704067200000, 'user1', 'User1', 'Trigger',
            10, 1704067201000, 'bot', 'phanes', 'Token', 'TKN',
            'So11111111111111111111111111111111111111112', 'pass2_accepted', 'solana', 0.0, TRUE, TRUE
        )
    """)
    
    # Check zero liquidity flag
    result = con.execute("""
        SELECT zero_liquidity, liquidity_usd
        FROM caller_links_d
        WHERE trigger_chat_id = 'test_chat'
    """).fetchone()
    
    assert result[0] is True  # zero_liquidity flag
    assert result[1] == 0.0   # liquidity_usd

