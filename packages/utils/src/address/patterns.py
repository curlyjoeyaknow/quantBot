"""
Shared Address Extraction Patterns
==================================

This file contains regex patterns for address extraction that are shared
between TypeScript and Python code to ensure consistency.

These patterns match the patterns defined in:
- packages/utils/src/address/extract.ts (TypeScript)
- packages/utils/src/address/extract-candidates.ts (TypeScript)
"""

import re

# Solana address pattern: base58, 32-44 characters
# Base58 excludes: 0, O, I, l
# Pattern: word boundary, 32-44 base58 chars, word boundary
BASE58_RE_PATTERN = r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b"
BASE58_RE = re.compile(BASE58_RE_PATTERN)

# EVM address pattern: 0x followed by exactly 40 hex characters
# Pattern: word boundary, 0x, 40 hex chars, word boundary
EVM_ADDRESS_RE_PATTERN = r"\b0x[a-fA-F0-9]{40}\b"
EVM_ADDRESS_RE = re.compile(EVM_ADDRESS_RE_PATTERN)

# Zero address (should be rejected)
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

