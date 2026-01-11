#!/usr/bin/env python3
"""
Fixture: Returns manifest pointing to files that don't exist
Expected: TypeScript should detect missing artifacts and fail
"""
import json
import sys
import os
import tempfile

# Create a temp directory path but don't create the files
temp_dir = tempfile.gettempdir()

# Claim these files exist but don't create them
output = {
    "success": True,
    "artifacts": [
        os.path.join(temp_dir, "nonexistent_file_1.db"),
        os.path.join(temp_dir, "nonexistent_file_2.csv"),
        os.path.join(temp_dir, "nonexistent_file_3.json")
    ],
    "manifest": {
        "duckdb_file": os.path.join(temp_dir, "fake.db"),
        "rows_processed": 100
    }
}

print(json.dumps(output))
sys.exit(0)

