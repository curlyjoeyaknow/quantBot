#!/usr/bin/env python3
"""
Fixture: Exits with non-zero code after writing to stderr
Expected: AppError with exit code and stderr included
"""
import sys

# Write error to stderr
sys.stderr.write("ERROR: Something went wrong\n")
sys.stderr.write("Stack trace would be here\n")
sys.stderr.flush()

# Exit with error code
sys.exit(1)

