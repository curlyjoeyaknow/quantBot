#!/usr/bin/env python3
"""
Fixture: Mixes log output with JSON on stdout
Expected: Should fail - forces Python tools to log to stderr only
"""
import json
import sys

# This simulates a tool that logs to stdout (BAD PRACTICE)
print("Starting processing...")
print("Loading data...")
print("Processing item 1...")
print("Processing item 2...")

# Then outputs JSON
output = {
    "success": True,
    "result": "data"
}
print(json.dumps(output))
sys.exit(0)

