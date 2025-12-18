#!/usr/bin/env python3

import argparse
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple, List, Set
from dataclasses import dataclass
from enum import Enum

import duckdb
import ijson
import hashlib
import os

# Import address validation from extracted module
try:
    from address_validation import (
        find_address_candidates as find_address_candidates_extracted,
        find_solana_candidates,
        find_evm_candidates,
        AddressCandidate,
        MintValidationStatus,
    )
    USE_EXTRACTED_MODULE = True
except ImportError:
    # Fallback to inline definitions if module not available
    USE_EXTRACTED_MODULE = False

class MintValidationStatus(Enum):
  """Status of mint validation"""
  PENDING = "pending"
  PASS1_ACCEPTED = "pass1_accepted"  # Passed extraction-time checks
  PASS1_REJECTED = "pass1_rejected"  # Failed extraction-time checks
  PASS2_ACCEPTED = "pass2_accepted"  # Passed Solana PublicKey parse
  PASS2_REJECTED = "pass2_rejected"  # Failed Solana PublicKey parse
  PASS3_VERIFIED = "pass3_verified"   # Verified via Birdeye (semantic check)
  PASS3_UNVERIFIED = "pass3_unverified"  # Birdeye returned no data

@dataclass
class AddressCandidate:
  """Address candidate (Solana or EVM) with validation status"""
  raw: str  # Original string from text
  normalized: str  # Normalized (trimmed, punctuation removed)
  address_type: str  # "solana" or "evm"
  status: MintValidationStatus
  reason: Optional[str] = None  # Rejection reason if status is *_REJECTED
  message_id: Optional[int] = None  # For audit trail
  checksum_status: Optional[str] = None  # For EVM: "valid_checksummed", "valid_not_checksummed", "invalid_checksum"

@dataclass
class MintCandidate:
  """Mint candidate with validation status (backward compatibility)"""
  raw: str  # Original string from text
  normalized: str  # Normalized (trimmed, punctuation removed)
  status: MintValidationStatus
  reason: Optional[str] = None  # Rejection reason if status is *_REJECTED
  message_id: Optional[int] = None  # For audit trail

# Base58 character set: 1-9, A-H, J-N, P-Z, a-k, m-z (excludes 0, O, I, l)
BASE58_CHARS = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
BASE58_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")

# EVM address regex: 0x + 40 hex chars
EVM_ADDRESS_RE = re.compile(r"\b0x[a-fA-F0-9]{40}\b")
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# TON address regex: EQ followed by Base58 with hyphens/underscores, 40-50 chars
TON_ADDRESS_RE = re.compile(r"\bEQ[A-Za-z0-9_-]{40,50}\b")

# Sui Move address regex: 0x + 64 hex chars, optionally followed by ::module::type
SUI_MOVE_ADDRESS_RE = re.compile(r"\b0x[a-fA-F0-9]{64}(::[a-z_]+::[A-Z_]+)?\b")

def normalize_mint_candidate(raw: str) -> str:
  """
  Pass 1: Normalize mint candidate (trim, remove surrounding punctuation).
  Preserves case - DO NOT change case.
  """
  if not raw:
    return ""
  # Trim whitespace
  normalized = raw.strip()
  # Remove common surrounding punctuation: , ) ] . etc.
  normalized = re.sub(r'^[,)\].]+|[,(\[.]+$', '', normalized)
  return normalized.strip()

def validate_mint_pass1(raw: str) -> Tuple[bool, Optional[str], Optional[str]]:
  """
  Pass 1: Fast extraction-time validation (cheap, high-volume filter).
  
  Returns: (is_valid, normalized_mint, rejection_reason)
  - normalized_mint: cleaned version if valid, None if invalid
  - rejection_reason: why it was rejected (if invalid)
  """
  if not raw:
    return False, None, "empty_string"
  
  # Normalize
  normalized = normalize_mint_candidate(raw)
  
  if not normalized:
    return False, None, "normalized_to_empty"
  
  # Length check: Solana pubkeys are base58-encoded 32 bytes = 32-44 chars
  if len(normalized) < 32 or len(normalized) > 44:
    return False, None, f"invalid_length_{len(normalized)}"
  
  # Base58 character set check
  if not all(c in BASE58_CHARS for c in normalized):
    invalid_chars = set(normalized) - BASE58_CHARS
    return False, None, f"invalid_chars_{''.join(sorted(invalid_chars))[:10]}"
  
  # No spaces
  if ' ' in normalized:
    return False, None, "contains_spaces"
  
  return True, normalized, None

def validate_mint_pass2(normalized: str) -> Tuple[bool, Optional[str]]:
  """
  Pass 2: Strict Solana PublicKey parse (before DB write).
  
  Returns: (is_valid, rejection_reason)
  
  Note: This requires base58 decoding. For now, we do a stricter regex check.
  In production, you'd use @solana/web3.js PublicKey or equivalent.
  """
  if not normalized:
    return False, "empty"
  
  # Stricter base58 check - ensure it's valid base58
  # Solana addresses are exactly 32 bytes when decoded, which is 43-44 base58 chars
  # Most common is 44 chars, but can be 43 if leading zeros
  
  # Additional validation: ensure it looks like a valid Solana address
  # (starts with common prefixes or is in valid range)
  if len(normalized) < 32 or len(normalized) > 44:
    return False, f"invalid_length_{len(normalized)}"
  
  # All characters must be base58
  if not all(c in BASE58_CHARS for c in normalized):
    return False, "invalid_base58_chars"
  
  # TODO: In production, add actual PublicKey parse:
  # try:
  #   from solders.pubkey import Pubkey
  #   Pubkey.from_string(normalized)
  #   return True, None
  # except Exception as e:
  #   return False, f"pubkey_parse_error_{str(e)[:50]}"
  
  # For now, pass if it passes base58 and length checks
  return True, None

# ---------- EVM address validation ----------

def normalize_evm_address(raw: str) -> str:
  """
  Pass 1: Normalize EVM address candidate (trim, remove surrounding punctuation).
  Preserves case - DO NOT change case (needed for EIP-55 checksum).
  """
  if not raw:
    return ""
  # Trim whitespace
  normalized = raw.strip()
  # Remove common surrounding punctuation: , ) ] . etc.
  normalized = re.sub(r'^[,)\].]+|[,(\[.]+$', '', normalized)
  return normalized.strip()

def validate_evm_checksum(address: str) -> Tuple[str, bool]:
  """
  EIP-55 checksum validation.
  
  Returns: (checksum_status, is_valid)
  - checksum_status: "valid_checksummed", "valid_not_checksummed", "invalid_checksum"
  - is_valid: True if syntactically valid (regardless of checksum)
  """
  if not address or not address.startswith("0x"):
    return "invalid_format", False
  
  addr_lower = address.lower()
  addr_upper = address.upper()
  
  # All lower or all upper = not checksummed but valid
  if address == addr_lower or address == addr_upper:
    return "valid_not_checksummed", True
  
  # Mixed case = should be checksummed
  # EIP-55: checksum is computed from keccak256 hash of lowercase address
  # For now, we'll accept mixed-case as potentially checksummed
  # Full validation would require keccak256, but for ingestion we accept it
  # TODO: Add full EIP-55 validation with keccak256 if needed
  # For now, mixed-case = assume valid checksummed
  return "valid_checksummed", True

def validate_evm_pass1(raw: str) -> Tuple[bool, Optional[str], Optional[str]]:
  """
  Pass 1: Fast extraction-time validation for EVM addresses.
  
  Returns: (is_valid, normalized_address, rejection_reason)
  """
  if not raw:
    return False, None, "empty_string"
  
  # Normalize
  normalized = normalize_evm_address(raw)
  
  if not normalized:
    return False, None, "normalized_to_empty"
  
  # Must start with 0x
  if not normalized.startswith("0x"):
    return False, None, "missing_0x_prefix"
  
  # Must be exactly 42 chars (0x + 40 hex)
  if len(normalized) != 42:
    return False, None, f"invalid_length_{len(normalized)}"
  
  # Check hex characters
  hex_chars = set("0123456789abcdefABCDEF")
  hex_part = normalized[2:]
  if not all(c in hex_chars for c in hex_part):
    invalid_chars = set(hex_part) - hex_chars
    return False, None, f"invalid_hex_chars_{''.join(sorted(invalid_chars))[:10]}"
  
  # Reject zero address
  if normalized.lower() == ZERO_ADDRESS:
    return False, None, "zero_address"
  
  return True, normalized, None

def validate_evm_pass2(normalized: str) -> Tuple[bool, Optional[str], str]:
  """
  Pass 2: Strict EVM address validation (before DB write).
  
  Returns: (is_valid, rejection_reason, checksum_status)
  """
  if not normalized:
    return False, "empty", "invalid_format"
  
  # Must be 0x + 40 hex
  if len(normalized) != 42 or not normalized.startswith("0x"):
    return False, f"invalid_format_len_{len(normalized)}", "invalid_format"
  
  # Hex validation
  hex_part = normalized[2:]
  if not all(c in "0123456789abcdefABCDEF" for c in hex_part):
    return False, "invalid_hex", "invalid_format"
  
  # EIP-55 checksum validation
  checksum_status, is_valid = validate_evm_checksum(normalized)
  
  if not is_valid:
    return False, "invalid_checksum", checksum_status
  
  return True, None, checksum_status

def find_evm_candidates(text: str, message_id: Optional[int] = None) -> List[AddressCandidate]:
  """
  Pass 1: Extract and validate EVM address candidates from text.
  Returns list of AddressCandidate objects with Pass 1 validation status.
  """
  if not text:
    return []
  
  # Find all potential EVM addresses using regex
  matches = EVM_ADDRESS_RE.findall(text)
  
  # Deduplicate within same message (case-sensitive to preserve case)
  seen: Set[str] = set()
  candidates: List[AddressCandidate] = []
  
  for raw in matches:
    # Skip if we've seen this exact string (case-sensitive)
    if raw in seen:
      continue
    seen.add(raw)
    
    # Pass 1 validation
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

