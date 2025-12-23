"""
DuckDB storage operations.

Each operation is a pure function with typed input/output.
No cross-operation imports. No side effects outside DuckDB.
"""

from .store_strategy import StoreStrategyInput, StoreStrategyOutput, run as store_strategy_run
from .store_run import StoreRunInput, StoreRunOutput, run as store_run_run
from .query_calls import QueryCallsInput, QueryCallsOutput, run as query_calls_run
from .update_ohlcv_metadata import UpdateOhlcvMetadataInput, UpdateOhlcvMetadataOutput, run as update_ohlcv_metadata_run
from .query_ohlcv_metadata import QueryOhlcvMetadataInput, QueryOhlcvMetadataOutput, run as query_ohlcv_metadata_run
from .add_ohlcv_exclusion import AddOhlcvExclusionInput, AddOhlcvExclusionOutput, run as add_ohlcv_exclusion_run
from .query_ohlcv_exclusions import QueryOhlcvExclusionsInput, QueryOhlcvExclusionsOutput, run as query_ohlcv_exclusions_run
from .query_tokens_recent import QueryTokensRecentInput, QueryTokensRecentOutput, run as query_tokens_recent_run
from .generate_report import GenerateReportInput, GenerateReportOutput, run as generate_report_run
from .state_ops import (
    GetStateInput,
    GetStateOutput,
    get_state_run,
    SetStateInput,
    SetStateOutput,
    set_state_run,
    DeleteStateInput,
    DeleteStateOutput,
    delete_state_run,
    InitStateTableInput,
    InitStateTableOutput,
    init_state_table_run,
)

__all__ = [
    # Store strategy
    "StoreStrategyInput",
    "StoreStrategyOutput",
    "store_strategy_run",
    # Store run
    "StoreRunInput",
    "StoreRunOutput",
    "store_run_run",
    # Query calls
    "QueryCallsInput",
    "QueryCallsOutput",
    "query_calls_run",
    # Update OHLCV metadata
    "UpdateOhlcvMetadataInput",
    "UpdateOhlcvMetadataOutput",
    "update_ohlcv_metadata_run",
    # Query OHLCV metadata
    "QueryOhlcvMetadataInput",
    "QueryOhlcvMetadataOutput",
    "query_ohlcv_metadata_run",
    # Add OHLCV exclusion
    "AddOhlcvExclusionInput",
    "AddOhlcvExclusionOutput",
    "add_ohlcv_exclusion_run",
    # Query OHLCV exclusions
    "QueryOhlcvExclusionsInput",
    "QueryOhlcvExclusionsOutput",
    "query_ohlcv_exclusions_run",
    # Query tokens recent
    "QueryTokensRecentInput",
    "QueryTokensRecentOutput",
    "query_tokens_recent_run",
    # Generate report
    "GenerateReportInput",
    "GenerateReportOutput",
    "generate_report_run",
    # State operations
    "GetStateInput",
    "GetStateOutput",
    "get_state_run",
    "SetStateInput",
    "SetStateOutput",
    "set_state_run",
    "DeleteStateInput",
    "DeleteStateOutput",
    "delete_state_run",
    "InitStateTableInput",
    "InitStateTableOutput",
    "init_state_table_run",
]
