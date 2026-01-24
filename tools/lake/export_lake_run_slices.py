#!/usr/bin/env python3
"""
Python entry point for lake run slice export.

Reads config from stdin (JSON), calls export_lake_run_slices, returns result as JSON.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add tools/backtest directory to path for lib imports
_tools_backtest_dir = Path(__file__).resolve().parent.parent / "backtest"
if str(_tools_backtest_dir) not in sys.path:
    sys.path.insert(0, str(_tools_backtest_dir))

from lib.slice_exporter import (
    LakeRunSliceConfig,
    ClickHouseCfg,
    export_lake_run_slices,
)


def main():
    """Main entry point."""
    # Read config from stdin
    config_json = json.load(sys.stdin)
    
    # Parse config
    lake_config = LakeRunSliceConfig(
        data_root=config_json["data_root"],
        run_id=config_json["run_id"],
        interval=config_json["interval"],
        window=config_json["window"],
        alerts_path=config_json["alerts_path"],
        chain=config_json.get("chain", "solana"),
        compression=config_json.get("compression", "zstd"),
        target_file_mb=config_json.get("target_file_mb", 512),
        strict_coverage=config_json.get("strict_coverage", False),
        min_required_pre=config_json.get("min_required_pre", 52),
        target_total=config_json.get("target_total", 5000),
    )
    
    # Parse ClickHouse config
    ch_config_json = config_json["clickhouse"]
    ch_cfg = ClickHouseCfg(
        host=ch_config_json["host"],
        port=ch_config_json["port"],
        database=ch_config_json["database"],
        table=ch_config_json["table"],
        user=ch_config_json["user"],
        password=ch_config_json.get("password", ""),
        connect_timeout=ch_config_json.get("connect_timeout", 10),
        send_receive_timeout=ch_config_json.get("send_receive_timeout", 300),
    )
    
    # Run export
    try:
        result = export_lake_run_slices(lake_config, ch_cfg, verbose=False)
        
        # Return result as JSON
        print(json.dumps(result, indent=2))
        return 0
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
        }
        print(json.dumps(error_result, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())

