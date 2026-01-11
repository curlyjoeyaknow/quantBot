#!/usr/bin/env python3
"""
Golden path tests for phased stop simulator EV calculations.

These tests use synthetic candle data with known outcomes to verify:
1. Exit multiple tracking (entry_mult, peak_mult, exit_mult)
2. Cohort classification (winners, losers, never_2x)
3. EV calculations (ev_pct_from_entry, ev_pct_given_2x)
4. Giveback calculations
"""

import sys
from pathlib import Path
from typing import List, Dict

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from phased_stop_simulator import (
    simulate_phased_trade,
    aggregate_performance,
    PhasedTradeResult,
)


def create_candles(price_path: List[float], start_ts_ms: int = 1000000000000) -> List[Dict]:
    """Create synthetic candles from a price path."""
    candles = []
    for i, price in enumerate(price_path):
        ts_ms = start_ts_ms + (i * 60 * 1000)  # 1 minute intervals
        candles.append({
            'timestamp': ts_ms,
            'open': price,
            'high': price,
            'low': price,
            'close': price,
            'volume': 1000.0,
        })
    return candles


def test_winner_3x_no_giveback():
    """
    Golden path: Winner that hits 3x and exits at peak (no giveback).
    
    Price path: 1.0 → 2.0 → 3.0 (end of data)
    Expected:
    - entry_mult = 1.0
    - peak_mult = 3.0
    - exit_mult = 3.0
    - giveback = 0%
    - hit_2x = True, hit_3x = True
    - exit_reason = "end_of_data"
    """
    print("\n=== Test: Winner 3x No Giveback ===")
    
    entry_price = 1.0
    entry_ts_ms = 1000000000000
    price_path = [1.0, 1.5, 2.0, 2.5, 3.0]
    candles = create_candles(price_path, entry_ts_ms)
    
    exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x, ath_multiple, phase2_entry_price, phase2_entry_ts_ms = simulate_phased_trade(
        candles,
        entry_price,
        entry_ts_ms,
        stop_mode="trailing",
        phase1_stop_pct=0.20,
        phase2_stop_pct=0.20,
        ladder_steps=0.5,
    )
    
    # Calculate metrics
    peak_mult = ath_multiple
    exit_mult = exit_price / entry_price
    giveback_pct = ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0
    
    print(f"Entry price: {entry_price}")
    print(f"Exit price: {exit_price}")
    print(f"Peak mult: {peak_mult:.2f}x")
    print(f"Exit mult: {exit_mult:.2f}x")
    print(f"Giveback: {giveback_pct:.1f}%")
    print(f"Hit 2x: {hit_2x}, Hit 3x: {hit_3x}")
    print(f"Exit reason: {exit_reason}")
    
    # Assertions
    assert abs(peak_mult - 3.0) < 0.01, f"Expected peak_mult=3.0, got {peak_mult}"
    assert abs(exit_mult - 3.0) < 0.01, f"Expected exit_mult=3.0, got {exit_mult}"
    assert abs(giveback_pct) < 0.01, f"Expected giveback=0%, got {giveback_pct}%"
    assert hit_2x, "Should hit 2x"
    assert hit_3x, "Should hit 3x"
    assert exit_reason == "end_of_data", f"Expected end_of_data, got {exit_reason}"
    
    print("✓ PASS")


def test_winner_3x_with_giveback():
    """
    Golden path: Winner that hits 3x, peaks at 4x, gives back to 3.2x.
    
    Price path: 1.0 → 2.0 → 3.0 → 4.0 → 3.2 (end)
    Expected:
    - entry_mult = 1.0
    - peak_mult = 4.0
    - exit_mult = 3.2
    - giveback = 20% (0.8 / 4.0)
    - hit_2x = True, hit_3x = True, hit_4x = True
    """
    print("\n=== Test: Winner 3x With Giveback ===")
    
    entry_price = 1.0
    entry_ts_ms = 1000000000000
    price_path = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 3.8, 3.5, 3.2]
    candles = create_candles(price_path, entry_ts_ms)
    
    exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x, ath_multiple, phase2_entry_price, phase2_entry_ts_ms = simulate_phased_trade(
        candles,
        entry_price,
        entry_ts_ms,
        stop_mode="trailing",
        phase1_stop_pct=0.20,
        phase2_stop_pct=0.20,
        ladder_steps=0.5,
    )
    
    peak_mult = ath_multiple
    exit_mult = exit_price / entry_price
    giveback_pct = ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0
    
    print(f"Entry price: {entry_price}")
    print(f"Exit price: {exit_price}")
    print(f"Peak mult: {peak_mult:.2f}x")
    print(f"Exit mult: {exit_mult:.2f}x")
    print(f"Giveback: {giveback_pct:.1f}%")
    print(f"Hit 2x: {hit_2x}, Hit 3x: {hit_3x}, Hit 4x: {hit_4x}")
    
    assert abs(peak_mult - 4.0) < 0.01, f"Expected peak_mult=4.0, got {peak_mult}"
    assert abs(exit_mult - 3.2) < 0.01, f"Expected exit_mult=3.2, got {exit_mult}"
    assert abs(giveback_pct - 20.0) < 0.1, f"Expected giveback=20%, got {giveback_pct}%"
    assert hit_2x and hit_3x and hit_4x, "Should hit 2x, 3x, 4x"
    
    print("✓ PASS")


