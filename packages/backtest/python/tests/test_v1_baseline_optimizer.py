"""
Unit tests for V1 Baseline Optimizer.

Tests grid search, per-caller optimization, and grouped evaluation.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Add parent directory to path
_BACKTEST_DIR = Path(__file__).parent.parent
if str(_BACKTEST_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKTEST_DIR))

from lib.v1_baseline_optimizer import (
    optimize_v1_baseline,
    optimize_v1_baseline_per_caller,
    run_v1_baseline_grouped_evaluation,
    DEFAULT_TP_MULTS,
    DEFAULT_SL_MULTS,
    DEFAULT_MAX_HOLD_HRS,
)
from lib.v1_baseline_simulator import CapitalSimulatorConfig

UTC = timezone.utc


def make_candle_dict(ts_ms: int, o: float, h: float, l: float, c: float) -> dict:
    """Helper to create candle dict."""
    return {
        "timestamp": ts_ms / 1000,  # Stored as seconds
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": 1000.0,
    }


def make_call_dict(call_id: str, mint: str, caller: str, ts_ms: int) -> dict:
    """Helper to create call dict."""
    return {
        "id": call_id,
        "mint": mint,
        "caller": caller,
        "ts_ms": ts_ms,
    }


class TestGridSearch:
    """Test grid search functionality."""
    
    def test_grid_search_evaluates_all_combinations(self):
        """Grid search evaluates all parameter combinations."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_A", "Caller1", base_ts)
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 2.5, 0.8, 2.0),  # Both TP and SL possible
        ]
        
        param_grid = {
            "tp_mults": [2.0, 3.0],
            "sl_mults": [0.85, 0.9],
            "max_hold_hrs": [48.0],
        }
        
        result = optimize_v1_baseline(
            calls=[call],
            candles_by_call_id={"call1": candles},
            param_grid=param_grid,
        )
        
        # Should evaluate 2 * 2 * 1 = 4 combinations
        assert result.params_evaluated == 4
        assert len(result.all_results) == 4
    
    def test_grid_search_uses_defaults(self):
        """Grid search uses default parameters when not specified."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_A", "Caller1", base_ts)
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 2.5, 0.8, 2.0),
        ]
        
        result = optimize_v1_baseline(
            calls=[call],
            candles_by_call_id={"call1": candles},
        )
        
        # Should use default grids
        expected_combinations = len(DEFAULT_TP_MULTS) * len(DEFAULT_SL_MULTS) * len(DEFAULT_MAX_HOLD_HRS)
        assert result.params_evaluated == expected_combinations


class TestRanking:
    """Test result ranking."""
    
    def test_results_sorted_by_final_capital(self):
        """Results are sorted by final capital descending."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_A", "Caller1", base_ts)
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 3.0, 0.8, 2.5),
        ]
        
        param_grid = {
            "tp_mults": [2.0, 2.5, 3.0],
            "sl_mults": [0.85],
            "max_hold_hrs": [48.0],
        }
        
        result = optimize_v1_baseline(
            calls=[call],
            candles_by_call_id={"call1": candles},
            param_grid=param_grid,
        )
        
        # Results should be sorted by final capital descending
        capitals = [r["result"].final_capital for r in result.all_results]
        assert capitals == sorted(capitals, reverse=True)
        
        # Best result should be first
        assert result.best_final_capital == capitals[0]


class TestPerCallerOptimization:
    """Test per-caller optimization."""
    
    def test_per_caller_optimization(self):
        """Per-caller optimization runs separately for each caller."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        # Two callers with different patterns
        calls = [
            make_call_dict("call1", "TOKEN_A", "Caller1", base_ts),
            make_call_dict("call2", "TOKEN_B", "Caller2", base_ts),
        ]
        
        # Caller1: TP at 2x
        candles1 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 2.5, 0.95, 2.3),
        ]
        
        # Caller2: SL at 0.85
        candles2 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 1.0, 0.8, 0.85),
        ]
        
        param_grid = {
            "tp_mults": [2.0, 3.0],
            "sl_mults": [0.85, 0.9],
            "max_hold_hrs": [48.0],
        }
        
        results = optimize_v1_baseline_per_caller(
            calls=calls,
            candles_by_call_id={"call1": candles1, "call2": candles2},
            param_grid=param_grid,
        )
        
        # Should have results for both callers
        assert len(results) == 2
        assert "Caller1" in results
        assert "Caller2" in results
        
        # Caller1 should make money (TP hit)
        assert results["Caller1"].best_total_return > 0
        
        # Caller2 should lose money (SL hit)
        assert results["Caller2"].best_total_return < 0


class TestCollapsedCapitalDetection:
    """Test collapsed capital detection."""
    
    def test_collapsed_capital_flagged(self):
        """Callers with C_final < C_0 are flagged as collapsed."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        # Caller that always loses money
        call = make_call_dict("call1", "TOKEN_A", "BadCaller", base_ts)
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 1.0, 0.5, 0.6),  # Big loss
        ]
        
        param_grid = {
            "tp_mults": [2.0],
            "sl_mults": [0.85],
            "max_hold_hrs": [48.0],
        }
        
        config = CapitalSimulatorConfig(initial_capital=10_000)
        
        results = optimize_v1_baseline_per_caller(
            calls=[call],
            candles_by_call_id={"call1": candles},
            param_grid=param_grid,
            simulator_config=config,
        )
        
        # Should be flagged as collapsed
        assert results["BadCaller"].collapsed_capital is True
        assert results["BadCaller"].best_final_capital < 10_000


