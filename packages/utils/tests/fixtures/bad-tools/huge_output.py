#!/usr/bin/env python3
"""
Fixture: Generates massive output exceeding buffer limits
Expected: Process should be aborted with clear error
"""
import sys

# Generate > 10MB of output (current maxBuffer is 10MB)
# Each line is ~100 bytes, so 150k lines = ~15MB
for i in range(150000):
    print(f"Line {i}: " + "x" * 90)

# This should never be reached due to buffer overflow
print('{"success": true}')
sys.exit(0)

