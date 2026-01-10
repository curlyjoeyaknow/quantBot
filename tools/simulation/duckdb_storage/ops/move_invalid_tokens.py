"""
Move invalid tokens to separate table and update caller statistics

When a token fails all validation methods, this operation:
1. Moves the token's calls from user_calls_d and caller_links_d to invalid_tokens_d
2. Updates caller statistics (decrements call counts)
"""

from pydantic import BaseModel, Field
from typing import Optional, List
import duckdb
from datetime import datetime

class MoveInvalidTokensInput(BaseModel):
    """Input for moving invalid tokens"""
    mints: List[str] = Field(description="List of invalid mint addresses to move")
    dry_run: bool = Field(default=False, description="If True, only report what would be moved without actually moving")


class TokenMoveResult(BaseModel):
    """Result of moving a single invalid token"""
    mint: str
    calls_moved: int
    links_moved: int
    callers_affected: List[str] = []
    error: Optional[str] = None


class MoveInvalidTokensOutput(BaseModel):
    """Output from moving invalid tokens"""
    success: bool
    dry_run: bool
    total_calls_moved: int = 0
    total_links_moved: int = 0
    total_callers_affected: int = 0
    moves: Optional[List[TokenMoveResult]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: MoveInvalidTokensInput) -> MoveInvalidTokensOutput:
    """
    Move invalid tokens to separate table and update caller statistics
    """
    try:
        # Create invalid_tokens_d table if it doesn't exist
        # This table stores calls for tokens that failed all validation methods
        con.execute("""
            CREATE TABLE IF NOT EXISTS invalid_tokens_d (
                chat_id TEXT,
                message_id BIGINT,
                call_ts_ms BIGINT,
                call_datetime TIMESTAMP,
                caller_name TEXT,
                caller_id TEXT,
                trigger_text TEXT,
                bot_reply_id_1 BIGINT,
                bot_reply_id_2 BIGINT,
                mint TEXT,
                ticker TEXT,
                mcap_usd DOUBLE,
                price_usd DOUBLE,
                first_caller BOOLEAN DEFAULT FALSE,
                token_resolution_method TEXT,
                validation_error TEXT,
                moved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                source_table TEXT NOT NULL
            )
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_invalid_tokens_mint 
            ON invalid_tokens_d(mint)
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_invalid_tokens_caller 
            ON invalid_tokens_d(caller_name)
        """)

        moves: List[TokenMoveResult] = []
        total_calls_moved = 0
        total_links_moved = 0
        all_callers_affected = set()

        for mint in input.mints:
            try:
                # Get calls for this mint from user_calls_d
                calls_query = """
                    SELECT 
                        chat_id, message_id, call_ts_ms, call_datetime,
                        caller_name, caller_id, trigger_text,
                        bot_reply_id_1, bot_reply_id_2, mint, ticker,
                        mcap_usd, price_usd, first_caller, token_resolution_method
                    FROM user_calls_d
                    WHERE mint = ?
                """
                calls = con.execute(calls_query, [mint]).fetchall()
                
                # Get links for this mint from caller_links_d
                links_query = """
                    SELECT 
                        trigger_chat_id, trigger_message_id, trigger_ts_ms,
                        trigger_from_id, trigger_from_name, trigger_text,
                        bot_message_id, bot_ts_ms, bot_from_name, bot_type,
                        token_name, ticker, mint, mint_raw, mint_validation_status,
                        mint_validation_reason, chain, platform, token_age_s,
                        token_created_ts_ms, views, price_usd, price_move_pct,
                        mcap_usd, mcap_change_pct, vol_usd, liquidity_usd,
                        zero_liquidity, chg_1h_pct, buys_1h, sells_1h,
                        ath_mcap_usd, ath_drawdown_pct, ath_age_s,
                        fresh_1d_pct, fresh_7d_pct, top10_pct, holders_total,
                        top5_holders_pct_json, dev_sold, dex_paid, card_json,
                        validation_passed
                    FROM caller_links_d
                    WHERE mint = ?
                """
                links = con.execute(links_query, [mint]).fetchall()
                
                # Collect unique caller names for statistics update
                callers_affected = set()
                for call in calls:
                    if call[4]:  # caller_name
                        callers_affected.add(call[4])
                
                if not input.dry_run:
                    # Move calls to invalid_tokens_d
                    for call in calls:
                        con.execute("""
                            INSERT INTO invalid_tokens_d (
                                chat_id, message_id, call_ts_ms, call_datetime,
                                caller_name, caller_id, trigger_text,
                                bot_reply_id_1, bot_reply_id_2, mint, ticker,
                                mcap_usd, price_usd, first_caller, token_resolution_method,
                                validation_error, source_table
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user_calls_d')
                        """, (
                            call[0], call[1], call[2], call[3],  # chat_id, message_id, call_ts_ms, call_datetime
                            call[4], call[5], call[6],           # caller_name, caller_id, trigger_text
                            call[7], call[8], call[9], call[10], # bot_reply_id_1, bot_reply_id_2, mint, ticker
                            call[11], call[12], call[13], call[14], # mcap_usd, price_usd, first_caller, token_resolution_method
                            'All validation methods failed'
                        ))
                    
                    # Delete calls from user_calls_d
                    con.execute("DELETE FROM user_calls_d WHERE mint = ?", [mint])
                    
                    # Delete links from caller_links_d
                    con.execute("DELETE FROM caller_links_d WHERE mint = ?", [mint])
                
                moves.append(TokenMoveResult(
                    mint=mint,
                    calls_moved=len(calls),
                    links_moved=len(links),
                    callers_affected=list(callers_affected)
                ))
                
                total_calls_moved += len(calls)
                total_links_moved += len(links)
                all_callers_affected.update(callers_affected)
                
            except Exception as e:
                moves.append(TokenMoveResult(
                    mint=mint,
                    calls_moved=0,
                    links_moved=0,
                    error=str(e)
                ))

        return MoveInvalidTokensOutput(
            success=True,
            dry_run=input.dry_run,
            total_calls_moved=total_calls_moved,
            total_links_moved=total_links_moved,
            total_callers_affected=len(all_callers_affected),
            moves=moves if moves else None
        )
        
    except Exception as e:
        return MoveInvalidTokensOutput(
            success=False,
            dry_run=input.dry_run,
            error=str(e)
        )

