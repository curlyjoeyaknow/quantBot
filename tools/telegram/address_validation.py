"""
Address extraction and validation module.

Extracted from duckdb_punch_pipeline.py for testability.
"""

import re
from typing import List, Optional, Set, Tuple
from dataclasses import dataclass
from enum import Enum

# Base58 character set: 1-9, A-H, J-N, P-Z, a-k, m-z (excludes 0, O, I, l)
BASE58_CHARS = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
# NOTE: Patterns match TypeScript consolidated extractor in @quantbot/utils
# See packages/utils/src/address/patterns.py for shared patterns
BASE58_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")

# EVM address regex: 0x + 40 hex chars
EVM_ADDRESS_RE = re.compile(r"\b0x[a-fA-F0-9]{40}\b")
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


class MintValidationStatus(Enum):
    """Status of mint validation"""
    PENDING = "pending"
    PASS1_ACCEPTED = "pass1_accepted"
    PASS1_REJECTED = "pass1_rejected"
    PASS2_ACCEPTED = "pass2_accepted"
    PASS2_REJECTED = "pass2_rejected"
    PASS3_VERIFIED = "pass3_verified"
    PASS3_UNVERIFIED = "pass3_unverified"


@dataclass
class AddressCandidate:
    """Address candidate (Solana or EVM) with validation status"""
    raw: str
    normalized: str
    address_type: str  # "solana" or "evm"
    status: MintValidationStatus
    reason: Optional[str] = None
    message_id: Optional[int] = None
    checksum_status: Optional[str] = None


def normalize_mint_candidate(raw: str) -> str:
    """Pass 1: Normalize mint candidate (trim, remove surrounding punctuation). Preserves case."""
    if not raw:
        return ""
    normalized = raw.strip()
    normalized = re.sub(r'^[,)\].]+|[,(\[.]+$', '', normalized)
    return normalized.strip()


def validate_mint_pass1(raw: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Pass 1: Fast extraction-time validation. Returns: (is_valid, normalized_mint, rejection_reason)"""
    if not raw:
        return False, None, "empty_string"
    
    normalized = normalize_mint_candidate(raw)
    
    if not normalized:
        return False, None, "normalized_to_empty"
    
    if len(normalized) < 32 or len(normalized) > 44:
        return False, None, f"invalid_length_{len(normalized)}"
    
    if not all(c in BASE58_CHARS for c in normalized):
        invalid_chars = set(normalized) - BASE58_CHARS
        return False, None, f"invalid_chars_{''.join(sorted(invalid_chars))[:10]}"
    
    if ' ' in normalized:
        return False, None, "contains_spaces"
    
    return True, normalized, None


def normalize_evm_address(raw: str) -> str:
    """Pass 1: Normalize EVM address candidate. Preserves case for EIP-55 checksum."""
    if not raw:
        return ""
    normalized = raw.strip()
    normalized = re.sub(r'^[,)\].]+|[,(\[.]+$', '', normalized)
    return normalized.strip()


def validate_evm_pass1(raw: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Pass 1: Fast extraction-time validation for EVM addresses."""
    if not raw:
        return False, None, "empty_string"
    
    normalized = normalize_evm_address(raw)
    
    if not normalized:
        return False, None, "normalized_to_empty"
    
    if not normalized.startswith("0x"):
        return False, None, "missing_0x_prefix"
    
    if len(normalized) != 42:
        return False, None, f"invalid_length_{len(normalized)}"
    
    hex_chars = set("0123456789abcdefABCDEF")
    hex_part = normalized[2:]
    if not all(c in hex_chars for c in hex_part):
        invalid_chars = set(hex_part) - hex_chars
        return False, None, f"invalid_hex_chars_{''.join(sorted(invalid_chars))[:10]}"
    
    if normalized.lower() == ZERO_ADDRESS:
        return False, None, "zero_address"
    
    return True, normalized, None


def find_solana_candidates(text: str, message_id: Optional[int] = None) -> List[AddressCandidate]:
    """Pass 1: Extract and validate Solana address candidates from text."""
    if not text:
        return []
    
    matches = BASE58_RE.findall(text)
    seen: Set[str] = set()
    candidates: List[AddressCandidate] = []
    
    for raw in matches:
        if raw in seen:
            continue
        seen.add(raw)
        
        is_valid, normalized, reason = validate_mint_pass1(raw)
        
        if is_valid:
            candidates.append(AddressCandidate(
                raw=raw,
                normalized=normalized,
                address_type="solana",
                status=MintValidationStatus.PASS1_ACCEPTED,
                message_id=message_id
            ))
        else:
            candidates.append(AddressCandidate(
                raw=raw,
                normalized=normalized or raw,
                address_type="solana",
                status=MintValidationStatus.PASS1_REJECTED,
                reason=reason,
                message_id=message_id
            ))
    
    return candidates


def find_evm_candidates(text: str, message_id: Optional[int] = None) -> List[AddressCandidate]:
    """Pass 1: Extract and validate EVM address candidates from text."""
    if not text:
        return []
    
    matches = EVM_ADDRESS_RE.findall(text)
    seen: Set[str] = set()
    candidates: List[AddressCandidate] = []
    
    for raw in matches:
        if raw in seen:
            continue
        seen.add(raw)
        
        is_valid, normalized, reason = validate_evm_pass1(raw)
        
        if is_valid:
            candidates.append(AddressCandidate(
                raw=raw,
                normalized=normalized,
                address_type="evm",
                status=MintValidationStatus.PASS1_ACCEPTED,
                message_id=message_id
            ))
        else:
            candidates.append(AddressCandidate(
                raw=raw,
                normalized=normalized or raw,
                address_type="evm",
                status=MintValidationStatus.PASS1_REJECTED,
                reason=reason,
                message_id=message_id
            ))
    
    return candidates


def find_address_candidates(text: str, message_id: Optional[int] = None) -> List[AddressCandidate]:
    """Extract all address candidates (Solana + EVM) from text."""
    solana = find_solana_candidates(text, message_id)
    evm = find_evm_candidates(text, message_id)
    return solana + evm


def extract_addresses(text: str) -> dict:
    """
    Extract addresses from text and return in simple dict format for testing.
    
    Returns:
        {
            "solana_mints": [list of normalized Solana addresses],
            "evm": [list of normalized EVM addresses]
        }
    """
    candidates = find_address_candidates(text)
    
    solana_mints = [
        c.normalized for c in candidates
        if c.address_type == "solana" and c.status == MintValidationStatus.PASS1_ACCEPTED
    ]
    
    evm_addresses = [
        c.normalized for c in candidates
        if c.address_type == "evm" and c.status == MintValidationStatus.PASS1_ACCEPTED
    ]
    
    return {
        "solana_mints": solana_mints,
        "evm": evm_addresses
    }

