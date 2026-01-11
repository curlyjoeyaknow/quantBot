"""
Store token creation info operation.

Pure DuckDB logic: stores token creation info from Birdeye API.
This table is created in the main section (not in a schema).
"""

from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import duckdb
from datetime import datetime


def setup_token_creation_info_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Setup token creation info table schema in main section."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS token_creation_info (
            token_address VARCHAR NOT NULL PRIMARY KEY,
            tx_hash VARCHAR NOT NULL,
            slot BIGINT NOT NULL,
            decimals INTEGER NOT NULL,
            owner VARCHAR NOT NULL,
            block_unix_time BIGINT NOT NULL,
            block_human_time TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Create index for efficient queries by token address
    try:
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_token_creation_info_token_address 
            ON token_creation_info(token_address)
        """)
    except Exception:
        # Index may already exist
        pass
    
    # Create index for queries by creation time
    try:
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_token_creation_info_block_unix_time 
            ON token_creation_info(block_unix_time)
        """)
    except Exception:
        # Index may already exist
        pass


class TokenCreationInfoItem(BaseModel):
    token_address: str
    tx_hash: str
    slot: int
    decimals: int
    owner: str
    block_unix_time: int
    block_human_time: str  # ISO format timestamp


class StoreTokenCreationInfoInput(BaseModel):
    tokens: List[TokenCreationInfoItem]


class StoreTokenCreationInfoOutput(BaseModel):
    success: bool
    stored_count: Optional[int] = None
    error: Optional[str] = None


def run(
    con: duckdb.DuckDBPyConnection, input: StoreTokenCreationInfoInput
) -> StoreTokenCreationInfoOutput:
    """Store token creation info in DuckDB."""
    try:
        # Ensure schema exists
        setup_token_creation_info_schema(con)
        
        stored_count = 0
        
        for token in input.tokens:
            # Parse ISO timestamp to ensure proper format
            try:
                block_human_time = datetime.fromisoformat(
                    token.block_human_time.replace('Z', '+00:00')
                )
            except (ValueError, AttributeError):
                # Fallback: try parsing as is, or use current time
                try:
                    block_human_time = datetime.fromisoformat(token.block_human_time)
                except (ValueError, AttributeError):
                    block_human_time = datetime.fromtimestamp(token.block_unix_time)
            
            # Use DuckDB's INSERT ... ON CONFLICT ... DO UPDATE syntax for upsert
            # This preserves created_at for existing records
            try:
                con.execute(
                    """
                    INSERT INTO token_creation_info (
                        token_address,
                        tx_hash,
                        slot,
                        decimals,
                        owner,
                        block_unix_time,
                        block_human_time,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (token_address) DO UPDATE SET
                        tx_hash = EXCLUDED.tx_hash,
                        slot = EXCLUDED.slot,
                        decimals = EXCLUDED.decimals,
                        owner = EXCLUDED.owner,
                        block_unix_time = EXCLUDED.block_unix_time,
                        block_human_time = EXCLUDED.block_human_time,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    [
                        token.token_address,
                        token.tx_hash,
                        token.slot,
                        token.decimals,
                        token.owner,
                        token.block_unix_time,
                        block_human_time,
                    ],
                )
            except Exception as e:
                # Fallback: If ON CONFLICT is not supported, use DELETE + INSERT
                if 'CONFLICT' in str(e) or 'conflict' in str(e).lower():
                    # Delete existing record if it exists
                    con.execute(
                        "DELETE FROM token_creation_info WHERE token_address = ?",
                        [token.token_address],
                    )
                    # Insert new record
                    con.execute(
                        """
                        INSERT INTO token_creation_info (
                            token_address,
                            tx_hash,
                            slot,
                            decimals,
                            owner,
                            block_unix_time,
                            block_human_time,
                            created_at,
                            updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """,
                        [
                            token.token_address,
                            token.tx_hash,
                            token.slot,
                            token.decimals,
                            token.owner,
                            token.block_unix_time,
                            block_human_time,
                        ],
                    )
                else:
                    raise
            stored_count += 1
        
        return StoreTokenCreationInfoOutput(success=True, stored_count=stored_count)
    except Exception as e:
        return StoreTokenCreationInfoOutput(success=False, error=str(e))

