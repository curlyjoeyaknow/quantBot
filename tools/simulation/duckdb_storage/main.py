#!/usr/bin/env python3
"""
DuckDB Storage Service CLI Entry Point

Thin CLI layer that:
- Parses arguments
- Validates input with Pydantic
- Dispatches to operation modules
- Outputs JSON to stdout
- Logs to stderr only

The dispatcher is intentionally boring - that's a feature.
"""

import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path to allow imports when run as script
sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.shared.duckdb_adapter import get_readonly_connection, get_write_connection
from duckdb_storage.ops import (
    StoreStrategyInput,
    StoreStrategyOutput,
    store_strategy_run,
    StoreRunInput,
    StoreRunOutput,
    store_run_run,
    QueryCallsInput,
    QueryCallsOutput,
    query_calls_run,
    UpdateOhlcvMetadataInput,
    UpdateOhlcvMetadataOutput,
    update_ohlcv_metadata_run,
    QueryOhlcvMetadataInput,
    QueryOhlcvMetadataOutput,
    query_ohlcv_metadata_run,
    AddOhlcvExclusionInput,
    AddOhlcvExclusionOutput,
    add_ohlcv_exclusion_run,
    QueryOhlcvExclusionsInput,
    QueryOhlcvExclusionsOutput,
    query_ohlcv_exclusions_run,
    QueryTokensRecentInput,
    QueryTokensRecentOutput,
    query_tokens_recent_run,
    ValidateAddressesInput,
    ValidateAddressesOutput,
    validate_addresses_run,
    RemoveFaultyAddressesInput,
    RemoveFaultyAddressesOutput,
    remove_faulty_addresses_run,
    MoveInvalidTokensInput,
    MoveInvalidTokensOutput,
    move_invalid_tokens_run,
    GenerateReportInput,
    GenerateReportOutput,
    generate_report_run,
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
    StoreTokenCreationInfoInput,
    StoreTokenCreationInfoOutput,
    store_token_creation_info_run,
)


# Operation map: maps operation name to (input_model, output_model, run_function)
# This boredom is a feature - it keeps the dispatcher simple and maintainable.
OP_MAP = {
    "store_strategy": (StoreStrategyInput, StoreStrategyOutput, store_strategy_run),
    "store_run": (StoreRunInput, StoreRunOutput, store_run_run),
    "query_calls": (QueryCallsInput, QueryCallsOutput, query_calls_run),
    "update_ohlcv_metadata": (
        UpdateOhlcvMetadataInput,
        UpdateOhlcvMetadataOutput,
        update_ohlcv_metadata_run,
    ),
    "query_ohlcv_metadata": (
        QueryOhlcvMetadataInput,
        QueryOhlcvMetadataOutput,
        query_ohlcv_metadata_run,
    ),
    "add_ohlcv_exclusion": (
        AddOhlcvExclusionInput,
        AddOhlcvExclusionOutput,
        add_ohlcv_exclusion_run,
    ),
    "query_ohlcv_exclusions": (
        QueryOhlcvExclusionsInput,
        QueryOhlcvExclusionsOutput,
        query_ohlcv_exclusions_run,
    ),
    "query_tokens_recent": (
        QueryTokensRecentInput,
        QueryTokensRecentOutput,
        query_tokens_recent_run,
    ),
    "validate_addresses": (
        ValidateAddressesInput,
        ValidateAddressesOutput,
        validate_addresses_run,
    ),
    "remove_faulty_addresses": (
        RemoveFaultyAddressesInput,
        RemoveFaultyAddressesOutput,
        remove_faulty_addresses_run,
    ),
    "move_invalid_tokens": (
        MoveInvalidTokensInput,
        MoveInvalidTokensOutput,
        move_invalid_tokens_run,
    ),
    "generate_report": (GenerateReportInput, GenerateReportOutput, generate_report_run),
    "store_token_creation_info": (StoreTokenCreationInfoInput, StoreTokenCreationInfoOutput, store_token_creation_info_run),
    # State operations
    "get_state": (GetStateInput, GetStateOutput, get_state_run),
    "set_state": (SetStateInput, SetStateOutput, set_state_run),
    "delete_state": (DeleteStateInput, DeleteStateOutput, delete_state_run),
    "init_state_table": (InitStateTableInput, InitStateTableOutput, init_state_table_run),
}


def main():
    parser = argparse.ArgumentParser(
        description="DuckDB Storage Service for Simulation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--duckdb", required=True, help="Path to DuckDB file")
    parser.add_argument(
        "--operation",
        required=True,
        choices=list(OP_MAP.keys()),
        help="Operation to perform",
    )
    parser.add_argument(
        "--data", required=True, help="JSON data for operation (stdin if '-')"
    )

    args = parser.parse_args()

    # Read data from stdin if '-' is specified
    if args.data == "-":
        data_str = sys.stdin.read()
    else:
        data_str = args.data

    try:
        # Parse and validate input
        input_model, output_model, run_func = OP_MAP[args.operation]
        input_data = input_model.model_validate_json(data_str)

        # Determine if this is a read-only operation
        # Query operations are read-only, store operations are write
        # Note: get_state needs write access because it may need to setup schema and delete expired entries
        read_only_ops = {
            'query_calls',
            'query_ohlcv_metadata',
            'query_ohlcv_exclusions',
            'query_tokens_recent',
            'generate_report',
        }

        # Get connection (read-only for queries, write for stores)
        if args.operation in read_only_ops:
            # Use read-only connection for query operations
            with get_readonly_connection(args.duckdb) as con:
                # Execute operation
                result = run_func(con, input_data)

                # Validate output (ensures contract)
                output = output_model.model_validate(result.model_dump())

                # Output JSON to stdout (single object)
                # Use exclude_none=False to ensure None values are included as null in JSON
                # This is important for TypeScript Zod schemas that expect nullable optional fields
                print(json.dumps(output.model_dump(exclude_none=False), default=str))
        else:
            # Use write connection for store operations and operations that need schema setup
            with get_write_connection(args.duckdb) as con:
                # Setup simulation schema for write operations
                from duckdb_storage.utils import setup_simulation_schema
                setup_simulation_schema(con)
                
                # Execute operation
                result = run_func(con, input_data)

                # Validate output (ensures contract)
                output = output_model.model_validate(result.model_dump())

                # Output JSON to stdout (single object)
                # Use exclude_none=False to ensure None values are included as null in JSON
                # This is important for TypeScript Zod schemas that expect nullable optional fields
                print(json.dumps(output.model_dump(exclude_none=False), default=str))

        # Exit with appropriate code (use output from the appropriate branch)
        sys.exit(0 if output.success else 1)

    except Exception as e:
        # Log to stderr only
        print(f"Error: {e}", file=sys.stderr)

        # Output error as JSON to stdout (contract requirement)
        error_output = {"success": False, "error": str(e)}
        print(json.dumps(error_output))

        sys.exit(1)


if __name__ == "__main__":
    main()
