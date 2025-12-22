#!/usr/bin/env python3
"""
Backward-compatible entry point for duckdb_storage.

This file maintains the old interface while routing to the new modular structure.
It will be removed once all callers are updated.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Import and run the new main module
from duckdb_storage.main import main

if __name__ == "__main__":
    main()
