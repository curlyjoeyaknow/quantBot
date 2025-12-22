"""
Regression Tests for Chain Normalization in OHLCV Worklist

CRITICAL: These tests prevent regression of bugs that were fixed:
1. BNB chain normalization bug - BNB must be normalized to bsc (not default to solana)
"""

import pytest
import sys
from pathlib import Path

# Add parent directory to path to import the module
sys.path.insert(0, str(Path(__file__).parent.parent))

from ohlcv_worklist import normalize_chain


class TestChainNormalizationRegression:
    """Regression tests for chain normalization bug fixes."""

    def test_critical_bnb_normalizes_to_bsc_not_solana(self):
        """
        CRITICAL: This test would have caught the original bug.
        
        The original bug defaulted 'BNB' to 'solana' because it wasn't in the chain_map.
        This caused EVM tokens on BSC to be misidentified as Solana tokens, leading to
        "No candles returned" errors.
        
        If this test fails, it means BNB is defaulting to solana again, which will
        cause chain detection failures for BSC tokens.
        """
        # Test various BNB representations
        assert normalize_chain('BNB') == 'bsc', "BNB (uppercase) should normalize to bsc"
        assert normalize_chain('bnb') == 'bsc', "bnb (lowercase) should normalize to bsc"
        assert normalize_chain('Bnb') == 'bsc', "Bnb (mixed case) should normalize to bsc"
        assert normalize_chain(' BNB ') == 'bsc', "BNB (with whitespace) should normalize to bsc"

    def test_critical_bsc_normalizes_correctly(self):
        """
        CRITICAL: Ensures BSC normalizes correctly (not affected by BNB fix).
        """
        assert normalize_chain('BSC') == 'bsc'
        assert normalize_chain('bsc') == 'bsc'
        assert normalize_chain('Bsc') == 'bsc'

    def test_critical_ethereum_normalizes_correctly(self):
        """
        CRITICAL: Ensures Ethereum normalizes correctly.
        """
        assert normalize_chain('Ethereum') == 'ethereum'
        assert normalize_chain('ethereum') == 'ethereum'
        assert normalize_chain('ETH') == 'ethereum'
        assert normalize_chain('eth') == 'ethereum'

    def test_critical_solana_normalizes_correctly(self):
        """
        CRITICAL: Ensures Solana normalizes correctly.
        """
        assert normalize_chain('Solana') == 'solana'
        assert normalize_chain('solana') == 'solana'
        assert normalize_chain('SOL') == 'solana'
        assert normalize_chain('sol') == 'solana'

    def test_critical_unknown_chains_default_to_solana(self):
        """
        CRITICAL: Ensures unknown chains default to solana (existing behavior preserved).
        """
        assert normalize_chain('unknown_chain') == 'solana'
        assert normalize_chain('') == 'solana'
        assert normalize_chain(None) == 'solana'

    def test_critical_base_normalizes_correctly(self):
        """
        CRITICAL: Ensures Base chain normalizes correctly.
        """
        assert normalize_chain('Base') == 'base'
        assert normalize_chain('base') == 'base'
        assert normalize_chain('BASE') == 'base'

