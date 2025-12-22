#!/usr/bin/env python3
"""
Fixture: Outputs valid JSON that doesn't match the expected schema
Expected: Zod validation should fail with clear error message
"""
import json
import sys

# Valid JSON but missing required fields
output = {
    "wrong_field": "value",
    "another_wrong_field": 123
}

print(json.dumps(output))
sys.exit(0)