def find_address_candidates(text: str, message_id: Optional[int] = None, chain: Optional[str] = None) -> List[AddressCandidate]:
  """
  Find all address candidates (Solana or EVM) from text.
  If chain is known, only return that type. If unknown, try both.
  """
  candidates: List[AddressCandidate] = []
  
  chain_lower = (chain or "").lower()
  
  # If chain is EVM-related, only look for EVM
  if chain_lower in ["evm", "ethereum", "eth", "base", "arbitrum", "arb", "bsc", "bnb", "polygon", "matic"]:
    evm_candidates = find_evm_candidates(text, message_id)
    candidates.extend(evm_candidates)
  # If chain is Solana, only look for Solana
  elif chain_lower in ["solana", "sol"]:
    sol_candidates = find_mint_candidates(text, message_id)
    for c in sol_candidates:
      candidates.append(AddressCandidate(
        raw=c.raw,
        normalized=c.normalized,
        address_type="solana",
        status=c.status,
        reason=c.reason,
        message_id=c.message_id
      ))
  else:
    # Unknown chain - try both
    sol_candidates = find_mint_candidates(text, message_id)
    for c in sol_candidates:
      candidates.append(AddressCandidate(
        raw=c.raw,
        normalized=c.normalized,
        address_type="solana",
        status=c.status,
        reason=c.reason,
        message_id=c.message_id
      ))
    evm_candidates = find_evm_candidates(text, message_id)
    candidates.extend(evm_candidates)
  
  return candidates

def find_mint_candidates(text: str, message_id: Optional[int] = None) -> List[MintCandidate]:
  """
  Pass 1: Extract and validate mint candidates from text.
  Returns list of MintCandidate objects with Pass 1 validation status.
  """
  if not text:
    return []
  
  # Find all potential mints using regex
  matches = BASE58_RE.findall(text)
  
  # Deduplicate within same message (case-sensitive to preserve case)
  seen: Set[str] = set()
  candidates: List[MintCandidate] = []
  
  for raw in matches:
    # Skip if we've seen this exact string (case-sensitive)
    if raw in seen:
      continue
    seen.add(raw)
    
    # Pass 1 validation
    is_valid, normalized, reason = validate_mint_pass1(raw)
    
    if is_valid:
      candidates.append(MintCandidate(
        raw=raw,
        normalized=normalized,
        status=MintValidationStatus.PASS1_ACCEPTED,
        message_id=message_id
      ))
    else:
      candidates.append(MintCandidate(
        raw=raw,
        normalized=normalized or raw,
        status=MintValidationStatus.PASS1_REJECTED,
        reason=reason,
        message_id=message_id
      ))
  
  return candidates

def find_first_valid_mint(text: str, message_id: Optional[int] = None) -> Optional[str]:
  """
  Find first valid mint (Pass 1 + Pass 2 validated).
  Preserves exact case.
  """
  candidates = find_mint_candidates(text, message_id)
  
  for candidate in candidates:
    if candidate.status == MintValidationStatus.PASS1_ACCEPTED:
      # Pass 2 validation
      is_valid, reason = validate_mint_pass2(candidate.normalized)
      if is_valid:
        # Return normalized version (preserves case, just cleaned)
        return candidate.normalized
      # If Pass 2 fails, continue to next candidate
  
  return None

# Backward compatibility - keep old function name
def find_first_mint(text: str) -> Optional[str]:
  """Backward compatibility wrapper - uses new validation"""
  return find_first_valid_mint(text)

# ---------- helpers ----------

def flatten_text(t: Any) -> str:
  if isinstance(t, str):
    return t
  if isinstance(t, list):
    out = []
    for part in t:
      if isinstance(part, str):
        out.append(part)
      elif isinstance(part, dict):
        out.append(str(part.get("text","")))
      else:
        out.append(str(part))
    return "".join(out)
  return "" if t is None else str(t)

def ts_ms_from_obj(m: dict) -> Optional[int]:
  du = m.get("date_unixtime")
  if du is not None:
    try:
      return int(float(str(du))) * 1000
    except Exception:
      pass
  d = m.get("date")
  if isinstance(d, str) and d.strip():
    s = d.strip()
    if s.endswith("Z"):
      s = s[:-1] + "+00:00"
    try:
      dt = datetime.fromisoformat(s)
      if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
      return int(dt.timestamp() * 1000)
    except Exception:
      return None
  return None

def parse_num_suffix(s: Optional[str]) -> Optional[float]:
  if s is None:
    return None
  s = str(s).strip().replace(",", "").lstrip("$")
  m = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?$", s, re.IGNORECASE)
  if not m:
    return None
  n = float(m.group(1))
  suf = (m.group(2) or "").upper()
  mult = {"": 1.0, "K": 1e3, "M": 1e6, "B": 1e9}.get(suf, 1.0)
  return n * mult

def parse_age_to_seconds(s: Optional[str]) -> Optional[int]:
  if not s:
    return None
  s = str(s).strip().lower()
  m = re.match(r"^(\d+(?:\.\d+)?)(s|m|h|d|w|mo|y)$", s)
  if not m:
    return None
  n = float(m.group(1))
  u = m.group(2)
  sec = {
    "s": 1,
    "m": 60,
    "h": 3600,
    "d": 86400,
    "w": 7*86400,
    "mo": 30*86400,
    "y": 365*86400,
  }[u]
  return int(n * sec)

# ---------- dead-simple parsers ----------

def parse_phanes(text: str) -> Optional[Dict[str, Any]]:
  """
  Matches the stable Phanes [Gold] multi-line card you showed.
  More lenient: requires at least one of ├ or └, or 💊 emoji.
  """
  t = (text or "").strip()
  if not t:
    return None
  # More lenient: allow if has structure markers OR phanes emoji
  if "├" not in t and "└" not in t and "💊" not in t:
    return None
  lines = [ln.rstrip() for ln in t.splitlines() if ln.strip()]
  if not lines:
    return None
  # Header like: "💊 Openbay ($OBAY)"
  hm = re.match(r"^.*?\s*([^\(\n]+?)\s*\(\$([A-Za-z0-9_]{2,20})\)\s*$", lines[0].strip())
  if not hm:
    return None
  name = hm.group(1).strip()
  ticker = hm.group(2).upper()
  mint = None
  for ln in lines:
    # Try Solana Base58 first (most common)
    mm = re.search(r"^[├└]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*$", ln.strip())
    if mm:
      mint = mm.group(1)
      break
    # Try TON address (EQ followed by Base58 with hyphens/underscores)
    ton_mm = re.search(r"^[├└]\s*(EQ[A-Za-z0-9_-]{40,50})\s*$", ln.strip())
    if ton_mm:
      mint = ton_mm.group(1)
      break
    # Try Sui Move address (0x + 64 hex + optional ::module::type)
    sui_mm = re.search(r"^[├└]\s*(0x[a-fA-F0-9]{64}(::[a-z_]+::[A-Z_]+)?)\s*$", ln.strip())
    if sui_mm:
      mint = sui_mm.group(1)
      break
    # Try EVM address (0x + 40 hex) - may be truncated like "0x2...5b0f"
    evm_mm = re.search(r"^[├└]\s*(0x[a-fA-F0-9]{2,40}(?:\.\.\.[a-fA-F0-9]{4})?)\s*$", ln.strip(), re.IGNORECASE)
    if evm_mm:
      # If truncated, try to find full address elsewhere in text
      evm_partial = evm_mm.group(1)
      if '...' not in evm_partial:
        mint = evm_partial.lower()
        break
  if mint is None:
    mint = find_first_mint(t)
  chain = None
  platform = None
  token_age_s = None
  views = None
  for ln in lines:
    if ln.strip().startswith("└ #"):
      cm = re.search(r"#([A-Za-z0-9_]+)", ln)
      if cm:
        chain = cm.group(1)
      pm = re.search(r"\(([^)]+)\)", ln)
      if pm:
        platform = pm.group(1).strip()
      am = re.search(r"🌱\s*([0-9.]+(?:s|m|h|d|w|mo|y))", ln)
      if am:
        token_age_s = parse_age_to_seconds(am.group(1))
      vm = re.search(r"👁️\s*([0-9]+)", ln)
      if vm:
        views = int(vm.group(1))
      break
  price_usd = None
  price_move_pct = None
  mcap_usd = None
  vol_usd = None
  liquidity_usd = None
  chg_1h_pct = None
  buys_1h = None
  sells_1h = None
  ath_mcap_usd = None
  ath_drawdown_pct = None
  ath_age_s = None
  fresh_1d_pct = None
  fresh_7d_pct = None
  top10_pct = None
  holders_total = None
  top5_holders_pct = None
  dev_sold = None
  dex_paid = None
  for ln in lines:
    x = ln.strip()
    if x.startswith("├ USD:"):
      pm = re.search(r"\$([0-9]+(?:\.[0-9]+)?)", x)
      if pm:
        price_usd = float(pm.group(1))
      mm = re.search(r"\(([+-]?\d+(?:\.\d+)?)%\)", x)
      if mm:
        price_move_pct = float(mm.group(1))
    elif x.startswith("├ MC:"):
      mm = re.search(r"\$([0-9.,]+[KMB]?)", x)
      if mm:
        mcap_usd = parse_num_suffix(mm.group(1))
    elif x.startswith("├ Vol:"):
      mm = re.search(r"\$([0-9.,]+[KMB]?)", x)
      if mm:
        vol_usd = parse_num_suffix(mm.group(1))
    elif x.startswith("├ LP") or x.startswith("├ LP:"):
      # Handle both "├ LP:" and "├ LP    $36.2K" formats
      mm = re.search(r"\$([0-9.,]+[KMB]?)", x)
      if mm:
        liquidity_usd = parse_num_suffix(mm.group(1))
    elif x.startswith("├ 1H:"):
      mm = re.search(r"([+-]?\d+(?:\.\d+)?)%", x)
      if mm:
        chg_1h_pct = float(mm.group(1))
      bm = re.search(r"🅑\s*(\d+)", x)
      sm = re.search(r"Ⓢ\s*(\d+)", x)
      if bm:
        buys_1h = int(bm.group(1))
      if sm:
        sells_1h = int(sm.group(1))
    elif x.startswith("└ ATH:"):
      mm = re.search(r"\$([0-9.,]+[KMB]?)", x)
      if mm:
        ath_mcap_usd = parse_num_suffix(mm.group(1))
      dd = re.search(r"\(([-+]?\d+(?:\.\d+)?)%\s*/\s*([0-9.]+(?:s|m|h|d|w|mo|y))\)", x)
      if dd:
        ath_drawdown_pct = float(dd.group(1))
        ath_age_s = parse_age_to_seconds(dd.group(2))
    elif x.startswith("├ Freshies:"):
      m1 = re.search(r"([0-9.]+)%\s*1D", x)
      m7 = re.search(r"([0-9.]+)%\s*7D", x)
      if m1:
        fresh_1d_pct = float(m1.group(1))
      if m7:
        fresh_7d_pct = float(m7.group(1))
    elif x.startswith("├ Top 10:"):
      mp = re.search(r"([0-9.]+)%", x)
      mt = re.search(r"\|\s*(\d+)\s*\(total\)", x)
      if mp:
        top10_pct = float(mp.group(1))
      if mt:
        holders_total = int(mt.group(1))
    elif x.startswith("├ TH:"):
      vals = x.split("TH:",1)[1].strip().replace(" ", "")
      parts = [p for p in vals.split("|") if p]
      try:
        top5_holders_pct = [float(p) for p in parts[:5]]
      except Exception:
        top5_holders_pct = None
    elif x.startswith("├ Dev Sold:"):
      dev_sold = "🟢" in x
    elif x.startswith("└ Dex Paid:") or x.startswith("├ Dex Paid:"):
      dex_paid = "🟢" in x
  return {
    "bot_type": "phanes",
    "token_name": name,
    "ticker": ticker,
    "mint": mint,
    "chain": chain,
    "platform": platform,
    "token_age_s": token_age_s,
    "views": views,
    "price_usd": price_usd,
    "price_move_pct": price_move_pct,
    "mcap_usd": mcap_usd,
    "vol_usd": vol_usd,
    "liquidity_usd": liquidity_usd,
    "chg_1h_pct": chg_1h_pct,
    "buys_1h": buys_1h,
    "sells_1h": sells_1h,
    "ath_mcap_usd": ath_mcap_usd,
    "ath_drawdown_pct": ath_drawdown_pct,
    "ath_age_s": ath_age_s,
    "fresh_1d_pct": fresh_1d_pct,
    "fresh_7d_pct": fresh_7d_pct,
    "top10_pct": top10_pct,
    "holders_total": holders_total,
    "top5_holders_pct_json": json.dumps(top5_holders_pct) if top5_holders_pct is not None else None,
    "dev_sold": dev_sold,
    "dex_paid": dex_paid,
    "card_json": json.dumps({"bot":"phanes", "name":name, "ticker":ticker, "mint":mint}, ensure_ascii=False)
  }

