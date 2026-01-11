"""Auto-generated Python type stubs from Zod schemas."""

from typing import List
from typing import Optional
from typing import TypedDict


class TokenSliceExportConfig(TypedDict, total=False):
    """
    TokenSliceExportConfig type definition.
    Auto-generated from Zod schema.
    """
    # Required fields
    mint: str
    alert_ts_ms: int
    output_dir: str

    # Optional fields
    chain: str  # default: 'solana'
    interval_seconds: int  # default: 60
    horizon_hours: int  # default: 48
    pre_window_minutes: int  # default: 5
    duckdb: Optional[str]

class BatchSliceExportConfig(TypedDict, total=False):
    """
    BatchSliceExportConfig type definition.
    Auto-generated from Zod schema.
    """
    # Required fields
    duckdb: str
    from_: str  # from in TypeScript
    to: str
    output_dir: str

    # Optional fields
    chain: str  # default: 'solana'
    interval_seconds: int  # default: 60
    horizon_hours: int  # default: 48
    pre_window_minutes: int  # default: 5
    threads: int  # default: 16
    reuse_slice: bool  # default: False

class SliceExportResult(TypedDict, total=False):
    """
    SliceExportResult type definition.
    Auto-generated from Zod schema.
    """
    # Required fields
    success: bool
    mint: str
    slice_path: str
    candles: int

    # Optional fields
    error: Optional[str]

class BatchSliceExportResult(TypedDict):
    """
    BatchSliceExportResult type definition.
    Auto-generated from Zod schema.
    """
    success: bool
    total_slices: int
    successful: int
    failed: int
    output_dir: str
    slices: List[SliceExportResult]
