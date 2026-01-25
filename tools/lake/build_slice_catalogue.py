#!/usr/bin/env python3
"""
Build Slice Catalogue

Scans data/lake/runs/ directories and builds a catalog index of all slice exports.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Any

# Add workspace root to path for tools imports
_workspace_root = Path(__file__).resolve().parent.parent.parent
if str(_workspace_root) not in sys.path:
    sys.path.insert(0, str(_workspace_root))

from tools.shared.duckdb_adapter import get_connection


def scan_lake_runs(data_root: str) -> List[Dict[str, Any]]:
    """
    Scan all run directories in data/lake/runs/ and extract manifest information.
    
    Args:
        data_root: Root data directory
        
    Returns:
        List of run metadata dictionaries
    """
    lake_root = Path(data_root) / "lake" / "runs"
    
    if not lake_root.exists():
        return []
    
    runs = []
    
    for run_dir in lake_root.iterdir():
        if not run_dir.is_dir() or not run_dir.name.startswith("run_id="):
            continue
        
        run_id = run_dir.name.replace("run_id=", "")
        manifest_path = run_dir / "manifest.json"
        
        if not manifest_path.exists():
            continue
        
        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
            
            # Extract key information
            # Outputs structure: {"slices/ohlcv/interval=1m/window=pre52_post4948": {"files": X, "rows": Y}}
            outputs = manifest.get("outputs", {})
            total_rows = 0
            total_files = 0
            for output_path, output_data in outputs.items():
                if isinstance(output_data, dict):
                    total_rows += output_data.get("rows", 0)
                    total_files += output_data.get("files", 0)
            
            run_info = {
                "run_id": run_id,
                "run_dir": str(run_dir.relative_to(Path(data_root))),
                "created_at": manifest.get("created_at"),
                "lake_version": manifest.get("lake_version"),
                "interval": manifest.get("slice_spec", {}).get("interval"),
                "window": manifest.get("slice_spec", {}).get("window"),
                "chain": manifest.get("slice_spec", {}).get("chain"),
                "total_rows": total_rows,
                "total_files": total_files,
                "coverage": manifest.get("coverage", {}),
                "manifest_path": str(manifest_path.relative_to(Path(data_root))),
            }
            
            runs.append(run_info)
        except Exception as e:
            print(f"Warning: Failed to parse manifest {manifest_path}: {e}", file=sys.stderr)
            continue
    
    return runs


def build_catalogue_parquet(runs: List[Dict[str, Any]], output_path: Path) -> None:
    """
    Build a Parquet catalogue file from run metadata.
    
    Args:
        runs: List of run metadata dictionaries
        output_path: Path to output Parquet file
    """
    if not runs:
        print("No runs found to catalog", file=sys.stderr)
        return
    
    with get_connection(":memory:", read_only=False) as con:
        # Create table (window is reserved keyword, so we quote it)
        con.execute("""
            CREATE TABLE catalogue (
                run_id VARCHAR,
                run_dir VARCHAR,
                created_at VARCHAR,
                lake_version VARCHAR,
                interval VARCHAR,
                "window" VARCHAR,
                chain VARCHAR,
                total_rows BIGINT,
                total_files INTEGER,
                kept_events INTEGER,
                dropped_events INTEGER,
                manifest_path VARCHAR
            )
        """)
        
        # Insert data
        for run in runs:
            coverage = run.get("coverage", {})
            con.execute(
                'INSERT INTO catalogue VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    run.get("run_id"),
                    run.get("run_dir"),
                    run.get("created_at"),
                    run.get("lake_version"),
                    run.get("interval"),
                    run.get("window"),
                    run.get("chain"),
                    run.get("total_rows", 0),
                    run.get("total_files", 0),
                    coverage.get("kept_events", 0),
                    coverage.get("dropped_events", 0),
                    run.get("manifest_path"),
                )
            )
        
        # Write Parquet
        output_path.parent.mkdir(parents=True, exist_ok=True)
        con.execute(f"""
            COPY catalogue
            TO '{str(output_path).replace("'", "''")}'
            (FORMAT PARQUET, COMPRESSION 'zstd')
        """)
    
    print(f"✅ Catalogue written to {output_path} ({len(runs)} runs)")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Build slice catalogue from lake exports")
    parser.add_argument("--data-root", default="data", help="Data root directory")
    parser.add_argument("--output", default="data/lake/catalogue.parquet", help="Output catalogue file")
    parser.add_argument("--json", action="store_true", help="Output as JSON instead of Parquet")
    
    args = parser.parse_args()
    
    # Scan runs
    print(f"Scanning lake runs in {args.data_root}/lake/runs/...")
    runs = scan_lake_runs(args.data_root)
    
    if not runs:
        print("No runs found", file=sys.stderr)
        return 1
    
    print(f"Found {len(runs)} runs")
    
    # Build catalogue
    if args.json:
        output_path = Path(args.output)
        if output_path.suffix != ".json":
            output_path = output_path.with_suffix(".json")
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump({"runs": runs, "total": len(runs)}, f, indent=2)
        
        print(f"✅ Catalogue written to {output_path} ({len(runs)} runs)")
    else:
        build_catalogue_parquet(runs, Path(args.output))
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