def parse_rick(text: str) -> Optional[Dict[str, Any]]:
  """
  Improved Rick parser: handles 🟡, 🟢, 💊, 🪐, 🧪, 🐶, ⚠️, ☀️, and other emoji formats.
  Extracts the high-value fields from various Rick message formats.
  """
  t = (text or "").strip()
  # Accept multiple emoji formats - Rick uses many different emojis
  rick_emojis = ["🟡", "🟢", "💊", "🪐", "🧪", "🐶", "⚠️", "☀️", "🌙", "🔥", "⭐", "💎"]
  has_rick_emoji = any(emoji in t for emoji in rick_emojis)
  
  # Check if it's a Rick-style message
  if has_rick_emoji:
    # If it has 💊, make sure it's not Phanes structure
    if "💊" in t and ("├" in t or "└" in t):
      # This is likely Phanes, not Rick
      return None
  else:
    return None
  
  lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
  if not lines:
    return None
  header = lines[0]
  
  # Try multiple header formats:
  # 🟡 NAME [3.6M/-17%] $$TICKER
  # 🟢 NAME [3.6M/-17%] $TICKER
  # 💊 NAME [1M/-43%] $TICKER
  # 🪐 NAME [255K/417%] $TICKER
  name = None
  mcap_usd = None
  mcap_change_pct = None
  ticker = None
  
  # Try multiple emoji formats: 🟡, 🟢, 💊, 🪐, 🧪, 🐶, ⚠️, ☀️, etc.
  # Pattern: [EMOJI] NAME [MCAP/CHANGE%] $TICKER
  emoji_pattern = r"[🟡🟢💊🪐🧪🐶⚠️☀️🌙🔥⭐💎]\s*(.+?)\s*\[(.*?)\]"
  hm = re.search(emoji_pattern, header)
  if hm:
    name = hm.group(1).strip()
    bracket = hm.group(2).strip()
    parts = [p.strip() for p in bracket.split("/") if p.strip()]
    if len(parts) >= 1:
      mcap_usd = parse_num_suffix(parts[0])
    if len(parts) >= 2:
      mm = re.match(r"^([+-]?\d+(?:\.\d+)?)(K)?%$", parts[1], re.IGNORECASE)
      if mm:
        v = float(mm.group(1))
        if mm.group(2):
          v *= 1000.0
        mcap_change_pct = v
  else:
    # Try simpler formats: EMOJI NAME - $TICKER or EMOJI NAME $TICKER
    simple_patterns = [
      r"[🟡🟢💊🪐🧪🐶⚠️☀️🌙🔥⭐💎]\s*(.+?)\s*-\s*\$([A-Za-z0-9_]+)",
      r"[🟡🟢💊🪐🧪🐶⚠️☀️🌙🔥⭐💎]\s*(.+?)\s*\$([A-Za-z0-9_]+)"
    ]
    for pattern in simple_patterns:
      hm = re.search(pattern, header)
      if hm:
        name = hm.group(1).strip()
        ticker = hm.group(2).upper()
        break
  
  # Extract ticker if not already found
  if not ticker:
    tm = re.search(r"(\${1,2})([A-Za-z0-9_]{2,20})", header)
    if tm:
      ticker = tm.group(2).upper()
  chain = None
  platform = None
  price_usd = None
  liq = None
  vol = None
  for ln in lines[1:]:
    if ln.startswith("🌐"):
      m = re.match(r"^🌐\s*(.+?)\s*@\s*(.+)$", ln)
      if m:
        chain = m.group(1).strip()
        platform = m.group(2).strip().split()[0]
    elif ln.startswith("💰"):
      m = re.search(r"\$(\d+(?:\.\d+)?)", ln)
      if m:
        price_usd = float(m.group(1))
    elif ln.startswith("💦"):
      m = re.search(r"Liq:\s*\$?([0-9.,]+[KMB]?)", ln)
      if m:
        liq = parse_num_suffix(m.group(1))
    elif ln.startswith("├ LP") or ln.startswith("├ LP:"):
      # Handle Phanes-style LP format in Rick messages: "├ LP:   $27.2K"
      m = re.search(r"\$([0-9.,]+[KMB]?)", ln)
      if m:
        liq = parse_num_suffix(m.group(1))
    elif ln.startswith("📊"):
      m = re.search(r"Vol:\s*\$?([0-9.,]+[KMB]?)", ln)
      if m:
        vol = parse_num_suffix(m.group(1))
  # Try to find mint - check Solana, EVM, TON, and Sui Move addresses
  mint = find_first_mint(t)
  return {
    "bot_type": "rick",
    "token_name": name,
    "ticker": ticker,
    "mint": mint,
    "chain": chain,
    "platform": platform,
    "price_usd": price_usd,
    "mcap_usd": mcap_usd,
    "mcap_change_pct": mcap_change_pct,
    "vol_usd": vol,
    "liquidity_usd": liq,
    "card_json": json.dumps({"bot":"rick", "name":name, "ticker":ticker, "mint":mint}, ensure_ascii=False)
  }

def parse_bot_fallback(from_name: Optional[str], text: str, trigger_text: Optional[str] = None) -> Optional[Dict[str, Any]]:
  """
  Enhanced fallback parser: extracts minimum required fields (mint, ticker, caller info)
  and attempts to extract additional fields (mcap, price, chain) from trigger text.
  Used when full parsing fails but we still want to capture the alert.
  """
  t = (text or "").strip()
  trig = (trigger_text or "").strip()
  combined = f"{t} {trig}".strip()
  
  if not combined:
    return None
  
  # Skip obvious non-token messages
  skip_patterns = [
    "Invalid Input", "Use /dp", "Leaderboard", "Top Callers",
    "Hey @", "tweet from", "good shill", "/dp", "/lb", "/pnl",
    "Share on", "DexScreener not paid", "DexPaid"
  ]
  if any(pattern in combined for pattern in skip_patterns):
    return None
  
  mint = find_first_mint(t)
  if not mint:
    mint = find_first_mint(trig)
  
  # Try to extract ticker from both sources
  ticker = None
  for source in [t, trig]:
    if not source:
      continue
    tm = re.search(r"\$([A-Za-z0-9_]{2,20})\b", source)
    if tm:
      ticker = tm.group(1).upper()
      break
  
  # Try to extract mcap from trigger text (common patterns)
  mcap_usd = None
  if trig:
    # Patterns: "mc 1.5M", "mcap 1.5M", "$1.5M", "1.5M mcap", "stand at mc 1.3M", "mcap is 1.5M"
    mcap_patterns = [
      r"(?:mc|mcap)[:\s]+([0-9.,]+[KMB]?)",
      r"(?:mc|mcap)\s+is\s+([0-9.,]+[KMB]?)",
      r"stand\s+at\s+(?:mc|mcap)\s+([0-9.,]+[KMB]?)",
      r"\$([0-9.,]+[KMB]?)\s*(?:mc|mcap)",
      r"([0-9.,]+[KMB]?)\s*(?:mc|mcap)",
      r"mc\s+([0-9.,]+[KMB]?)",  # Simple "mc 1.5M"
      r"\$([0-9.,]+[KMB]?)\s*m",  # "$1.5M" or "$1.5m" (assuming M suffix)
    ]
    for pattern in mcap_patterns:
      m = re.search(pattern, trig, re.IGNORECASE)
      if m:
        mcap_usd = parse_num_suffix(m.group(1))
        if mcap_usd:
          break
    # Also try from bot text if trigger didn't work
    if not mcap_usd and t:
      for pattern in mcap_patterns:
        m = re.search(pattern, t, re.IGNORECASE)
        if m:
          mcap_usd = parse_num_suffix(m.group(1))
          if mcap_usd:
            break
  
  # Try to extract price from trigger text
  price_usd = None
  if trig:
    # Look for price patterns: "$0.001", "price 0.001"
    price_patterns = [
      r"\$([0-9]+\.[0-9]+)",
      r"price[:\s]+\$?([0-9]+\.[0-9]+)"
    ]
    for pattern in price_patterns:
      m = re.search(pattern, trig, re.IGNORECASE)
      if m:
        try:
          price_usd = float(m.group(1))
          break
        except:
          pass
  
  # Try to detect chain
  chain = None
  chain_keywords = {
    "solana": "solana", "sol": "solana",
    "ethereum": "ethereum", "eth": "ethereum",
    "bnb": "bsc", "bsc": "bsc", "binance": "bsc",
    "tron": "tron", "trx": "tron",
    "base": "base", "polygon": "polygon", "matic": "polygon"
  }
  combined_lower = combined.lower()
  for keyword, chain_name in chain_keywords.items():
    if keyword in combined_lower:
      chain = chain_name
      break
  
  # Only return if we found at least mint or ticker
  if mint or ticker:
    return {
      "bot_type": "unknown",
      "token_name": None,
      "ticker": ticker,
      "mint": mint,
      "chain": chain,
      "platform": None,
      "mcap_usd": mcap_usd,
      "price_usd": price_usd,
      "card_json": json.dumps({"bot":"fallback", "ticker":ticker, "mint":mint}, ensure_ascii=False)
    }
  return None

