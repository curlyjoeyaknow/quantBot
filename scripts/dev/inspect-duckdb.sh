#!/usr/bin/env bash
set -euo pipefail

DB="${1:-/home/memez/quantBot/data/tele.duckdb}"

if [ ! -f "$DB" ]; then
  echo "Error: Database not found: $DB" >&2
  exit 1
fi

python3 << PYTHON
import duckdb
import sys

db_path = "$DB"
con = duckdb.connect(db_path)

print("=== ALL TABLES ===")
tables = con.execute("SHOW TABLES").fetchall()
if not tables:
    print("  (no tables)")
    sys.exit(0)

for table in tables:
    print(f"  - {table[0]}")

print("\n=== ROW COUNTS ===")
for table in tables:
    table_name = table[0]
    try:
        count = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        print(f"  {table_name}: {count:,} rows")
    except Exception as e:
        print(f"  {table_name}: Error - {e}")

print("\n=== TABLE SCHEMAS ===")
for table in tables:
    table_name = table[0]
    print(f"\n{table_name}:")
    try:
        schema = con.execute(f"DESCRIBE {table_name}").fetchall()
        for col in schema:
            col_name, col_type = col[0], col[1]
            nullable = col[2] if len(col) > 2 else ""
            print(f"  {col_name:30s} {col_type:20s} {nullable}")
    except Exception as e:
        print(f"  Error: {e}")

# Check for user_calls_d specifically
print("\n=== CHECKING FOR user_calls_d ===")
has_user_calls = any(t[0] == 'user_calls_d' for t in tables)
if has_user_calls:
    print("  ✓ user_calls_d exists")
    try:
        count = con.execute("SELECT COUNT(*) FROM user_calls_d").fetchone()[0]
        print(f"  Rows: {count:,}")
        if count > 0:
            print("\n  Sample rows:")
            sample = con.execute("SELECT * FROM user_calls_d LIMIT 3").fetchall()
            cols = [desc[0] for desc in con.execute("SELECT * FROM user_calls_d LIMIT 0").description]
            print(f"  Columns: {', '.join(cols)}")
            for row in sample:
                print(f"    {dict(zip(cols, row))}")
    except Exception as e:
        print(f"  Error querying: {e}")
else:
    print("  ✗ user_calls_d does NOT exist")
    print("  This table is required for 'calls export' command")
    print("  You need to run the telegram ingestion pipeline to create it")

con.close()
PYTHON

