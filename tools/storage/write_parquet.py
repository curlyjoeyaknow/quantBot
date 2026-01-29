#!/usr/bin/env python3
"""
Write Parquet files from JSON data.

Used by TypeScript to write candle data to Parquet format.
"""

import argparse
import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


def write_parquet(data: list[dict], output_path: str) -> dict:
    """
    Write data to Parquet file.

    Args:
        data: List of records (dicts)
        output_path: Output file path

    Returns:
        Result dict with success status
    """
    try:
        # Convert to PyArrow Table
        table = pa.Table.from_pylist(data)

        # Write to Parquet
        pq.write_table(table, output_path, compression="snappy")

        return {"success": True, "rowCount": len(data)}
    except Exception as e:
        return {"success": False, "rowCount": 0, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Write Parquet files")
    parser.add_argument("--output", required=True, help="Output file path")
    parser.add_argument("--data", required=True, help="JSON data")

    args = parser.parse_args()

    # Parse JSON data
    try:
        data = json.loads(args.data)
    except json.JSONDecodeError as e:
        result = {"success": False, "rowCount": 0, "error": f"Invalid JSON: {e}"}
        print(json.dumps(result))
        sys.exit(1)

    # Write Parquet
    result = write_parquet(data, args.output)

    # Output result as JSON
    print(json.dumps(result))


if __name__ == "__main__":
    main()