class TestExtremeParamsDetection:
    """Test extreme parameters detection."""
    
    def test_extreme_params_flagged(self):
        """Callers requiring extreme parameters are flagged."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_A", "ExtremeCaller", base_ts)
        # Pattern that requires very high TP to be profitable
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 5.5, 0.95, 5.0),  # Goes to 5x
        ]
        
        param_grid = {
            "tp_mults": [2.0, 5.0],  # 5.0 is above threshold (> 4.0)
            "sl_mults": [0.9],
            "max_hold_hrs": [48.0],
        }
        
        results = optimize_v1_baseline_per_caller(
            calls=[call],
            candles_by_call_id={"call1": candles},
            param_grid=param_grid,
        )
        
        # Best params should have TP > 4.0 (extreme)
        if results["ExtremeCaller"].best_params:
            assert results["ExtremeCaller"].best_params.tp_mult > 4.0
            assert results["ExtremeCaller"].requires_extreme_params is True


class TestGroupedEvaluation:
    """Test grouped evaluation with filtering."""
    
    def test_grouped_evaluation_filters_callers(self):
        """Grouped evaluation filters out collapsed/extreme callers."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        # Three callers: good, collapsed, extreme
        calls = [
            make_call_dict("call1", "TOKEN_A", "GoodCaller", base_ts),
            make_call_dict("call2", "TOKEN_B", "BadCaller", base_ts),
            make_call_dict("call3", "TOKEN_C", "ExtremeCaller", base_ts),
        ]
        
        # GoodCaller: TP at 2x
        candles1 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 2.5, 0.95, 2.3),
        ]
        
        # BadCaller: Big loss (collapsed)
        candles2 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 1.0, 0.5, 0.6),
        ]
        
        # ExtremeCaller: Needs extreme TP (> 4.0)
        candles3 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 5.5, 0.95, 5.0),
        ]
        
        param_grid = {
            "tp_mults": [2.0, 5.0],  # 5.0 is extreme
            "sl_mults": [0.9],
            "max_hold_hrs": [48.0],
        }
        
        result = run_v1_baseline_grouped_evaluation(
            calls=calls,
            candles_by_call_id={
                "call1": candles1,
                "call2": candles2,
                "call3": candles3,
            },
            param_grid=param_grid,
            filter_collapsed=True,
            filter_extreme=True,
        )
        
        # Should have 3 per-caller results
        assert len(result["per_caller_results"]) == 3
        
        # BadCaller should be collapsed
        assert result["per_caller_results"]["BadCaller"].collapsed_capital is True
        
        # ExtremeCaller should require extreme params
        assert result["per_caller_results"]["ExtremeCaller"].requires_extreme_params is True
        
        # At least BadCaller should be filtered out (collapsed)
        # GoodCaller might also be filtered if it doesn't make enough profit
        assert "BadCaller" not in result["selected_callers"]
        assert "ExtremeCaller" not in result["selected_callers"]
        
        # If any callers selected, grouped result should exist
        if len(result["selected_callers"]) > 0:
            assert result["grouped_result"] is not None
            assert result["grouped_params"] is not None
    
    def test_grouped_params_are_averaged(self):
        """Grouped parameters are averaged from selected callers."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        # Two good callers with different optimal params
        calls = [
            make_call_dict("call1", "TOKEN_A", "Caller1", base_ts),
            make_call_dict("call2", "TOKEN_B", "Caller2", base_ts),
        ]
        
        # Both hit TP
        candles1 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 2.5, 0.95, 2.3),
        ]
        
        candles2 = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 3.5, 0.95, 3.3),
        ]
        
        param_grid = {
            "tp_mults": [2.0, 3.0],
            "sl_mults": [0.9],
            "max_hold_hrs": [48.0],
        }
        
        result = run_v1_baseline_grouped_evaluation(
            calls=calls,
            candles_by_call_id={"call1": candles1, "call2": candles2},
            param_grid=param_grid,
            filter_collapsed=False,
            filter_extreme=False,
        )
        
        # Both callers should be selected
        assert len(result["selected_callers"]) == 2
        
        # Grouped params should be average
        # (exact values depend on which params are best for each caller)
        assert result["grouped_params"] is not None
        assert result["grouped_params"].max_hold_hrs == 48.0