def parse_bot(from_name: Optional[str], text: str, trigger_text: Optional[str] = None) -> Optional[Dict[str, Any]]:
  fn = (from_name or "").lower()
  if "phanes" in fn:
    result = parse_phanes(text)
    if result:
      return result
  # allow emoji-based detection
  if "🟣" in text or "💊" in text:
    result = parse_phanes(text)
    if result:
      return result
  # Rick uses many emoji variants
  rick_indicators = ["rick" in fn, "🟡" in text, "🟢" in text, "🪐" in text, 
                     "🧪" in text, "🐶" in text, "⚠️" in text, "☀️" in text]
  if any(rick_indicators):
    result = parse_rick(text)
    if result:
      return result
  
  # Fallback: try to extract at least mint and ticker
  return parse_bot_fallback(from_name, text, trigger_text)

# ---------- idempotency helpers ----------

def generate_run_id(input_file_path: str, chat_id: str) -> str:
  """Generate deterministic run_id from input file hash + chat_id + timestamp"""
  with open(input_file_path, 'rb') as f:
    file_hash = hashlib.sha256(f.read()).hexdigest()[:16]
  
  timestamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
  return f"ingest_{chat_id}_{timestamp}_{file_hash}"

def get_input_file_hash(input_file_path: str) -> str:
  """Get SHA256 hash of input file"""
  with open(input_file_path, 'rb') as f:
    return hashlib.sha256(f.read()).hexdigest()

def check_existing_run(con: duckdb.DuckDBPyConnection, input_file_path: str, chat_id: str, script_version: str, force: bool = False) -> Optional[Tuple[str, str, Optional[str]]]:
  """Check if this input was already processed successfully
  
  Args:
    con: DuckDB connection
    input_file_path: Path to input file
    chat_id: Chat ID
    script_version: Current script version hash
    force: If True, ignore existing runs (force rerun)
  
  Returns: (run_id, status, previous_script_version) if found, None otherwise
  """
  if force:
    return None  # Force rerun, ignore existing runs
  
  try:
    # Check if ingestion_runs table exists
    result = con.execute("""
      SELECT COUNT(*) FROM information_schema.tables 
      WHERE table_name = 'ingestion_runs'
    """).fetchone()
    
    if not result or result[0] == 0:
      # Table doesn't exist - old schema, proceed normally
      return None
    
    file_hash = get_input_file_hash(input_file_path)
    result = con.execute("""
      SELECT run_id, status, script_version 
      FROM ingestion_runs 
      WHERE input_file_hash = ? AND chat_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    """, [file_hash, chat_id]).fetchone()
    
    if result:
      existing_run_id, existing_status, previous_script_version = result
      # If script version changed, allow rerun (extraction logic may have improved)
      if previous_script_version and previous_script_version != script_version:
        print(f"Script version changed ({previous_script_version} → {script_version}). Allowing rerun to capture improved extractions.")
        return None  # Allow rerun
      return (existing_run_id, existing_status, previous_script_version)
    return None
  except Exception:
    # If table doesn't exist or any error, proceed normally
    return None

def start_ingestion_run(con: duckdb.DuckDBPyConnection, run_id: str, chat_id: str, input_file_path: str, script_version: str) -> None:
  """Record start of ingestion run"""
  try:
    file_hash = get_input_file_hash(input_file_path)
    # Check if script_version column exists
    try:
      con.execute("SELECT script_version FROM ingestion_runs LIMIT 1")
      # Column exists
      con.execute("""
        INSERT INTO ingestion_runs 
        (run_id, chat_id, input_file_path, input_file_hash, status, started_at, script_version)
        VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP, ?)
      """, [run_id, chat_id, input_file_path, file_hash, script_version])
    except Exception:
      # Column doesn't exist (old schema), add it and retry
      try:
        con.execute("ALTER TABLE ingestion_runs ADD COLUMN script_version TEXT")
        con.execute("""
          INSERT INTO ingestion_runs 
          (run_id, chat_id, input_file_path, input_file_hash, status, started_at, script_version)
          VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP, ?)
        """, [run_id, chat_id, input_file_path, file_hash, script_version])
      except Exception:
        # If ALTER fails, use old schema (no script_version)
        con.execute("""
          INSERT INTO ingestion_runs 
          (run_id, chat_id, input_file_path, input_file_hash, status, started_at)
          VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)
        """, [run_id, chat_id, input_file_path, file_hash])
  except Exception:
    # If table doesn't exist, silently continue (old schema)
    pass

def complete_ingestion_run(con: duckdb.DuckDBPyConnection, run_id: str, row_counts: Dict[str, int]) -> None:
  """Mark run as completed with row counts"""
  try:
    con.execute("""
      UPDATE ingestion_runs 
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          rows_inserted_tg_norm = ?,
          rows_inserted_caller_links = ?,
          rows_inserted_user_calls = ?
      WHERE run_id = ?
    """, [
      row_counts.get('tg_norm', 0),
      row_counts.get('caller_links', 0),
      row_counts.get('user_calls', 0),
      run_id
    ])
  except Exception:
    # If table doesn't exist, silently continue (old schema)
    pass

def fail_ingestion_run(con: duckdb.DuckDBPyConnection, run_id: str, error_message: str) -> None:
  """Mark run as failed"""
  try:
    con.execute("""
      UPDATE ingestion_runs 
      SET status = 'failed',
          completed_at = CURRENT_TIMESTAMP,
          error_message = ?
      WHERE run_id = ?
    """, [error_message, run_id])
  except Exception:
    pass

def resume_partial_run(con: duckdb.DuckDBPyConnection, run_id: str) -> None:
  """Delete partial data and allow re-insert"""
  try:
    con.execute("DELETE FROM tg_norm_d WHERE run_id = ?", [run_id])
    con.execute("DELETE FROM caller_links_d WHERE run_id = ?", [run_id])
    con.execute("DELETE FROM user_calls_d WHERE run_id = ?", [run_id])
    con.execute("""
      UPDATE ingestion_runs 
      SET status = 'running', completed_at = NULL, error_message = NULL
      WHERE run_id = ?
    """, [run_id])
  except Exception:
    pass

