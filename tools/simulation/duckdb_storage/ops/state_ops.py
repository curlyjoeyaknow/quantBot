"""
State management operations for DuckDB.

Pure DuckDB logic: key-value state storage for idempotency and checkpoints.
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import json
import duckdb


def setup_state_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Setup state table schema."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS workflow_state_d (
            key VARCHAR NOT NULL,
            namespace VARCHAR NOT NULL DEFAULT 'default',
            value TEXT NOT NULL,
            expires_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            PRIMARY KEY (key, namespace)
        )
    """)
    # Index for expiration cleanup (DuckDB doesn't support partial indexes, so we create a regular index)
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_workflow_state_expires_at 
        ON workflow_state_d(expires_at)
    """)


# Get State Operation
class GetStateInput(BaseModel):
    key: str
    namespace: Optional[str] = 'default'


class GetStateOutput(BaseModel):
    success: bool
    found: bool
    value: Optional[str] = None
    error: Optional[str] = None


def get_state_run(con: duckdb.DuckDBPyConnection, input: GetStateInput) -> GetStateOutput:
    """Get state value by key."""
    try:
        setup_state_schema(con)
        
        namespace = input.namespace or 'default'
        now = datetime.now()
        
        result = con.execute("""
            SELECT value, expires_at
            FROM workflow_state_d
            WHERE key = ? AND namespace = ?
        """, [input.key, namespace]).fetchone()
        
        if not result:
            return GetStateOutput(success=True, found=False)
        
        value, expires_at = result
        
        # Check expiration
        if expires_at and expires_at < now:
            # Delete expired entry (requires write access, which we have)
            con.execute("""
                DELETE FROM workflow_state_d
                WHERE key = ? AND namespace = ?
            """, [input.key, namespace])
            # Note: DuckDB doesn't use explicit commits, but we keep this for clarity
            return GetStateOutput(success=True, found=False)
        
        return GetStateOutput(success=True, found=True, value=value)
    except Exception as e:
        return GetStateOutput(success=False, found=False, error=str(e))


# Set State Operation
class SetStateInput(BaseModel):
    key: str
    namespace: Optional[str] = 'default'
    value: str
    ttl_seconds: Optional[int] = None


class SetStateOutput(BaseModel):
    success: bool
    error: Optional[str] = None


def set_state_run(con: duckdb.DuckDBPyConnection, input: SetStateInput) -> SetStateOutput:
    """Set state value by key."""
    try:
        setup_state_schema(con)
        
        namespace = input.namespace or 'default'
        now = datetime.now()
        expires_at = None
        
        if input.ttl_seconds:
            from datetime import timedelta
            expires_at = now + timedelta(seconds=input.ttl_seconds)
        
        # Check if key exists to preserve created_at
        existing = con.execute("""
            SELECT created_at FROM workflow_state_d
            WHERE key = ? AND namespace = ?
        """, [input.key, namespace]).fetchone()
        
        created_at = existing[0] if existing else now
        
        con.execute("""
            INSERT OR REPLACE INTO workflow_state_d
            (key, namespace, value, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            input.key,
            namespace,
            input.value,
            expires_at,
            created_at,
            now,
        ])
        # Note: DuckDB doesn't use explicit commits, but we keep this for clarity
        return SetStateOutput(success=True)
    except Exception as e:
        return SetStateOutput(success=False, error=str(e))


# Delete State Operation
class DeleteStateInput(BaseModel):
    key: str
    namespace: Optional[str] = 'default'


class DeleteStateOutput(BaseModel):
    success: bool
    error: Optional[str] = None


def delete_state_run(con: duckdb.DuckDBPyConnection, input: DeleteStateInput) -> DeleteStateOutput:
    """Delete state value by key."""
    try:
        setup_state_schema(con)
        
        namespace = input.namespace or 'default'
        
        con.execute("""
            DELETE FROM workflow_state_d
            WHERE key = ? AND namespace = ?
        """, [input.key, namespace])
        # Note: DuckDB doesn't use explicit commits, but we keep this for clarity
        return DeleteStateOutput(success=True)
    except Exception as e:
        return DeleteStateOutput(success=False, error=str(e))


# Init State Table Operation (for explicit initialization)
class InitStateTableInput(BaseModel):
    pass


class InitStateTableOutput(BaseModel):
    success: bool
    error: Optional[str] = None


def init_state_table_run(con: duckdb.DuckDBPyConnection, input: InitStateTableInput) -> InitStateTableOutput:
    """Initialize state table schema."""
    try:
        setup_state_schema(con)
        # Note: DuckDB doesn't use explicit commits, but we keep this for clarity
        return InitStateTableOutput(success=True)
    except Exception as e:
        return InitStateTableOutput(success=False, error=str(e))

