#!/usr/bin/env python3
"""
Fixture: A well-behaved Python tool for comparison
- Logs to stderr only
- Outputs valid JSON to stdout
- Matches expected schema
- Deterministic output
"""
import json
import sys
import argparse

# Parse arguments
parser = argparse.ArgumentParser()
parser.add_argument('--input', type=str, required=True)
parser.add_argument('--seed', type=int, default=42)
args = parser.parse_args()

# Log to stderr (not stdout)
sys.stderr.write(f"Processing input: {args.input}\n")
sys.stderr.write(f"Using seed: {args.seed}\n")
sys.stderr.flush()

# Output valid JSON to stdout (last line only)
output = {
    "success": True,
    "input_received": args.input,
    "seed_used": args.seed,
    "result": "processed"
}

print(json.dumps(output))
sys.exit(0)

