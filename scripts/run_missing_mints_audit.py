#!/usr/bin/env python3
"""
Missing Mints Audit for DuckDB Pipeline
Categorizes why calls don't have mint addresses
"""

import sys
import duckdb

def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else 'tele.duckdb'
    
    print(f"Running missing mints audit on: {db_path}")
    print("")
    
    con = duckdb.connect(db_path)
    
    # Read and execute the SQL
    with open('scripts/duckdb_missing_mints_audit.sql', 'r') as f:
        sql = f.read()
    
    # Split by semicolons and execute each statement
    statements = [s.strip() for s in sql.split(';') if s.strip() and not s.strip().startswith('--')]
    
    for stmt in statements:
        if stmt:
            try:
                result = con.execute(stmt)
                # Print results if it's a SELECT
                if stmt.strip().upper().startswith('SELECT'):
                    rows = result.fetchall()
                    if rows:
                        # Get column names
                        cols = [desc[0] for desc in result.description]
                        # Print header
                        print(" | ".join(f"{col:<30}" for col in cols))
                        print("-" * 150)
                        # Print rows
                        for row in rows[:50]:  # Limit to 50 rows
                            print(" | ".join(f"{str(val)[:30]:<30}" for val in row))
                        if len(rows) > 50:
                            print(f"... ({len(rows) - 50} more rows)")
                        print("")
            except Exception as e:
                # Skip errors for temp views that might not exist yet
                if 'does not exist' not in str(e).lower():
                    print(f"Warning: {e}")
    
    con.close()

if __name__ == '__main__':
    main()

