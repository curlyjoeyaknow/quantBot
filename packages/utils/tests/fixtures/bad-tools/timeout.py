#!/usr/bin/env python3
"""
Fixture: Sleeps longer than timeout
Expected: TimeoutError with clear message
"""
import time
import sys

# Sleep for 10 seconds (tests will set timeout to < 1 second)
time.sleep(10)

# This should never be reached
print('{"success": true}')
sys.exit(0)

