cat > /tmp/inspect_parquet.py <<'EOF'
from pathlib import Path
import duckdb

p = Path("/home/memez/backups/quantBot/slices/per_token_v2/20250501_0007_BL22Me3x_pump.parquet")

con = duckdb.connect(database=":memory:")

print("== file ==")
print(p)

print("\n== describe ==")
try:
    desc = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{p.as_posix()}')").fetchall()
    for row in desc:
        print(row)
except Exception as e:
    print("DESCRIBE failed:", e)

print("\n== head(5) ==")
try:
    rows = con.execute(f"SELECT * FROM read_parquet('{p.as_posix()}') LIMIT 5").fetchall()
    for r in rows:
        print(r)
except Exception as e:
    print("SELECT failed:", e)

con.close()
EOF

python3 /tmp/inspect_parquet.py