def test_loser_2x_no3x():
    """
    Golden path: Loser that hits 2x but not 3x, exits at 1.6x.
    
    Price path: 1.0 → 2.0 → 1.6 (end)
    Expected:
    - entry_mult = 1.0
    - peak_mult = 2.0
    - exit_mult = 1.6
    - giveback = 20% (0.4 / 2.0)
    - hit_2x = True, hit_3x = False
    """
    print("\n=== Test: Loser 2x No 3x ===")
    
    entry_price = 1.0
    entry_ts_ms = 1000000000000
    price_path = [1.0, 1.5, 2.0, 1.9, 1.8, 1.7, 1.6]
    candles = create_candles(price_path, entry_ts_ms)
    
    exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x, ath_multiple, phase2_entry_price, phase2_entry_ts_ms = simulate_phased_trade(
        candles,
        entry_price,
        entry_ts_ms,
        stop_mode="trailing",
        phase1_stop_pct=0.20,
        phase2_stop_pct=0.20,
        ladder_steps=0.5,
    )
    
    peak_mult = ath_multiple
    exit_mult = exit_price / entry_price
    giveback_pct = ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0
    
    print(f"Entry price: {entry_price}")
    print(f"Exit price: {exit_price}")
    print(f"Peak mult: {peak_mult:.2f}x")
    print(f"Exit mult: {exit_mult:.2f}x")
    print(f"Giveback: {giveback_pct:.1f}%")
    print(f"Hit 2x: {hit_2x}, Hit 3x: {hit_3x}")
    
    assert abs(peak_mult - 2.0) < 0.01, f"Expected peak_mult=2.0, got {peak_mult}"
    assert abs(exit_mult - 1.6) < 0.01, f"Expected exit_mult=1.6, got {exit_mult}"
    assert abs(giveback_pct - 20.0) < 0.1, f"Expected giveback=20%, got {giveback_pct}%"
    assert hit_2x, "Should hit 2x"
    assert not hit_3x, "Should NOT hit 3x"
    
    print("✓ PASS")


def test_never_2x_stopped_phase1():
    """
    Golden path: Never reaches 2x, stopped in phase 1.
    
    Price path: 1.0 → 1.2 → 0.96 (stopped at 20% from entry)
    Expected:
    - entry_mult = 1.0
    - peak_mult = 1.2
    - exit_mult = 0.8 (stopped at 20% loss)
    - hit_2x = False
    - exit_reason = "stopped_phase1"
    """
    print("\n=== Test: Never 2x Stopped Phase1 ===")
    
    entry_price = 1.0
    entry_ts_ms = 1000000000000
    price_path = [1.0, 1.1, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7]
    candles = create_candles(price_path, entry_ts_ms)
    
    exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x, ath_multiple, phase2_entry_price, phase2_entry_ts_ms = simulate_phased_trade(
        candles,
        entry_price,
        entry_ts_ms,
        stop_mode="static",
        phase1_stop_pct=0.20,
        phase2_stop_pct=0.20,
        ladder_steps=0.5,
    )
    
    peak_mult = ath_multiple
    exit_mult = exit_price / entry_price
    
    print(f"Entry price: {entry_price}")
    print(f"Exit price: {exit_price}")
    print(f"Peak mult: {peak_mult:.2f}x")
    print(f"Exit mult: {exit_mult:.2f}x")
    print(f"Hit 2x: {hit_2x}")
    print(f"Exit reason: {exit_reason}")
    
    assert abs(exit_mult - 0.8) < 0.01, f"Expected exit_mult=0.8, got {exit_mult}"
    assert not hit_2x, "Should NOT hit 2x"
    assert exit_reason == "stopped_phase1", f"Expected stopped_phase1, got {exit_reason}"
    
    print("✓ PASS")


