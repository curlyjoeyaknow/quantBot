"""
Caller group management.

Provides functionality to:
- Define groups of callers by caller_id
- Save/load caller groups from disk
- Filter alerts by caller groups
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import duckdb

UTC = timezone.utc

# Default directory for caller group files
DEFAULT_GROUPS_DIR = Path(__file__).parent.parent / "caller_groups"


@dataclass
class CallerGroup:
    """
    A group of callers for backtesting.
    
    Attributes:
        name: Unique group name
        description: Human-readable description
        caller_ids: Set of caller identifiers (names/IDs)
        created_at: Creation timestamp
        metadata: Optional additional metadata
    """
    name: str
    description: str
    caller_ids: Set[str]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        # Ensure caller_ids is a set
        if isinstance(self.caller_ids, list):
            self.caller_ids = set(self.caller_ids)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "caller_ids": sorted(self.caller_ids),
            "created_at": self.created_at.isoformat(),
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CallerGroup":
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        else:
            created_at = datetime.now(UTC)
        
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            caller_ids=set(data.get("caller_ids", [])),
            created_at=created_at,
            metadata=data.get("metadata", {}),
        )
    
    def matches(self, caller: str) -> bool:
        """Check if a caller matches this group."""
        return caller.strip() in self.caller_ids


def save_caller_group(group: CallerGroup, directory: Optional[Path] = None) -> Path:
    """
    Save a caller group to disk.
    
    Args:
        group: CallerGroup to save
        directory: Directory to save to (default: caller_groups/)
    
    Returns:
        Path to saved file
    """
    if directory is None:
        directory = DEFAULT_GROUPS_DIR
    
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    
    filepath = directory / f"{group.name}.json"
    with open(filepath, "w") as f:
        json.dump(group.to_dict(), f, indent=2)
    
    return filepath


def load_caller_group(name: str, directory: Optional[Path] = None) -> Optional[CallerGroup]:
    """
    Load a caller group from disk.
    
    Args:
        name: Group name (without .json extension)
        directory: Directory to load from
    
    Returns:
        CallerGroup or None if not found
    """
    if directory is None:
        directory = DEFAULT_GROUPS_DIR
    
    filepath = Path(directory) / f"{name}.json"
    if not filepath.exists():
        return None
    
    with open(filepath) as f:
        data = json.load(f)
    
    return CallerGroup.from_dict(data)


def list_caller_groups(directory: Optional[Path] = None) -> List[str]:
    """
    List available caller group names.
    
    Args:
        directory: Directory to scan
    
    Returns:
        List of group names
    """
    if directory is None:
        directory = DEFAULT_GROUPS_DIR
    
    directory = Path(directory)
    if not directory.exists():
        return []
    
    return sorted([
        f.stem for f in directory.glob("*.json")
    ])


def delete_caller_group(name: str, directory: Optional[Path] = None) -> bool:
    """
    Delete a caller group file.
    
    Args:
        name: Group name
        directory: Directory containing groups
    
    Returns:
        True if deleted, False if not found
    """
    if directory is None:
        directory = DEFAULT_GROUPS_DIR
    
    filepath = Path(directory) / f"{name}.json"
    if filepath.exists():
        filepath.unlink()
        return True
    return False


def get_callers_from_duckdb(
    duckdb_path: str,
    min_calls: int = 1,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """
    Get unique callers from DuckDB with their call counts.
    
    Args:
        duckdb_path: Path to DuckDB database
        min_calls: Minimum number of calls to include
        date_from: Optional start date filter
        date_to: Optional end date filter
    
    Returns:
        List of dicts with caller info: {caller, count, first_seen, last_seen}
    """
    from tools.shared.duckdb_adapter import get_readonly_connection
    with get_readonly_connection(duckdb_path) as conn:
        # Check which table exists
        tables = conn.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_name IN ('caller_links_d', 'user_calls_d')
        """).fetchall()
        table_names = [t[0] for t in tables]
        
        if not table_names:
            return []
        
        # Pick table and get its columns
        if "caller_links_d" in table_names:
            table = "caller_links_d"
        else:
            table = "user_calls_d"
        
        cols = [r[1].lower() for r in conn.execute(f"PRAGMA table_info('{table}')").fetchall()]
        
        # Determine timestamp column
        if "trigger_ts_ms" in cols:
            ts_col = "trigger_ts_ms"
        elif "call_ts_ms" in cols:
            ts_col = "call_ts_ms"
        else:
            return []  # No timestamp column found
        
        # Determine caller column expression based on available columns
        if "caller_name" in cols and "trigger_from_name" in cols:
            caller_col = "COALESCE(caller_name, trigger_from_name, '')::TEXT"
        elif "caller_name" in cols:
            caller_col = "COALESCE(caller_name, '')::TEXT"
        elif "trigger_from_name" in cols:
            caller_col = "COALESCE(trigger_from_name, '')::TEXT"
        else:
            return []  # No caller column found
        
        where_clauses = []
        params: List[Any] = []
        
        if date_from:
            where_clauses.append(f"{ts_col} >= ?")
            params.append(int(date_from.timestamp() * 1000))
        
        if date_to:
            where_clauses.append(f"{ts_col} <= ?")
            params.append(int(date_to.timestamp() * 1000))
        
        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
        
        sql = f"""
            SELECT 
                {caller_col} AS caller,
                COUNT(*) AS count,
                MIN({ts_col}) AS first_seen_ms,
                MAX({ts_col}) AS last_seen_ms
            FROM {table}
            WHERE {where_sql}
              AND ({caller_col}) IS NOT NULL
              AND TRIM({caller_col}) != ''
            GROUP BY {caller_col}
            HAVING COUNT(*) >= ?
            ORDER BY COUNT(*) DESC
        """
        params.append(min_calls)
        
        rows = conn.execute(sql, params).fetchall()
        
        results = []
        for caller, count, first_ms, last_ms in rows:
            results.append({
                "caller": caller.strip(),
                "count": int(count),
                "first_seen": datetime.fromtimestamp(first_ms / 1000, tz=UTC).isoformat(),
                "last_seen": datetime.fromtimestamp(last_ms / 1000, tz=UTC).isoformat(),
            })
        
        return results


def create_group_from_top_callers(
    duckdb_path: str,
    group_name: str,
    description: str,
    top_n: int = 20,
    min_calls: int = 10,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    directory: Optional[Path] = None,
) -> CallerGroup:
    """
    Create a caller group from the top N callers by call count.
    
    Args:
        duckdb_path: Path to DuckDB database
        group_name: Name for the new group
        description: Description for the group
        top_n: Number of top callers to include
        min_calls: Minimum calls required
        date_from: Optional date filter
        date_to: Optional date filter
        directory: Directory to save group
    
    Returns:
        Created CallerGroup
    """
    callers = get_callers_from_duckdb(
        duckdb_path=duckdb_path,
        min_calls=min_calls,
        date_from=date_from,
        date_to=date_to,
    )
    
    top_caller_ids = {c["caller"] for c in callers[:top_n]}
    
    group = CallerGroup(
        name=group_name,
        description=description,
        caller_ids=top_caller_ids,
        metadata={
            "source": "top_callers",
            "top_n": top_n,
            "min_calls": min_calls,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "duckdb_path": duckdb_path,
        },
    )
    
    save_caller_group(group, directory)
    return group

