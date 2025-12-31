import duckdb
from pathlib import Path

# Resolve DB path relative to this file's directory
BASE_DIR = Path(__file__).parent.parent
DB_PATH = BASE_DIR / "data" / "app.duckdb"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

conn = duckdb.connect(str(DB_PATH))

conn.execute("""
CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT,
  json TEXT,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  name TEXT,
  json TEXT,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT,
  filter_id TEXT,
  status TEXT,
  summary_json TEXT,
  created_at TIMESTAMP DEFAULT now()
);
""")

