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

from .utils import get_connection
from .ops import (
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
    GenerateReportInput,
    GenerateReportOutput,
    generate_report_run,
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
    "generate_report": (GenerateReportInput, GenerateReportOutput, generate_report_run),
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

        # Get connection
        con = get_connection(args.duckdb)

        # Execute operation
        result = run_func(con, input_data)

        # Validate output (ensures contract)
        output = output_model.model_validate(result.model_dump())

        # Output JSON to stdout (single object)
        print(json.dumps(output.model_dump(), default=str))

        # Close connection
        con.close()

        # Exit with appropriate code
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
