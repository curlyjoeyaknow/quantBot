#!/usr/bin/env python3
"""
Test script for the Write-Once Artifact Bus.

Creates a test job and verifies it gets processed correctly.
"""

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
import uuid


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def create_test_parquet():
    """Create a minimal test Parquet file using DuckDB."""
    import duckdb
    
    test_data = [
        ("token1", 1000, 1.5, 10.0),
        ("token2", 2000, 2.5, 20.0),
        ("token3", 3000, 3.5, 30.0),
    ]
    
    con = duckdb.connect(":memory:")
    con.execute("""
        CREATE TABLE test_data AS
        SELECT * FROM (VALUES
            ('token1', 1000, 1.5, 10.0),
            ('token2', 2000, 2.5, 20.0),
            ('token3', 3000, 3.5, 30.0)
        ) AS t(token_id, timestamp, price, volume)
    """)
    
    test_parquet = Path("test_artifact.parquet")
    con.execute(f"COPY test_data TO '{test_parquet}' (FORMAT PARQUET)")
    con.close()
    
    return test_parquet


def main():
    print("[test_bus] Creating test job...")
    
    # Create test Parquet file
    test_parquet = create_test_parquet()
    
    # Generate test job
    job_id = f"test_{utc_now_iso().replace(':', '-')}"
    run_id = str(uuid.uuid4())
    
    # Use bus_submit.py to create the job
    result = subprocess.run([
        sys.executable, "scripts/bus_submit.py",
        "--job-id", job_id,
        "--run-id", run_id,
        "--producer", "test",
        "--kind", "test_artifact",
        "--artifact-id", "test_data",
        "--parquet", str(test_parquet),
        "--schema-hint", "test.schema",
        "--rows", "3",
        "--meta-json", json.dumps({"test": True})
    ], capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"[test_bus] ERROR: bus_submit failed: {result.stderr}")
        return 1
    
    print(f"[test_bus] Job submitted: {job_id}")
    print(f"[test_bus] Waiting for daemon to process...")
    
    # Check if daemon processed it (wait up to 10 seconds)
    bus_root = Path("data/bus")
    processed_dir = bus_root / "processed" / job_id
    rejected_dir = bus_root / "rejected" / job_id
    
    for i in range(20):  # 20 * 0.5s = 10s max
        time.sleep(0.5)
        if processed_dir.exists():
            print(f"[test_bus] ✓ Job processed successfully!")
            print(f"[test_bus] Location: {processed_dir}")
            
            # Check catalog
            import duckdb
            con = duckdb.connect("data/alerts.duckdb", read_only=True)
            try:
                catalog_runs = con.execute(
                    "SELECT run_id, producer, kind FROM catalog.runs_d WHERE run_id = ?",
                    [run_id]
                ).fetchall()
                
                if catalog_runs:
                    print(f"[test_bus] ✓ Run recorded in catalog: {catalog_runs[0]}")
                else:
                    print(f"[test_bus] ⚠ Run not found in catalog (daemon may not have run)")
                
                catalog_artifacts = con.execute(
                    "SELECT artifact_id, canonical_path FROM catalog.artifacts_f WHERE run_id = ?",
                    [run_id]
                ).fetchall()
                
                if catalog_artifacts:
                    print(f"[test_bus] ✓ Artifact recorded in catalog:")
                    for art in catalog_artifacts:
                        print(f"    - {art[0]}: {art[1]}")
            finally:
                con.close()
            
            # Cleanup
            test_parquet.unlink(missing_ok=True)
            return 0
        elif rejected_dir.exists():
            reject_reason = rejected_dir / "REJECT_REASON.json"
            if reject_reason.exists():
                reason = json.loads(reject_reason.read_text())
                print(f"[test_bus] ✗ Job rejected: {reason.get('error')}")
            else:
                print(f"[test_bus] ✗ Job rejected (no reason file)")
            test_parquet.unlink(missing_ok=True)
            return 1
    
    print(f"[test_bus] ⚠ Job not processed after 10 seconds")
    print(f"[test_bus] Make sure bus_daemon.py is running!")
    test_parquet.unlink(missing_ok=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())