def ensure_idempotent_schema(con: duckdb.DuckDBPyConnection) -> None:
  """Ensure schema has idempotency support (run_id columns, ingestion_runs table)"""
  # Create ingestion_runs table if it doesn't exist
  con.execute("""
    CREATE TABLE IF NOT EXISTS ingestion_runs (
      run_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      input_file_path TEXT NOT NULL,
      input_file_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      rows_inserted_tg_norm INTEGER DEFAULT 0,
      rows_inserted_caller_links INTEGER DEFAULT 0,
      rows_inserted_user_calls INTEGER DEFAULT 0,
      error_message TEXT,
      script_version TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  """)
  
  # Add script_version column if it doesn't exist
  try:
    con.execute("SELECT script_version FROM ingestion_runs LIMIT 1")
  except Exception:
    try:
      con.execute("ALTER TABLE ingestion_runs ADD COLUMN script_version TEXT")
    except Exception:
      pass  # Column might already exist or table doesn't exist
  
  # Add indexes
  con.execute("CREATE INDEX IF NOT EXISTS idx_ingestion_runs_chat_id ON ingestion_runs(chat_id)")
  con.execute("CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status)")
  con.execute("CREATE INDEX IF NOT EXISTS idx_ingestion_runs_input_hash ON ingestion_runs(input_file_hash)")
  
  # Check if run_id columns exist and add them if missing
  # Use try/except: try to select run_id, if it fails, add the column
  for table in ['tg_norm_d', 'caller_links_d', 'user_calls_d']:
    try:
      # Try to select run_id - if it fails, column doesn't exist
      con.execute(f"SELECT run_id FROM {table} LIMIT 1")
      # Column exists, check for inserted_at
      try:
        con.execute(f"SELECT inserted_at FROM {table} LIMIT 1")
      except Exception:
        # inserted_at doesn't exist, add it
        try:
          con.execute(f"ALTER TABLE {table} ADD COLUMN inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
        except Exception:
          pass
    except Exception:
      # Column doesn't exist, add both columns
      try:
        con.execute(f"ALTER TABLE {table} ADD COLUMN run_id TEXT NOT NULL DEFAULT 'legacy'")
        con.execute(f"ALTER TABLE {table} ADD COLUMN inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
        # Create index
        con.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_run_id ON {table}(run_id)")
      except Exception as e:
        # If ALTER fails (e.g., table doesn't exist yet, or column already exists), that's OK
        # This can happen if table is created fresh with the new schema
        pass

# ---------- duckdb work ----------

# Legacy schema (backward compatible, no PRIMARY KEYs, no run_id)
DUCK_SCHEMA_SQL_LEGACY = """
CREATE TABLE IF NOT EXISTS tg_norm_d (
  chat_id TEXT,
  chat_name TEXT,
  message_id BIGINT,
  ts_ms BIGINT,
  from_name TEXT,
  from_id TEXT,
  type TEXT,
  is_service BOOLEAN,
  reply_to_message_id BIGINT,
  text TEXT,
  links_json TEXT,
  norm_json TEXT
);

CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT,
  trigger_message_id BIGINT,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN
);

CREATE TABLE IF NOT EXISTS user_calls_d (
  chat_id TEXT,
  message_id BIGINT,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name TEXT,
  caller_id TEXT,
  trigger_text TEXT,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint TEXT,
  ticker TEXT,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN DEFAULT FALSE,
  token_resolution_method TEXT
);
"""

# Enhanced schema with idempotency support (PRIMARY KEYs, run_id)
DUCK_SCHEMA_SQL_IDEMPOTENT = """
CREATE TABLE IF NOT EXISTS tg_norm_d (
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  message_id BIGINT NOT NULL,
  ts_ms BIGINT,
  from_name TEXT,
  from_id TEXT,
  type TEXT,
  is_service BOOLEAN,
  reply_to_message_id BIGINT,
  text TEXT,
  links_json TEXT,
  norm_json TEXT,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);

CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT NOT NULL,
  trigger_message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT NOT NULL,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trigger_chat_id, trigger_message_id, bot_message_id, run_id)
);

CREATE TABLE IF NOT EXISTS user_calls_d (
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name TEXT,
  caller_id TEXT,
  trigger_text TEXT,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint TEXT,
  ticker TEXT,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN DEFAULT FALSE,
  token_resolution_method TEXT,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);
"""

# Use legacy schema by default for backward compatibility
DUCK_SCHEMA_SQL = DUCK_SCHEMA_SQL_LEGACY

def get_script_version() -> str:
  """Get script version hash (for detecting script changes that improve extraction)"""
  try:
    # Hash the script file itself to detect changes
    script_path = __file__
    with open(script_path, 'rb') as f:
      script_hash = hashlib.sha256(f.read()).hexdigest()[:16]
    return script_hash
  except Exception:
    # Fallback: use a version string (update this when making breaking changes)
    return "v1.0"

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--in", dest="in_path", required=True, help="Telegram single-chat JSON")
  ap.add_argument("--duckdb", required=True, help="Output duckdb file, e.g. tele.duckdb")
  ap.add_argument("--sqlite", default=None, help="Optional tele.db to compare against")
  ap.add_argument("--rebuild", action="store_true")
  ap.add_argument("--chat-id", default=None, help="Override/force chat_id")
  ap.add_argument("--force", action="store_true", help="Force rerun even if input was already processed (useful when script extraction logic improved)")
  ap.add_argument("--export-csv", default=None, help="Export alerts to CSV file")
  ap.add_argument("--export-parquet", default=None, help="Export alerts to Parquet file")
  ap.add_argument("--export-parquet-run", action="store_true", help="Export user_calls_d and caller_links_d to Parquet with run ID")
  ap.add_argument("--run-id", default=None, help="Run ID for Parquet export (required with --export-parquet-run)")
  ap.add_argument("--output-dir", default="./artifacts", help="Output directory for Parquet exports (default: ./artifacts)")
  args = ap.parse_args()

  con = duckdb.connect(args.duckdb)
  con.execute("PRAGMA threads=4;")
  con.execute("PRAGMA memory_limit='4GB';")

  if args.rebuild:
    con.execute("DROP TABLE IF EXISTS tg_norm_d;")
    con.execute("DROP TABLE IF EXISTS caller_links_d;")
    con.execute("DROP TABLE IF EXISTS user_calls_d;")
    con.execute("DROP TABLE IF EXISTS ingestion_runs;")
    # Use idempotent schema for new databases
    con.execute(DUCK_SCHEMA_SQL_IDEMPOTENT)
  else:
    # Use legacy schema for existing databases (backward compatible)
    con.execute(DUCK_SCHEMA_SQL_LEGACY)
  
  # Ensure idempotent schema is in place (adds run_id columns if missing, creates ingestion_runs)
  ensure_idempotent_schema(con)

  # --- read top-level chat info first ---
  chat_id = None
  chat_name = None
  chat_type = None
  with open(args.in_path, "rb") as f:
    parser = ijson.parse(f)
    for prefix, event, value in parser:
      if prefix == "id" and event in ("string","number"):
        chat_id = str(value)
      elif prefix == "name" and event == "string":
        chat_name = value
      elif prefix == "type" and event == "string":
        chat_type = value
      elif prefix.startswith("messages"):
        break

  if args.chat_id:
    chat_id = args.chat_id
  if chat_id is None:
    chat_id = "single_chat"
  if chat_name is None:
    chat_name = "Unknown Chat"

  # --- idempotency: check for existing run ---
  script_version = get_script_version()
  existing_run = check_existing_run(con, args.in_path, chat_id, script_version, force=args.force)
  run_id = None
  
  if existing_run:
    existing_run_id, existing_status, previous_script_version = existing_run
    if existing_status == 'completed':
      # Get row counts from completed run
      result = con.execute("""
        SELECT rows_inserted_tg_norm, rows_inserted_caller_links, rows_inserted_user_calls
        FROM ingestion_runs
        WHERE run_id = ?
      """, [existing_run_id]).fetchone()
      
      if result:
        tg_rows, caller_links_rows, user_calls_rows = result
        print(json.dumps({
          "chat_id": chat_id,
          "chat_name": chat_name,
          "duckdb_file": args.duckdb,
          "run_id": existing_run_id,
          "status": "already_completed",
          "script_version": previous_script_version or "unknown",
          "tg_rows": tg_rows or 0,
          "caller_links_rows": caller_links_rows or 0,
          "user_calls_rows": user_calls_rows or 0,
        }, indent=2))
      else:
        print(f"Input file already processed successfully (run_id: {existing_run_id}). Skipping.")
        if not args.force:
          print("Use --force to rerun even if already processed.")
      # Return early - already processed
      con.close()
      return
    elif existing_status == 'partial':
      print(f"Resuming partial run (run_id: {existing_run_id})...")
      run_id = existing_run_id
      resume_partial_run(con, run_id)
    elif existing_status == 'running':
      print(f"Resuming interrupted run (run_id: {existing_run_id})...")
      run_id = existing_run_id
      resume_partial_run(con, run_id)
  
  if run_id is None:
    run_id = generate_run_id(args.in_path, chat_id)
    start_ingestion_run(con, run_id, chat_id, args.in_path, script_version)
  
  # Track row counts for completion
  row_counts = {'tg_norm': 0, 'caller_links': 0, 'user_calls': 0}

  # --- ingest messages streaming ---
  batch = []
  BATCH_N = 5000
  with open(args.in_path, "rb") as f:
    for m in ijson.items(f, "messages.item"):
      mid = m.get("id")
      if mid is None:
        continue
      ts_ms = ts_ms_from_obj(m)
      from_name = m.get("from")
      from_id = m.get("from_id")
      mtype = m.get("type")
      is_service = False if (mtype == "message") else True
      text = flatten_text(m.get("text"))
      links_json = json.dumps(m.get("links"), ensure_ascii=False) if m.get("links") is not None else None
      norm_json = json.dumps(m, ensure_ascii=False)
      reply_to = m.get("reply_to_message_id")
      reply_to_mid = int(reply_to) if isinstance(reply_to, int) or (isinstance(reply_to, str) and reply_to.isdigit()) else None

      batch.append((
        chat_id,
        chat_name,
        int(mid),
        int(ts_ms) if ts_ms is not None else None,
        from_name,
        from_id,
        mtype,
        bool(is_service),
        reply_to_mid,
        text,
        links_json,
        norm_json,
        run_id  # Add run_id
      ))

      if len(batch) >= BATCH_N:
        # Use INSERT OR IGNORE to prevent duplicates
        result = con.executemany("""
          INSERT OR IGNORE INTO tg_norm_d 
          (chat_id, chat_name, message_id, ts_ms, from_name, from_id, type, is_service, 
           reply_to_message_id, text, links_json, norm_json, run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, batch)
        row_counts['tg_norm'] += len(batch)
        batch.clear()

  if batch:
    result = con.executemany("""
      INSERT OR IGNORE INTO tg_norm_d 
      (chat_id, chat_name, message_id, ts_ms, from_name, from_id, type, is_service, 
       reply_to_message_id, text, links_json, norm_json, run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, batch)
    row_counts['tg_norm'] += len(batch)
    batch.clear()

  # --- link bot replies by reply_to join + parse in python ---
  # pull candidates (only replies) then parse per row
  rows = con.execute("""
    SELECT
      b.chat_id,
      b.message_id AS bot_message_id,
      b.ts_ms AS bot_ts_ms,
      b.from_name AS bot_from_name,
      b.text AS bot_text,
      b.reply_to_message_id AS trigger_message_id,
      t.ts_ms AS trigger_ts_ms,
      t.from_id AS trigger_from_id,
      t.from_name AS trigger_from_name,
      t.text AS trigger_text
    FROM tg_norm_d b
    JOIN tg_norm_d t
      ON t.chat_id = b.chat_id
     AND t.message_id = b.reply_to_message_id
    WHERE b.chat_id = ?
      AND b.reply_to_message_id IS NOT NULL
      AND b.is_service = FALSE
      AND b.ts_ms IS NOT NULL
      AND t.ts_ms IS NOT NULL
      -- Filter out bot commands (messages starting with /)
      AND NOT (t.text LIKE '/%')
  """, [chat_id]).fetchall()

  link_rows = []
  for r in rows:
    (c_id, bot_mid, bot_ts, bot_from, bot_text, trig_mid, trig_ts, trig_from_id, trig_from_name, trig_text) = r
    card = parse_bot(bot_from, bot_text or "", trig_text)
    
    # Link bot messages even if card parsing fails (like SQLite does)
    # This improves Phanes reply rate significantly
    if not card:
      # Still create a link entry with minimal data
      # Extract mint/ticker from bot text or trigger text as fallback
      mint = None
      ticker = None
      
      # Try to extract mint from bot text (use BASE58_RE from this file)
      if bot_text:
        mints = BASE58_RE.findall(bot_text)
        if mints:
          mint = mints[0]
        # Also check for EVM addresses
        evm_matches = EVM_ADDRESS_RE.findall(bot_text)
        if evm_matches and not mint:
          mint = evm_matches[0].lower()
      
      # Try to extract ticker from bot text
      if bot_text:
        ticker_matches = re.findall(r"\$\$?([A-Za-z0-9_]{2,20})", bot_text)
        if ticker_matches:
          ticker = ticker_matches[0].upper()
      
      # Fallback to trigger text if bot text didn't yield results
      if not mint and trig_text:
        mints = BASE58_RE.findall(trig_text)
        if mints:
          mint = mints[0]
        evm_matches = EVM_ADDRESS_RE.findall(trig_text)
        if evm_matches and not mint:
          mint = evm_matches[0].lower()
      
      if not ticker and trig_text:
        ticker_matches = re.findall(r"\$\$?([A-Za-z0-9_]{2,20})", trig_text)
        if ticker_matches:
          ticker = ticker_matches[0].upper()
      
      # Create minimal card for linking
      bot_type = "rick" if "rick" in (bot_from or "").lower() else ("phanes" if "phanes" in (bot_from or "").lower() else "unknown")
      card = {
        "bot_type": bot_type,
        "mint": mint,
        "ticker": ticker,
        "token_name": None,
        "chain": None,
        "platform": None,
        "price_usd": None,
        "mcap_usd": None,
        "vol_usd": None,
        "liquidity_usd": None,
        "card_json": json.dumps({"bot": bot_type, "mint": mint, "ticker": ticker}, ensure_ascii=False)
      }
    
    # Pass 1 + Pass 2: Extract and validate address (Solana or EVM)
    # Preserves case, never truncates
    detected_chain = card.get("chain")
    if USE_EXTRACTED_MODULE:
        # Use extracted module
        solana_candidates = find_solana_candidates(bot_text or "", int(bot_mid))
        evm_candidates = find_evm_candidates(bot_text or "", int(bot_mid))
        # Filter by chain if known
        chain_lower = (detected_chain or "").lower()
        if chain_lower in ["evm", "ethereum", "eth", "base", "arbitrum", "arb", "bsc", "bnb", "polygon", "matic"]:
            address_candidates = evm_candidates
        elif chain_lower in ["solana", "sol"]:
            address_candidates = solana_candidates
        else:
            address_candidates = solana_candidates + evm_candidates
    else:
        # Use inline function
        address_candidates = find_address_candidates(bot_text or "", int(bot_mid), detected_chain)
    
    mint = None
    mint_raw = None
    mint_validation_status = None
    mint_validation_reason = None
    final_chain = detected_chain
    
    # Find first valid address (Pass 1 + Pass 2)
    for candidate in address_candidates:
      if candidate.status == MintValidationStatus.PASS1_ACCEPTED:
        if candidate.address_type == "solana":
          # Solana validation
          is_valid, reason = validate_mint_pass2(candidate.normalized)
          if is_valid:
            mint = candidate.normalized  # Use normalized (preserves case, just cleaned)
            mint_raw = candidate.raw  # Keep original for audit
            mint_validation_status = MintValidationStatus.PASS2_ACCEPTED.value
            if not final_chain:
              final_chain = "solana"
            break
          else:
            # Pass 1 passed but Pass 2 failed
            mint_raw = candidate.raw
            mint_validation_status = MintValidationStatus.PASS2_REJECTED.value
            mint_validation_reason = reason
        elif candidate.address_type == "evm":
          # EVM validation
          is_valid, reason, checksum_status = validate_evm_pass2(candidate.normalized)
          if is_valid:
            mint = candidate.normalized.lower()  # Store lowercase for EVM (canonical)
            mint_raw = candidate.raw  # Keep original (preserves case for checksum)
            mint_validation_status = MintValidationStatus.PASS2_ACCEPTED.value
            if not final_chain:
              final_chain = "evm"
            break
          else:
            mint_raw = candidate.raw
            mint_validation_status = MintValidationStatus.PASS2_REJECTED.value
            mint_validation_reason = reason
    
    # Fallback: if no valid address found, try trigger text
    if not mint and trig_text:
      trigger_candidates = find_address_candidates(trig_text, int(trig_mid), detected_chain)
      for candidate in trigger_candidates:
        if candidate.status == MintValidationStatus.PASS1_ACCEPTED:
          if candidate.address_type == "solana":
            is_valid, reason = validate_mint_pass2(candidate.normalized)
            if is_valid:
              mint = candidate.normalized
              mint_raw = candidate.raw
              mint_validation_status = MintValidationStatus.PASS2_ACCEPTED.value
              if not final_chain:
                final_chain = "solana"
              break
          elif candidate.address_type == "evm":
            is_valid, reason, checksum_status = validate_evm_pass2(candidate.normalized)
            if is_valid:
              mint = candidate.normalized.lower()
              mint_raw = candidate.raw
              mint_validation_status = MintValidationStatus.PASS2_ACCEPTED.value
              if not final_chain:
                final_chain = "evm"
              break
    
    # If still no mint, try card.get("mint") as fallback (for backward compatibility)
    if not mint:
      mint = card.get("mint")
      if mint:
        # Try to determine type and validate
        if mint.startswith("0x") and len(mint) == 42:
          # EVM address
          is_valid, reason, checksum_status = validate_evm_pass2(mint)
          if is_valid:
            mint = mint.lower()  # Normalize to lowercase
            mint_validation_status = MintValidationStatus.PASS2_ACCEPTED.value
            if not final_chain:
              final_chain = "evm"
          else:
            mint_validation_status = MintValidationStatus.PASS2_REJECTED.value
            mint_validation_reason = reason
        else:
          # Assume Solana
          is_valid, reason = validate_mint_pass2(mint)
          if is_valid:
            mint_validation_status = MintValidationStatus.PASS2_ACCEPTED.value
            if not final_chain:
              final_chain = "solana"
          else:
            mint_validation_status = MintValidationStatus.PASS2_REJECTED.value
            mint_validation_reason = reason
    
    ticker = card.get("ticker")
    token_name = card.get("token_name")
    
    # validation: mint present in trigger OR token name substring
    validation = False
    if mint and trig_text and mint in trig_text:
      validation = True
    elif token_name and trig_text and str(token_name).lower() in trig_text.lower():
      validation = True

    token_age_s = card.get("token_age_s")
    token_created_ts_ms = None
    if token_age_s is not None and bot_ts is not None:
      try:
        token_created_ts_ms = int(bot_ts) - int(token_age_s) * 1000
      except Exception:
        token_created_ts_ms = None
    
    # Check for zero liquidity
    liquidity_usd = card.get("liquidity_usd")
    zero_liquidity = False
    if liquidity_usd is not None:
      # Check for 0, 0x, LP 0, etc.
      if liquidity_usd == 0:
        zero_liquidity = True
      # Also check if bot text mentions zero liquidity
      if bot_text:
        zero_liq_patterns = [
          r"LP\s*[:\s]*0\b",
          r"Liq[:\s]*\$?\s*0\b",
          r"liquidity[:\s]*\$?\s*0\b",
          r"0x\s*LP",
        ]
        for pattern in zero_liq_patterns:
          if re.search(pattern, bot_text, re.IGNORECASE):
            zero_liquidity = True
            break

    link_rows.append((
      c_id, int(trig_mid), int(trig_ts), trig_from_id, trig_from_name, trig_text,
      int(bot_mid), int(bot_ts), bot_from, card.get("bot_type"),
      token_name, ticker, mint, mint_raw, mint_validation_status, mint_validation_reason,
      final_chain or card.get("chain"), card.get("platform"),
      token_age_s, token_created_ts_ms, card.get("views"),
      card.get("price_usd"), card.get("price_move_pct"), card.get("mcap_usd"), card.get("mcap_change_pct"),
      card.get("vol_usd"), liquidity_usd, zero_liquidity,
      card.get("chg_1h_pct"), card.get("buys_1h"), card.get("sells_1h"),
      card.get("ath_mcap_usd"), card.get("ath_drawdown_pct"), card.get("ath_age_s"),
      card.get("fresh_1d_pct"), card.get("fresh_7d_pct"), card.get("top10_pct"), card.get("holders_total"),
      card.get("top5_holders_pct_json"), card.get("dev_sold"), card.get("dex_paid"),
      card.get("card_json"), bool(validation),
      run_id  # Add run_id
    ))

  # replace old links for this run (idempotent: only delete this run's data)
  con.execute("DELETE FROM caller_links_d WHERE trigger_chat_id = ? AND run_id = ?", [chat_id, run_id])
  if link_rows:
    # Use INSERT OR IGNORE to prevent duplicates
    con.executemany("""
      INSERT OR IGNORE INTO caller_links_d (
        trigger_chat_id, trigger_message_id, trigger_ts_ms, trigger_from_id, trigger_from_name, trigger_text,
        bot_message_id, bot_ts_ms, bot_from_name, bot_type,
        token_name, ticker, mint, mint_raw, mint_validation_status, mint_validation_reason,
        chain, platform,
        token_age_s, token_created_ts_ms, views,
        price_usd, price_move_pct, mcap_usd, mcap_change_pct,
        vol_usd, liquidity_usd, zero_liquidity,
        chg_1h_pct, buys_1h, sells_1h,
        ath_mcap_usd, ath_drawdown_pct, ath_age_s,
        fresh_1d_pct, fresh_7d_pct, top10_pct, holders_total,
        top5_holders_pct_json, dev_sold, dex_paid,
        card_json, validation_passed, run_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, link_rows)
    row_counts['caller_links'] = len(link_rows)

  # --- build user_calls_d from links (one row per trigger) ---
  # Delete only this run's data (idempotent)
  con.execute("DELETE FROM user_calls_d WHERE chat_id = ? AND run_id = ?", [chat_id, run_id])
  
  # First, create temp table with all potential calls
  con.execute("""
    CREATE TEMP TABLE temp_user_calls AS
    SELECT
      l.trigger_chat_id AS chat_id,
      l.trigger_message_id AS message_id,
      l.trigger_ts_ms AS call_ts_ms,
      to_timestamp(l.trigger_ts_ms/1000.0) AS call_datetime,
      l.trigger_from_name AS caller_name,
      l.trigger_from_id AS caller_id,
      l.trigger_text AS trigger_text,
      MIN(l.bot_message_id) FILTER (WHERE l.bot_type = 'rick') AS bot_reply_id_1,
      MIN(l.bot_message_id) FILTER (WHERE l.bot_type = 'phanes') AS bot_reply_id_2,
      COALESCE(
        MAX(l.mint) FILTER (WHERE l.bot_type='rick'),
        MAX(l.mint) FILTER (WHERE l.bot_type='phanes'),
        -- Extract from trigger text ONLY if trigger doesn't have $ cashtag
        -- If trigger has $ cashtag, user is calling by ticker - mint must come from bot reply
        CASE 
          -- If trigger has $ cashtag, don't extract from trigger (mint must be in bot reply)
          WHEN regexp_matches(MAX(l.trigger_text), '\$\$?[A-Za-z0-9_]{2,20}') THEN NULL
          -- Otherwise, extract from trigger text (Solana Base58 first, then EVM)
          WHEN regexp_matches(MAX(l.trigger_text), '[1-9A-HJ-NP-Za-km-z]{32,44}') THEN
            (regexp_extract(MAX(l.trigger_text), '([1-9A-HJ-NP-Za-km-z]{32,44})', 1))[1]
          WHEN regexp_matches(MAX(l.trigger_text), '0x[a-fA-F0-9]{40}') THEN
            LOWER((regexp_extract(MAX(l.trigger_text), '(0x[a-fA-F0-9]{40})', 1))[1])
          ELSE NULL
        END
      ) AS mint,
      COALESCE(
        MAX(l.ticker) FILTER (WHERE l.bot_type='rick'),
        MAX(l.ticker) FILTER (WHERE l.bot_type='phanes'),
        -- Extract from trigger text if bot links don't have ticker
        CASE 
          WHEN regexp_matches(MAX(l.trigger_text), '\$\$?([A-Za-z0-9_]{2,20})') THEN
            UPPER((regexp_extract(MAX(l.trigger_text), '\$\$?([A-Za-z0-9_]{2,20})', 1))[1])
          ELSE NULL
        END
      ) AS ticker,
      COALESCE(
        MAX(l.mcap_usd) FILTER (WHERE l.bot_type='rick'),
        MAX(l.mcap_usd) FILTER (WHERE l.bot_type='phanes')
      ) AS mcap_usd,
      COALESCE(
        MAX(l.price_usd) FILTER (WHERE l.bot_type='rick'),
        MAX(l.price_usd) FILTER (WHERE l.bot_type='phanes')
      ) AS price_usd,
      -- Determine token resolution method
      CASE
        -- Mint found in bot reply (for cashtag calls or direct mint calls)
        WHEN MAX(l.mint) FILTER (WHERE l.bot_type='rick') IS NOT NULL 
          OR MAX(l.mint) FILTER (WHERE l.bot_type='phanes') IS NOT NULL THEN
          CASE
            WHEN MAX(l.trigger_text) ~ '\$\$?[A-Za-z0-9_]{2,20}' THEN 'resolved_from_bot_reply'
            ELSE 'direct_mint_in_user_message'
          END
        -- EVM address in user message
        WHEN MAX(l.trigger_text) ~ '0x[a-fA-F0-9]{40}' THEN 'evm_address_in_user_message'
        -- Solana mint in user message
        WHEN MAX(l.trigger_text) ~ '[1-9A-HJ-NP-Za-km-z]{32,44}' THEN 'direct_mint_in_user_message'
        -- No mint found
        ELSE 'unresolved'
      END AS token_resolution_method
    FROM caller_links_d l
    WHERE l.trigger_chat_id = ?
      -- Filter out bot accounts (they can't make calls, only reply)
      AND l.trigger_from_name NOT IN ('Rick', 'Phanes [Gold]', 'Prometheus')
      AND l.trigger_from_id NOT LIKE 'user7774196337'  -- Phanes bot ID
      AND l.trigger_from_id NOT LIKE 'user6126376117'   -- Rick bot ID
    GROUP BY
      l.trigger_chat_id, l.trigger_message_id, l.trigger_ts_ms,
      l.trigger_from_name, l.trigger_from_id, l.trigger_text
    HAVING 
      -- Only include triggers with at least one bot link that has mint or ticker
      -- OR trigger text contains mint/ticker (extracted above)
      MAX(CASE WHEN l.mint IS NOT NULL OR l.ticker IS NOT NULL THEN 1 ELSE 0 END) = 1
      OR MAX(l.trigger_text) IS NOT NULL
  """, [chat_id])
  
  # Now filter to only first call per caller per mint
  # Use ROW_NUMBER to handle cases where same caller calls same mint at same timestamp
  result = con.execute("""
    INSERT OR IGNORE INTO user_calls_d
    SELECT
      chat_id,
      message_id,
      call_ts_ms,
      call_datetime,
      caller_name,
      caller_id,
      trigger_text,
      bot_reply_id_1,
      bot_reply_id_2,
      mint,
      ticker,
      mcap_usd,
      price_usd,
      FALSE AS first_caller,
      token_resolution_method,
      ? AS run_id,
      CURRENT_TIMESTAMP AS inserted_at
    FROM (
      SELECT
        t.*,
        ROW_NUMBER() OVER (
          PARTITION BY t.caller_id, COALESCE(t.mint, t.ticker, CAST(t.message_id AS TEXT))
          ORDER BY 
            -- Prefer triggers with both bots (Rick + Phanes)
            CASE WHEN t.bot_reply_id_1 IS NOT NULL AND t.bot_reply_id_2 IS NOT NULL THEN 0 ELSE 1 END,
            t.call_ts_ms ASC, 
            t.message_id ASC
        ) AS rn
      FROM temp_user_calls t
    ) ranked
    WHERE rn = 1
  """, [run_id])
  
  # Get row count for user_calls_d
  user_calls_count = con.execute("""
    SELECT COUNT(*) FROM user_calls_d WHERE chat_id = ? AND run_id = ?
  """, [chat_id, run_id]).fetchone()[0]
  row_counts['user_calls'] = user_calls_count
  
  con.execute("DROP TABLE IF EXISTS temp_user_calls")

  # mark first_caller per mint (first caller overall, not per caller)
  # Only update for this run_id
  con.execute("""
    UPDATE user_calls_d
    SET first_caller = FALSE
    WHERE chat_id = ? AND run_id = ?
  """, [chat_id, run_id])
  con.execute("""
    UPDATE user_calls_d u
    SET first_caller = TRUE
    FROM (
      SELECT mint, MIN(call_ts_ms) AS first_ts
      FROM user_calls_d
      WHERE chat_id = ? AND run_id = ? AND mint IS NOT NULL
      GROUP BY mint
    ) f
    WHERE u.chat_id = ?
      AND u.run_id = ?
      AND u.mint = f.mint
      AND u.call_ts_ms = f.first_ts
  """, [chat_id, run_id, chat_id, run_id])

  # --- time views (the "time setup" you asked for) ---
  con.execute(f"""
    CREATE OR REPLACE VIEW v_user_calls_time_d AS
    SELECT
      *,
      -- handy for display (datetime without timezone)
      strftime(call_datetime, '%Y-%m-%d %H:%M:%S') AS call_dt
    FROM user_calls_d
    WHERE chat_id = '{chat_id}';
  """)
  
  # --- create v_alerts_summary_d first (used by other views) ---
  con.execute(f"""
    CREATE OR REPLACE VIEW v_alerts_summary_d AS
    SELECT
      trigger_from_name AS caller_name,
      mint,
      ticker,
      mcap_usd AS mcap_at_alert,
      trigger_ts_ms AS alert_ts_ms,
      to_timestamp(trigger_ts_ms/1000.0) AS alert_datetime,
      strftime(to_timestamp(trigger_ts_ms/1000.0), '%Y-%m-%d %H:%M:%S') AS alert_dt,
      price_usd AS price_at_alert,
      chain,
      trigger_chat_id AS chat_id,
      trigger_message_id AS message_id,
      trigger_from_id AS caller_id,
      -- pick best bot reply (prefer phanes, fallback to rick)
      COALESCE(
        MAX(bot_message_id) FILTER (WHERE bot_type = 'phanes'),
        MAX(bot_message_id) FILTER (WHERE bot_type = 'rick')
      ) AS bot_reply_id,
      COALESCE(
        MAX(bot_type) FILTER (WHERE bot_type = 'phanes'),
        MAX(bot_type) FILTER (WHERE bot_type = 'rick')
      ) AS bot_type_used
    FROM caller_links_d
    WHERE trigger_chat_id = '{chat_id}'
      AND mint IS NOT NULL
    GROUP BY
      trigger_chat_id, trigger_message_id, trigger_ts_ms,
      trigger_from_name, trigger_from_id, mint, ticker, mcap_usd, price_usd, chain;
  """)
  
  # --- data quality views ---
  # Alerts missing mint (unrecoverable - can't look up token without mint)
  con.execute(f"""
    CREATE OR REPLACE VIEW v_alerts_missing_mint AS
    SELECT
      *
    FROM v_alerts_summary_d
    WHERE mint IS NULL
    ORDER BY alert_ts_ms DESC;
  """)
  
  # Alerts missing ticker but have mint (recoverable - can look up ticker from mint)
  con.execute(f"""
    CREATE OR REPLACE VIEW v_alerts_missing_ticker AS
    SELECT
      *
    FROM v_alerts_summary_d
    WHERE mint IS NOT NULL AND ticker IS NULL
    ORDER BY alert_ts_ms DESC;
  """)
  
  # Legacy view for backward compatibility (union of both)
  con.execute(f"""
    CREATE OR REPLACE VIEW v_incomplete_alerts AS
    SELECT * FROM v_alerts_missing_mint
    UNION ALL
    SELECT * FROM v_alerts_missing_ticker
    ORDER BY alert_ts_ms DESC;
  """)
  
  con.execute(f"""
    CREATE OR REPLACE VIEW v_alerts_missing_metrics AS
    SELECT
      *
    FROM v_alerts_summary_d
    WHERE mcap_at_alert IS NULL OR price_at_alert IS NULL
    ORDER BY alert_ts_ms DESC;
  """)
  
  con.execute(f"""
    CREATE OR REPLACE VIEW v_data_quality_summary AS
    SELECT
      COUNT(*) AS total_alerts,
      COUNT(mint) AS alerts_with_mint,
      COUNT(ticker) AS alerts_with_ticker,
      COUNT(mcap_at_alert) AS alerts_with_mcap,
      COUNT(price_at_alert) AS alerts_with_price,
      COUNT(chain) AS alerts_with_chain,
      ROUND(COUNT(mint) * 100.0 / COUNT(*), 1) AS pct_with_mint,
      ROUND(COUNT(ticker) * 100.0 / COUNT(*), 1) AS pct_with_ticker,
      ROUND(COUNT(mcap_at_alert) * 100.0 / COUNT(*), 1) AS pct_with_mcap,
      ROUND(COUNT(price_at_alert) * 100.0 / COUNT(*), 1) AS pct_with_price,
      ROUND(COUNT(chain) * 100.0 / COUNT(*), 1) AS pct_with_chain,
      (SELECT COUNT(*) FROM v_alerts_missing_mint) AS missing_mint_count,
      (SELECT COUNT(*) FROM v_alerts_missing_ticker) AS missing_ticker_count,
      ROUND((SELECT COUNT(*) FROM v_alerts_missing_mint) * 100.0 / COUNT(*), 1) AS pct_missing_mint,
      ROUND((SELECT COUNT(*) FROM v_alerts_missing_ticker) * 100.0 / COUNT(*), 1) AS pct_missing_ticker
    FROM v_alerts_summary_d;
  """)
  
  con.execute(f"""
    CREATE OR REPLACE VIEW v_fallback_parser_stats AS
    SELECT
      bot_type_used,
      COUNT(*) AS count,
      COUNT(mint) AS with_mint,
      COUNT(ticker) AS with_ticker,
      COUNT(mcap_at_alert) AS with_mcap,
      COUNT(price_at_alert) AS with_price,
      COUNT(chain) AS with_chain
    FROM v_alerts_summary_d
    GROUP BY bot_type_used
    ORDER BY count DESC;
  """)
  
  # Zero liquidity alerts (from caller_links_d with full details)
  con.execute(f"""
    CREATE OR REPLACE VIEW v_zero_liquidity_alerts AS
    SELECT
      l.trigger_chat_id AS chat_id,
      l.trigger_message_id AS message_id,
      l.trigger_ts_ms AS alert_ts_ms,
      to_timestamp(l.trigger_ts_ms/1000.0) AS alert_datetime,
      strftime(to_timestamp(l.trigger_ts_ms/1000.0), '%Y-%m-%d %H:%M:%S') AS alert_dt,
      l.trigger_from_name AS caller_name,
      l.trigger_from_id AS caller_id,
      l.mint,
      l.ticker,
      l.mcap_usd AS mcap_at_alert,
      l.price_usd AS price_at_alert,
      l.liquidity_usd,
      l.zero_liquidity,
      l.chain,
      l.bot_type,
      l.mint_validation_status
    FROM caller_links_d l
    WHERE l.trigger_chat_id = '{chat_id}'
      AND l.zero_liquidity = TRUE
      AND l.mint IS NOT NULL
    ORDER BY l.trigger_ts_ms DESC;
  """)
  
  # Mint validation status summary
  con.execute(f"""
    CREATE OR REPLACE VIEW v_mint_validation_summary AS
    SELECT
      mint_validation_status,
      COUNT(*) AS count,
      COUNT(DISTINCT mint) AS unique_mints,
      COUNT(CASE WHEN zero_liquidity = TRUE THEN 1 END) AS zero_liq_count
    FROM caller_links_d
    WHERE trigger_chat_id = '{chat_id}'
      AND mint IS NOT NULL
    GROUP BY mint_validation_status
    ORDER BY count DESC;
  """)

  con.execute(f"""
    CREATE OR REPLACE VIEW v_caller_links_time_d AS
    SELECT
      *,
      to_timestamp(bot_ts_ms/1000.0) AS bot_dt,
      to_timestamp(trigger_ts_ms/1000.0) AS trigger_dt,
      strftime(to_timestamp(trigger_ts_ms/1000.0), '%Y-%m-%d %H:%M:%S') AS trigger_dt_str,
      CASE
        WHEN token_created_ts_ms IS NOT NULL THEN to_timestamp(token_created_ts_ms/1000.0)
        ELSE NULL
      END AS token_created_dt,
      (bot_ts_ms - trigger_ts_ms) / 1000.0 AS reply_delay_s
    FROM caller_links_d
    WHERE trigger_chat_id = '{chat_id}';
  """)

  # --- v_alerts_summary_d already created above ---

  # --- optional comparison against SQLite tele.db ---
  if args.sqlite:
    con.execute("INSTALL sqlite;")
    con.execute("LOAD sqlite;")
    # Summary counts
    summary = con.execute("""
      WITH s AS (
        SELECT COUNT(*) AS sqlite_calls
        FROM sqlite_scan(?, 'user_calls')
        WHERE chat_id = ?
      ),
      d AS (
        SELECT COUNT(*) AS duck_calls
        FROM user_calls_d
        WHERE chat_id = ?
      )
      SELECT * FROM s CROSS JOIN d
    """, [args.sqlite, chat_id, chat_id]).fetchone()

    # Mismatch report (ids + core fields)
    mismatches = con.execute("""
      WITH s AS (
        SELECT
          chat_id,
          message_id,
          bot_reply_id_1,
          bot_reply_id_2,
          mint,
          UPPER(ticker) AS ticker,
          mcap_usd,
          price_usd
        FROM sqlite_scan(?, 'user_calls')
        WHERE chat_id = ?
      ),
      d AS (
        SELECT
          chat_id,
          message_id,
          bot_reply_id_1,
          bot_reply_id_2,
          mint,
          UPPER(ticker) AS ticker,
          mcap_usd,
          price_usd
        FROM user_calls_d
        WHERE chat_id = ?
      )
      SELECT
        COALESCE(s.message_id, d.message_id) AS message_id,
        s.bot_reply_id_1 AS sqlite_rick,
        d.bot_reply_id_1 AS duck_rick,
        s.bot_reply_id_2 AS sqlite_phanes,
        d.bot_reply_id_2 AS duck_phanes,
        s.mint AS sqlite_mint,
        d.mint AS duck_mint,
        s.ticker AS sqlite_ticker,
        d.ticker AS duck_ticker,
        s.mcap_usd AS sqlite_mcap,
        d.mcap_usd AS duck_mcap,
        s.price_usd AS sqlite_price,
        d.price_usd AS duck_price
      FROM s
      FULL OUTER JOIN d USING (chat_id, message_id)
      WHERE
        s.message_id IS NULL OR d.message_id IS NULL
        OR COALESCE(s.bot_reply_id_1, -1) != COALESCE(d.bot_reply_id_1, -1)
        OR COALESCE(s.bot_reply_id_2, -1) != COALESCE(d.bot_reply_id_2, -1)
        OR COALESCE(s.mint, '') != COALESCE(d.mint, '')
        OR COALESCE(s.ticker, '') != COALESCE(d.ticker, '')
        OR (s.mcap_usd IS NOT NULL AND d.mcap_usd IS NOT NULL AND abs(s.mcap_usd - d.mcap_usd) > 1e-6)
        OR (s.price_usd IS NOT NULL AND d.price_usd IS NOT NULL AND abs(s.price_usd - d.price_usd) > 1e-12)
      ORDER BY message_id
      LIMIT 200
    """, [args.sqlite, chat_id, chat_id]).fetchall()

    print(json.dumps({
      "chat_id": chat_id,
      "chat_name": chat_name,
      "duckdb_file": args.duckdb,
      "sqlite_file": args.sqlite,
      "counts": {"sqlite_user_calls": int(summary[0]), "duck_user_calls": int(summary[1])},
      "mismatch_rows_sample": len(mismatches)
    }, indent=2))

    if mismatches:
      print("\n--- mismatch sample (first 20) ---")
      for row in mismatches[:20]:
        print(row)

  else:
    # Get final row counts for this run
    tg_rows = con.execute("SELECT COUNT(*) FROM tg_norm_d WHERE chat_id=? AND run_id=?", [chat_id, run_id]).fetchone()[0]
    caller_links_rows = con.execute("SELECT COUNT(*) FROM caller_links_d WHERE trigger_chat_id=? AND run_id=?", [chat_id, run_id]).fetchone()[0]
    user_calls_rows = con.execute("SELECT COUNT(*) FROM user_calls_d WHERE chat_id=? AND run_id=?", [chat_id, run_id]).fetchone()[0]
    
    # Update row counts
    row_counts['tg_norm'] = tg_rows
    row_counts['caller_links'] = caller_links_rows
    row_counts['user_calls'] = user_calls_rows
    
    # Mark run as completed
    complete_ingestion_run(con, run_id, row_counts)
    
    print(json.dumps({
      "chat_id": chat_id,
      "chat_name": chat_name,
      "duckdb_file": args.duckdb,
      "run_id": run_id,
      "script_version": script_version,
      "tg_rows": tg_rows,
      "caller_links_rows": caller_links_rows,
      "user_calls_rows": user_calls_rows,
    }, indent=2))

  # --- export to CSV/Parquet if requested ---
  if args.export_csv:
    con.execute(f"""
      COPY (
        SELECT * FROM v_alerts_summary_d
        WHERE chat_id = '{chat_id}'
        ORDER BY alert_ts_ms DESC
      ) TO '{args.export_csv}' (FORMAT CSV, HEADER, DELIMITER ',')
    """)
    print(f"\nExported alerts to CSV: {args.export_csv}")

  if args.export_parquet:
    con.execute(f"""
      COPY (
        SELECT * FROM v_alerts_summary_d
        WHERE chat_id = '{chat_id}'
        ORDER BY alert_ts_ms DESC
      ) TO '{args.export_parquet}' (FORMAT PARQUET)
    """)
    print(f"Exported alerts to Parquet: {args.export_parquet}")

  # Export user_calls_d and caller_links_d to Parquet with run ID
  if args.export_parquet_run:
    if not args.run_id:
      print("Error: --run-id is required with --export-parquet-run")
      con.close()
      return
    
    import os
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)
    
    # Export user_calls_d
    user_calls_path = os.path.join(output_dir, f"{args.run_id}_user_calls.parquet")
    user_calls_count = con.execute("SELECT COUNT(*) FROM user_calls_d").fetchone()[0]
    con.execute(f"""
      COPY (
        SELECT * FROM user_calls_d
        ORDER BY call_ts_ms DESC
      ) TO '{user_calls_path}' (FORMAT PARQUET)
    """)
    print(f"Exported {user_calls_count} rows from user_calls_d to {user_calls_path}")
    
    # Export caller_links_d
    caller_links_path = os.path.join(output_dir, f"{args.run_id}_caller_links.parquet")
    caller_links_count = con.execute("SELECT COUNT(*) FROM caller_links_d").fetchone()[0]
    con.execute(f"""
      COPY (
        SELECT * FROM caller_links_d
        ORDER BY bot_ts_ms DESC
      ) TO '{caller_links_path}' (FORMAT PARQUET)
    """)
    print(f"Exported {caller_links_count} rows from caller_links_d to {caller_links_path}")
    
    # Validate row counts
    import pyarrow.parquet as pq
    user_calls_parquet_count = len(pq.read_table(user_calls_path))
    caller_links_parquet_count = len(pq.read_table(caller_links_path))
    
    if user_calls_parquet_count != user_calls_count:
      print(f"WARNING: user_calls_d row count mismatch: DuckDB={user_calls_count}, Parquet={user_calls_parquet_count}")
    else:
      print(f"✓ user_calls_d row count validated: {user_calls_count}")
    
    if caller_links_parquet_count != caller_links_count:
      print(f"WARNING: caller_links_d row count mismatch: DuckDB={caller_links_count}, Parquet={caller_links_parquet_count}")
    else:
      print(f"✓ caller_links_d row count validated: {caller_links_count}")

  # Mark run as completed (if not already done above)
  if run_id:
    complete_ingestion_run(con, run_id, row_counts)

  con.close()

if __name__ == "__main__":
  import sys
  run_id_for_error = None
  try:
    main()
  except Exception as e:
    # Try to mark run as failed
    # We need to get run_id from the database if possible
    try:
      # This is a best-effort attempt - if we can't get run_id, that's OK
      # The error will still propagate and be logged
      import duckdb
      # Try to get the most recent running run for this chat
      # This is a fallback - ideally run_id would be in a global or passed differently
      pass  # Skip for now - too complex to get run_id here without refactoring
    except Exception:
      pass
    
    print(f"Error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)

