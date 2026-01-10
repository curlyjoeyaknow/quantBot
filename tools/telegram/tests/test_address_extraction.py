"""
Pytest tests for address extraction and validation.

Data-driven tests using fixtures/telegram_cases.json
"""

import pytest
from address_validation import extract_addresses, find_address_candidates


@pytest.mark.unit
def test_extract_addresses_from_cases(telegram_cases):
    """Test address extraction against fixture cases"""
    for case in telegram_cases:
        result = extract_addresses(case["text"])
        
        # Check Solana mints
        assert result["solana_mints"] == case["expected"]["solana_mints"], \
            f"Solana mints mismatch for case '{case['name']}'"
        
        # Check EVM addresses (normalize to lowercase for comparison)
        expected_evm = [addr.lower() for addr in case["expected"]["evm"]]
        actual_evm = [addr.lower() for addr in result["evm"]]
        assert actual_evm == expected_evm, \
            f"EVM addresses mismatch for case '{case['name']}'"
    """Test address extraction against fixture cases"""
    result = extract_addresses(case["text"])
    
    # Check Solana mints
    assert result["solana_mints"] == case["expected"]["solana_mints"], \
        f"Solana mints mismatch for case '{case['name']}'"
    
    # Check EVM addresses (normalize to lowercase for comparison)
    expected_evm = [addr.lower() for addr in case["expected"]["evm"]]
    actual_evm = [addr.lower() for addr in result["evm"]]
    assert actual_evm == expected_evm, \
        f"EVM addresses mismatch for case '{case['name']}'"


@pytest.mark.unit
def test_punctuation_stripping():
    """Test that punctuation is stripped from addresses"""
    test_cases = [
        ("(So11111111111111111111111111111111111111112)", "So11111111111111111111111111111111111111112"),
        ("[So11111111111111111111111111111111111111112]", "So11111111111111111111111111111111111111112"),
        ("So11111111111111111111111111111111111111112,", "So11111111111111111111111111111111111111112"),
        ("(0x742d35cc6634c0532925a3b844bc9e7595f0beb0)", "0x742d35cc6634c0532925a3b844bc9e7595f0beb0"),
    ]
    
    for text, expected in test_cases:
        result = extract_addresses(text)
        if expected.startswith("0x"):
            assert expected.lower() in [addr.lower() for addr in result["evm"]]
        else:
            assert expected in result["solana_mints"]


@pytest.mark.unit
def test_deduplication():
    """Test that duplicate addresses in same message are deduplicated"""
    text = """
        CA: So11111111111111111111111111111111111111112
        Same CA: So11111111111111111111111111111111111111112
        Again: So11111111111111111111111111111111111111112
    """
    result = extract_addresses(text)
    
    # Should only have one unique address
    assert len(result["solana_mints"]) == 1
    assert result["solana_mints"][0] == "So11111111111111111111111111111111111111112"


@pytest.mark.unit
def test_zero_address_rejection():
    """Test that zero address is rejected"""
    text = "0x0000000000000000000000000000000000000000"
    result = extract_addresses(text)
    assert len(result["evm"]) == 0


@pytest.mark.unit
def test_invalid_base58_rejection():
    """Test that addresses with invalid base58 chars are rejected"""
    text = "So1111111111111111111111111111111111111111O"  # Contains O (invalid)
    result = extract_addresses(text)
    assert len(result["solana_mints"]) == 0


@pytest.mark.unit
def test_case_preservation_solana():
    """Test that Solana addresses preserve case"""
    text = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  # Mixed case
    result = extract_addresses(text)
    assert len(result["solana_mints"]) > 0
    # Should preserve exact case
    assert result["solana_mints"][0] == "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"


@pytest.mark.unit
def test_find_address_candidates_structure():
    """Test that find_address_candidates returns proper structure"""
    text = "So11111111111111111111111111111111111111112"
    candidates = find_address_candidates(text)
    
    assert len(candidates) > 0
    candidate = candidates[0]
    assert hasattr(candidate, "raw")
    assert hasattr(candidate, "normalized")
    assert hasattr(candidate, "address_type")
    assert hasattr(candidate, "status")
    assert candidate.address_type in ["solana", "evm"]

