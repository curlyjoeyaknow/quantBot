#!/usr/bin/env python3
"""
Fixture: Returns incomplete manifest (partial success)
Expected: Validation should fail - no partial successes allowed
"""
import json
import sys

# Incomplete manifest - missing required fields
output = {
    "success": True,
    "partial_data": {
        "some_field": "value"
    }
    # Missing required fields that schema expects
}

print(json.dumps(output))
sys.exit(0)

