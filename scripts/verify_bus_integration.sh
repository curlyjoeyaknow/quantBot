#!/bin/bash
# Verify Bus Integration
# 
# This script verifies that the artifact bus is working correctly:
# 1. Checks daemon is running
# 2. Verifies catalog schema exists
# 3. Checks for recent artifacts
# 4. Verifies exports are up-to-date

set -e

echo "🔍 Verifying Artifact Bus Integration..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if daemon is running
echo "1. Checking if bus daemon is running..."
if pgrep -f "bus_daemon.py" > /dev/null; then
    echo -e "${GREEN}✓${NC} Bus daemon is running"
    DAEMON_PID=$(pgrep -f "bus_daemon.py")
    echo "   PID: $DAEMON_PID"
else
    echo -e "${YELLOW}⚠${NC} Bus daemon is not running"
    echo "   Start it with: python3 scripts/bus_daemon.py"
fi
echo ""

# Check catalog database exists
echo "2. Checking catalog database..."
DB_PATH="data/alerts.duckdb"
if [ -f "$DB_PATH" ]; then
    echo -e "${GREEN}✓${NC} Database exists: $DB_PATH"
    
    # Check catalog schema
    python3 << EOF
import duckdb
import sys

try:
    con = duckdb.connect("$DB_PATH", read_only=True)
    
    # Check if catalog schema exists
    schemas = con.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'catalog'").fetchall()
    if schemas:
        print("   ✓ Catalog schema exists")
        
        # Check tables
        tables = con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'catalog'").fetchall()
        if tables:
            print(f"   ✓ Found {len(tables)} catalog tables:")
            for table in tables:
                print(f"     - {table[0]}")
        else:
            print("   ⚠ No catalog tables found (daemon will create them)")
    else:
        print("   ⚠ Catalog schema not found (daemon will create it)")
    
    con.close()
except Exception as e:
    print(f"   ✗ Error checking catalog: {e}")
    sys.exit(1)
EOF
else
    echo -e "${YELLOW}⚠${NC} Database not found: $DB_PATH"
    echo "   The daemon will create it on first run"
fi
echo ""

# Check bus directory structure
echo "3. Checking bus directory structure..."
BUS_ROOT="data/bus"
if [ -d "$BUS_ROOT" ]; then
    echo -e "${GREEN}✓${NC} Bus root exists: $BUS_ROOT"
    
    for dir in inbox processed rejected store; do
        if [ -d "$BUS_ROOT/$dir" ]; then
            count=$(find "$BUS_ROOT/$dir" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
            echo "   ✓ $dir/ ($count items)"
        else
            echo "   ⚠ $dir/ (will be created by daemon)"
        fi
    done
else
    echo -e "${YELLOW}⚠${NC} Bus root not found: $BUS_ROOT"
    echo "   The daemon will create it on first run"
fi
echo ""

# Check for recent runs in catalog
echo "4. Checking for recent runs in catalog..."
python3 << EOF
import duckdb
import sys
from datetime import datetime, timedelta

try:
    con = duckdb.connect("$DB_PATH", read_only=True)
    
    # Check if catalog.runs_d exists
    try:
        runs = con.execute("""
            SELECT run_id, producer, kind, created_at_utc, last_seen_at
            FROM catalog.runs_d
            ORDER BY last_seen_at DESC
            LIMIT 5
        """).fetchall()
        
        if runs:
            print(f"   ✓ Found {len(runs)} recent runs:")
            for run in runs:
                print(f"     - {run[0][:8]}... ({run[1]}/{run[2]}) - {run[4]}")
        else:
            print("   ⚠ No runs found in catalog yet")
            print("   Run a simulation to generate artifacts")
    except Exception as e:
        if "does not exist" in str(e) or "Catalog" in str(e):
            print("   ⚠ Catalog tables not created yet (daemon will create them)")
        else:
            raise
    
    con.close()
except Exception as e:
    print(f"   ✗ Error checking runs: {e}")
    sys.exit(1)
EOF
echo ""

# Check exports directory
echo "5. Checking golden exports..."
EXPORTS_DIR="data/exports"
if [ -d "$EXPORTS_DIR" ]; then
    echo -e "${GREEN}✓${NC} Exports directory exists: $EXPORTS_DIR"
    
    # Check for export files
    parquet_files=$(find "$EXPORTS_DIR" -name "*.parquet" 2>/dev/null | wc -l)
    if [ "$parquet_files" -gt 0 ]; then
        echo "   ✓ Found $parquet_files Parquet export files"
        
        # Check status file
        if [ -f "$EXPORTS_DIR/_export_status.json" ]; then
            echo "   ✓ Export status file exists"
            echo "   Last export:"
            python3 << EOF
import json
from pathlib import Path

status_file = Path("$EXPORTS_DIR/_export_status.json")
if status_file.exists():
    status = json.loads(status_file.read_text())
    print(f"     Time: {status.get('ran_at_utc', 'unknown')}")
    results = status.get('results', [])
    successful = sum(1 for r in results if r.get('ok'))
    failed = sum(1 for r in results if not r.get('ok'))
    print(f"     Successful: {successful}, Failed: {failed}")
EOF
        else
            echo "   ⚠ Export status file not found (exports may not have run yet)"
        fi
    else
        echo "   ⚠ No Parquet export files found"
        echo "   Exports will be generated after first artifact ingestion"
    fi
else
    echo -e "${YELLOW}⚠${NC} Exports directory not found: $EXPORTS_DIR"
    echo "   The daemon will create it on first export"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo ""
echo "To test the bus integration:"
echo "  1. Ensure daemon is running: python3 scripts/bus_daemon.py"
echo "  2. Run a simulation: quantbot sim"
echo "  3. Check daemon logs for 'processed' messages"
echo "  4. Verify exports: ls -lh data/exports/"
echo "  5. Query catalog: python3 scripts/query_catalog.py"
echo ""
echo "For manual testing:"
echo "  python3 scripts/test_bus.py"
echo ""

