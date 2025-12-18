#!/usr/bin/env python3
"""
Fixture: Outputs non-JSON text to stdout
Expected: PythonEngine should fail with ValidationError
"""
import sys

# This is not JSON - should cause parsing failure
print("hello this is not json")
print("another line of text")
print("definitely not valid JSON")
sys.exit(0)

