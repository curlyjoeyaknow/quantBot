"""
V1 Baseline Optimizer

Performs grid search over parameter combinations to find optimal TP/SL parameters
with capital-aware simulation.

Features:
- Grid search over tp_mult, sl_mult, max_hold_hrs
- Per-caller optimization
- Grouped evaluation with filtering
- Objective: maximize final capital (C_final)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .v1_baseline_simulator import (
    V1BaselineParams,
    CapitalSimulationResult,
    CapitalSimulatorConfig,
    simulate_capital_aware,
)

# =============================================================================
# Default Parameter Grids
# =============================================================================

DEFAULT_TP_MULTS = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
DEFAULT_SL_MULTS = [0.85, 0.88, 0.9, 0.92, 0.95]
DEFAULT_MAX_HOLD_HRS = [48.0]  # Only 48h for V1 baseline


# =============================================================================
# Types
# =============================================================================

@dataclass
class V1BaselineOptimizationResult:
    """V1 Baseline optimization result."""
    
    best_params: Optional[V1BaselineParams]
    best_final_capital: float
    best_total_return: float
    all_results: List[Dict[str, Any]] = field(default_factory=list)
    params_evaluated: int = 0


@dataclass
class V1BaselinePerCallerResult:
    """Per-caller optimization result."""
    
    caller: str
    best_params: Optional[V1BaselineParams]
    best_final_capital: float
    best_total_return: float
    collapsed_capital: bool
    requires_extreme_params: bool


# =============================================================================
# Optimizer Functions
# =============================================================================

def optimize_v1_baseline(
    calls: List[Dict[str, Any]],
    candles_by_call_id: Dict[str, List[Dict[str, Any]]],
    param_grid: Optional[Dict[str, List[float]]] = None,
    simulator_config: Optional[CapitalSimulatorConfig] = None,
    caller_groups: Optional[List[str]] = None,
    verbose: bool = False,
) -> V1BaselineOptimizationResult:
    """
    Optimize V1 baseline parameters for a set of calls.
    
    Performs grid search over tp_mult and sl_mult to maximize final capital.
    
    Args:
        calls: List of call dicts with keys: id, mint, caller, ts_ms
        candles_by_call_id: Dict mapping call_id to list of candle dicts
        param_grid: Optional parameter grid with keys: tp_mults, sl_mults, max_hold_hrs
        simulator_config: Optional simulator configuration
        caller_groups: Optional list of caller names to filter
        verbose: Print progress
    
    Returns:
        V1BaselineOptimizationResult with best params and all results
    """
    # Filter calls by caller groups if specified
    calls_to_optimize = calls
    if caller_groups and len(caller_groups) > 0:
        calls_to_optimize = [c for c in calls if c["caller"] in caller_groups]
        if verbose:
            print(f"Filtering calls by caller groups: {len(calls)} -> {len(calls_to_optimize)}")
    
    # Generate parameter grid
    grid = param_grid or {}
    tp_mults = grid.get("tp_mults", DEFAULT_TP_MULTS)
    sl_mults = grid.get("sl_mults", DEFAULT_SL_MULTS)
    max_hold_hrs_list = grid.get("max_hold_hrs", DEFAULT_MAX_HOLD_HRS)
    
    total_combinations = len(tp_mults) * len(sl_mults) * len(max_hold_hrs_list)
    
    if verbose:
        print(f"Starting V1 baseline optimization:")
        print(f"  Calls: {len(calls_to_optimize)}")
        print(f"  TP mults: {len(tp_mults)}")
        print(f"  SL mults: {len(sl_mults)}")
        print(f"  Max hold hrs: {len(max_hold_hrs_list)}")
        print(f"  Total combinations: {total_combinations}")
    
    # Evaluate each parameter combination
    results: List[Dict[str, Any]] = []
    
    for tp_mult in tp_mults:
        for sl_mult in sl_mults:
            for max_hold_hr in max_hold_hrs_list:
                params = V1BaselineParams(
                    tp_mult=tp_mult,
                    sl_mult=sl_mult,
                    max_hold_hrs=max_hold_hr,
                )
                
                # Run capital simulation
                result = simulate_capital_aware(
                    calls_to_optimize,
                    candles_by_call_id,
                    params,
                    simulator_config,
                )
                
                results.append({
                    "params": params,
                    "result": result,
                })
    
    # Sort by final capital (descending) - objective is to maximize C_final
    results.sort(key=lambda x: x["result"].final_capital, reverse=True)
    
    best = results[0] if results else None
    best_params = best["params"] if best else None
    best_final_capital = best["result"].final_capital if best else 0.0
    best_total_return = best["result"].total_return if best else 0.0
    
    if verbose:
        print(f"V1 baseline optimization complete:")
        print(f"  Params evaluated: {len(results)}")
        print(f"  Best final capital: ${best_final_capital:.2f}")
        print(f"  Best total return: {best_total_return * 100:.2f}%")
        print(f"  Best params: {best_params}")
    
    return V1BaselineOptimizationResult(
        best_params=best_params,
        best_final_capital=best_final_capital,
        best_total_return=best_total_return,
        all_results=results,
        params_evaluated=len(results),
    )


def optimize_v1_baseline_per_caller(
    calls: List[Dict[str, Any]],
    candles_by_call_id: Dict[str, List[Dict[str, Any]]],
    param_grid: Optional[Dict[str, List[float]]] = None,
    simulator_config: Optional[CapitalSimulatorConfig] = None,
    verbose: bool = False,
) -> Dict[str, V1BaselinePerCallerResult]:
    """
    Optimize V1 baseline per caller.
    
    Runs optimization for each caller separately and returns best parameters per caller.
    Also identifies callers that collapse capital or require extreme parameters.
    
    Args:
        calls: List of call dicts
        candles_by_call_id: Dict mapping call_id to candle list
        param_grid: Optional parameter grid
        simulator_config: Optional simulator configuration
        verbose: Print progress
    
    Returns:
        Dict mapping caller name to V1BaselinePerCallerResult
    """
    # Group calls by caller
    calls_by_caller: Dict[str, List[Dict[str, Any]]] = {}
    for call in calls:
        caller = call["caller"]
        if caller not in calls_by_caller:
            calls_by_caller[caller] = []
        calls_by_caller[caller].append(call)
    
    results: Dict[str, V1BaselinePerCallerResult] = {}
    
    for caller, caller_calls in calls_by_caller.items():
        if verbose:
            print(f"Optimizing V1 baseline for caller: {caller} ({len(caller_calls)} calls)")
        
        optimize_result = optimize_v1_baseline(
            caller_calls,
            candles_by_call_id,
            param_grid,
            simulator_config,
            verbose=False,  # Don't print per-caller details
        )
        
        # Check if caller collapsed capital
        cfg = simulator_config or CapitalSimulatorConfig()
        collapsed_capital = optimize_result.best_final_capital < cfg.initial_capital
        
        # Check if requires extreme parameters (heuristic: very tight SL < 0.88 or very high TP > 4.0)
        requires_extreme_params = False
        if optimize_result.best_params:
            requires_extreme_params = (
                optimize_result.best_params.sl_mult < 0.88 or
                optimize_result.best_params.tp_mult > 4.0
            )
        
        results[caller] = V1BaselinePerCallerResult(
            caller=caller,
            best_params=optimize_result.best_params,
            best_final_capital=optimize_result.best_final_capital,
            best_total_return=optimize_result.best_total_return,
            collapsed_capital=collapsed_capital,
            requires_extreme_params=requires_extreme_params,
        )
    
    return results


def run_v1_baseline_grouped_evaluation(
    calls: List[Dict[str, Any]],
    candles_by_call_id: Dict[str, List[Dict[str, Any]]],
    param_grid: Optional[Dict[str, List[float]]] = None,
    simulator_config: Optional[CapitalSimulatorConfig] = None,
    filter_collapsed: bool = True,
    filter_extreme: bool = True,
    verbose: bool = False,
) -> Dict[str, Any]:
    """
    Run grouped evaluation with per-caller optimized parameters.
    
    First optimizes per caller, filters out collapsed/extreme callers,
    then runs grouped simulation with selected callers.
    
    Args:
        calls: List of call dicts
        candles_by_call_id: Dict mapping call_id to candle list
        param_grid: Optional parameter grid
        simulator_config: Optional simulator configuration
        filter_collapsed: Filter out callers that collapsed capital alone
        filter_extreme: Filter out callers requiring extreme parameters
        verbose: Print progress
    
    Returns:
        Dict with keys: per_caller_results, selected_callers, grouped_result, grouped_params
    """
    # Optimize per caller
    per_caller_results = optimize_v1_baseline_per_caller(
        calls,
        candles_by_call_id,
        param_grid,
        simulator_config,
        verbose=verbose,
    )
    
    # Filter callers
    selected_callers: List[str] = []
    for caller, result in per_caller_results.items():
        if filter_collapsed and result.collapsed_capital:
            continue  # Skip collapsed callers
        if filter_extreme and result.requires_extreme_params:
            continue  # Skip extreme parameter callers
        selected_callers.append(caller)
    
    if verbose:
        print(f"Grouped evaluation filtering:")
        print(f"  Total callers: {len(per_caller_results)}")
        print(f"  Selected callers: {len(selected_callers)}")
        print(f"  Filtered out: {len(per_caller_results) - len(selected_callers)}")
    
    # For grouped evaluation, use average parameters from selected callers
    grouped_params: Optional[V1BaselineParams] = None
    grouped_result: Optional[CapitalSimulationResult] = None
    
    if len(selected_callers) > 0:
        # Calculate average parameters from selected callers
        avg_tp_mult = 0.0
        avg_sl_mult = 0.0
        count = 0
        
        for caller in selected_callers:
            result = per_caller_results[caller]
            if result.best_params:
                avg_tp_mult += result.best_params.tp_mult
                avg_sl_mult += result.best_params.sl_mult
                count += 1
        
        if count > 0:
            grouped_params = V1BaselineParams(
                tp_mult=avg_tp_mult / count,
                sl_mult=avg_sl_mult / count,
                max_hold_hrs=48.0,  # Fixed for V1
            )
            
            # Filter calls to selected callers
            selected_calls = [c for c in calls if c["caller"] in selected_callers]
            
            # Run grouped simulation
            grouped_result = simulate_capital_aware(
                selected_calls,
                candles_by_call_id,
                grouped_params,
                simulator_config,
            )
            
            if verbose:
                print(f"Grouped evaluation complete:")
                print(f"  Selected callers: {len(selected_callers)}")
                print(f"  Grouped final capital: ${grouped_result.final_capital:.2f}")
                print(f"  Grouped total return: {grouped_result.total_return * 100:.2f}%")
                print(f"  Grouped params: {grouped_params}")
    
    return {
        "per_caller_results": per_caller_results,
        "selected_callers": selected_callers,
        "grouped_result": grouped_result,
        "grouped_params": grouped_params,
    }

