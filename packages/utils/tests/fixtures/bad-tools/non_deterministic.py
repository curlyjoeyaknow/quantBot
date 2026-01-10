#!/usr/bin/env python3
"""
Fixture: Returns random data unless seeded
Expected: Test should fail unless input controls output
"""
import json
import sys
import random
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, default=None)
args = parser.parse_args()

if args.seed is not None:
    random.seed(args.seed)

# Generate random output
output = {
    "success": True,
    "random_value": random.randint(1, 1000000),
    "random_float": random.random()
}

print(json.dumps(output))
sys.exit(0)