def test_aggregate_ev_calculation():
    """
    Golden path: Test aggregate EV calculation with known cohorts.
    
    Create 10 trades:
    - 3 winners (hit 3x): exit at 3.0x, 3.5x, 4.0x → mean = 3.5x
    - 5 losers (2x no 3x): exit at 1.5x, 1.6x, 1.7x, 1.8x, 1.9x → mean = 1.7x
    - 2 never 2x: exit at 0.8x, 0.9x → mean = 0.85x
    
    Expected EV from entry:
    E[exit_mult] = (3×3.5 + 5×1.7 + 2×0.85) / 10 = (10.5 + 8.5 + 1.7) / 10 = 2.07
    EV% = (2.07 - 1.0) × 100 = 107%
    
    Expected EV given 2x:
    E[exit_mult | 2x] = (3×3.5 + 5×1.7) / 8 = (10.5 + 8.5) / 8 = 2.375
    EV% given 2x = (2.375 - 1.0) × 100 = 137.5%
    """
    print("\n=== Test: Aggregate EV Calculation ===")
    
    trades = []
    
    # 3 winners (hit 3x)
    for i, exit_mult in enumerate([3.0, 3.5, 4.0]):
        trades.append(PhasedTradeResult(
            caller="test_caller",
            mint=f"winner_{i}",
            alert_id=i,
            entry_price=1.0,
            entry_ts_ms=1000000000000 + i * 1000,
            exit_price=exit_mult,
            exit_ts_ms=1000000000000 + i * 1000 + 60000,
            exit_reason="end_of_data",
            exit_phase=2,
            multiple_achieved=exit_mult,
            return_pct=(exit_mult - 1.0) * 100,
            hold_time_minutes=1,
            entry_mult=1.0,
            peak_mult=exit_mult,
            exit_mult=exit_mult,
            giveback_from_peak_pct=0.0,
            stop_mode="trailing",
            phase1_stop_pct=0.20,
            phase2_stop_pct=0.20,
            ladder_steps=0.5,
            hit_2x=True,
            hit_3x=True,
            hit_4x=(exit_mult >= 4.0),
            hit_5x=False,
            hit_10x=False,
            ath_multiple=exit_mult,
            phase2_entry_price=2.0,
            phase2_entry_ts_ms=1000000000000 + i * 1000 + 30000,
        ))
    
    # 5 losers (2x but not 3x)
    for i, exit_mult in enumerate([1.5, 1.6, 1.7, 1.8, 1.9]):
        trades.append(PhasedTradeResult(
            caller="test_caller",
            mint=f"loser_{i}",
            alert_id=i + 3,
            entry_price=1.0,
            entry_ts_ms=1000000000000 + (i + 3) * 1000,
            exit_price=exit_mult,
            exit_ts_ms=1000000000000 + (i + 3) * 1000 + 60000,
            exit_reason="end_of_data",
            exit_phase=2,
            multiple_achieved=exit_mult,
            return_pct=(exit_mult - 1.0) * 100,
            hold_time_minutes=1,
            entry_mult=1.0,
            peak_mult=2.0,
            exit_mult=exit_mult,
            giveback_from_peak_pct=((2.0 - exit_mult) / 2.0 * 100),
            stop_mode="trailing",
            phase1_stop_pct=0.20,
            phase2_stop_pct=0.20,
            ladder_steps=0.5,
            hit_2x=True,
            hit_3x=False,
            hit_4x=False,
            hit_5x=False,
            hit_10x=False,
            ath_multiple=2.0,
            phase2_entry_price=2.0,
            phase2_entry_ts_ms=1000000000000 + (i + 3) * 1000 + 30000,
        ))
    
    # 2 never 2x
    for i, exit_mult in enumerate([0.8, 0.9]):
        trades.append(PhasedTradeResult(
            caller="test_caller",
            mint=f"never2x_{i}",
            alert_id=i + 8,
            entry_price=1.0,
            entry_ts_ms=1000000000000 + (i + 8) * 1000,
            exit_price=exit_mult,
            exit_ts_ms=1000000000000 + (i + 8) * 1000 + 60000,
            exit_reason="stopped_phase1",
            exit_phase=1,
            multiple_achieved=exit_mult,
            return_pct=(exit_mult - 1.0) * 100,
            hold_time_minutes=1,
            entry_mult=1.0,
            peak_mult=1.2,
            exit_mult=exit_mult,
            giveback_from_peak_pct=((1.2 - exit_mult) / 1.2 * 100),
            stop_mode="trailing",
            phase1_stop_pct=0.20,
            phase2_stop_pct=0.20,
            ladder_steps=0.5,
            hit_2x=False,
            hit_3x=False,
            hit_4x=False,
            hit_5x=False,
            hit_10x=False,
            ath_multiple=1.2,
            phase2_entry_price=None,
            phase2_entry_ts_ms=None,
        ))
    
    # Aggregate
    perf = aggregate_performance(trades)
    
    print(f"Total trades: {perf.n_trades}")
    print(f"Winners (≥3x): {perf.n_winners}")
    print(f"Losers (2x no 3x): {perf.n_losers_2x_no3x}")
    print(f"Never 2x: {perf.n_never_2x}")
    print(f"\nExit mult winners mean: {perf.exit_mult_winners_mean:.3f}x")
    print(f"Exit mult losers mean: {perf.exit_mult_losers_mean:.3f}x")
    print(f"Exit mult never 2x mean: {perf.exit_mult_never_2x_mean:.3f}x")
    print(f"\nEV from entry: {perf.ev_pct_from_entry:.1f}%")
    print(f"EV given 2x: {perf.ev_pct_given_2x:.1f}%")
    print(f"\nP(reach 2x): {perf.p_reach_2x:.1f}%")
    print(f"P(3x | 2x): {perf.p_3x_given_2x:.1f}%")
    
    # Calculate expected values manually
    expected_ev_from_entry = ((3 * 3.5 + 5 * 1.7 + 2 * 0.85) / 10 - 1.0) * 100
    expected_ev_given_2x = ((3 * 3.5 + 5 * 1.7) / 8 - 1.0) * 100
    
    print(f"\nExpected EV from entry: {expected_ev_from_entry:.1f}%")
    print(f"Expected EV given 2x: {expected_ev_given_2x:.1f}%")
    
    # Assertions
    assert perf.n_trades == 10, f"Expected 10 trades, got {perf.n_trades}"
    assert perf.n_winners == 3, f"Expected 3 winners, got {perf.n_winners}"
    assert perf.n_losers_2x_no3x == 5, f"Expected 5 losers, got {perf.n_losers_2x_no3x}"
    assert perf.n_never_2x == 2, f"Expected 2 never 2x, got {perf.n_never_2x}"
    
    assert abs(perf.exit_mult_winners_mean - 3.5) < 0.01, f"Expected winners mean=3.5, got {perf.exit_mult_winners_mean}"
    assert abs(perf.exit_mult_losers_mean - 1.7) < 0.01, f"Expected losers mean=1.7, got {perf.exit_mult_losers_mean}"
    assert abs(perf.exit_mult_never_2x_mean - 0.85) < 0.01, f"Expected never 2x mean=0.85, got {perf.exit_mult_never_2x_mean}"
    
    assert abs(perf.ev_pct_from_entry - expected_ev_from_entry) < 0.1, f"EV from entry mismatch: expected {expected_ev_from_entry:.1f}%, got {perf.ev_pct_from_entry:.1f}%"
    assert abs(perf.ev_pct_given_2x - expected_ev_given_2x) < 0.1, f"EV given 2x mismatch: expected {expected_ev_given_2x:.1f}%, got {perf.ev_pct_given_2x:.1f}%"
    
    assert abs(perf.p_reach_2x - 80.0) < 0.1, f"Expected P(reach 2x)=80%, got {perf.p_reach_2x}%"
    assert abs(perf.p_3x_given_2x - 37.5) < 0.1, f"Expected P(3x|2x)=37.5%, got {perf.p_3x_given_2x}%"
    
    print("✓ PASS")


def run_all_tests():
    """Run all golden path tests."""
    print("=" * 80)
    print("PHASED STOP SIMULATOR - GOLDEN PATH TESTS")
    print("=" * 80)
    
    tests = [
        test_winner_3x_no_giveback,
        test_winner_3x_with_giveback,
        test_loser_2x_no3x,
        test_never_2x_stopped_phase1,
        test_aggregate_ev_calculation,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"✗ FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"✗ ERROR: {e}")
            failed += 1
    
    print("\n" + "=" * 80)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("=" * 80)
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)

