"""
Overfitting Guard for Optimization Results.

Enforces walk-forward validation and prevents selection of overfitted strategies.
Based on Phase A requirements: mandatory walk-forward validation with degradation checks.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional, List
import json


class OverfittingError(Exception):
    """Raised when overfitting is detected."""
    pass


@dataclass
class ValidationResult:
    """Result of walk-forward validation."""
    passed: bool
    message: str
    robustness_score: float
    degradation_pct: float
    metrics: Dict[str, Any]


@dataclass
class OptimizerResult:
    """Simplified optimizer result for validation."""
    train_metrics: Dict[str, float]
    test_metrics: Dict[str, float]
    config: Dict[str, Any]


def enforce_walk_forward_validation(
    optimizer_result: OptimizerResult,
    validation_split: float = 0.3,
    max_degradation: float = 0.10,
    min_robustness: float = 0.7,
    enforce: bool = True,
) -> ValidationResult:
    """
    Enforce walk-forward validation on optimizer results.
    
    Args:
        optimizer_result: Result from optimizer with train/test metrics
        validation_split: Fraction of data used for validation (default 0.3)
        max_degradation: Maximum allowed degradation (default 0.10 = 10%)
        min_robustness: Minimum robustness score (default 0.7)
        enforce: If True, raise OverfittingError on failure
    
    Returns:
        ValidationResult with pass/fail status and metrics
    
    Raises:
        OverfittingError: If enforce=True and validation fails
    """
    train_metrics = optimizer_result.train_metrics
    test_metrics = optimizer_result.test_metrics
    
    # Extract key metrics (handle different metric names)
    train_ev = train_metrics.get('expected_value', train_metrics.get('avg_r', train_metrics.get('total_return', 0.0)))
    test_ev = test_metrics.get('expected_value', test_metrics.get('avg_r', test_metrics.get('total_return', 0.0)))
    
    train_win_rate = train_metrics.get('win_rate', 0.0)
    test_win_rate = test_metrics.get('win_rate', 0.0)
    
    train_profit_factor = train_metrics.get('profit_factor', 0.0)
    test_profit_factor = test_metrics.get('profit_factor', 0.0)
    
    # Calculate degradation
    if train_ev != 0:
        ev_degradation = abs((train_ev - test_ev) / train_ev)
    else:
        ev_degradation = 1.0 if test_ev < 0 else 0.0
    
    win_rate_degradation = max(0, train_win_rate - test_win_rate)
    pf_degradation = max(0, train_profit_factor - test_profit_factor) if train_profit_factor > 0 else 0
    
    # Overall degradation (weighted)
    degradation_pct = (
        ev_degradation * 0.5 +
        (win_rate_degradation / train_win_rate if train_win_rate > 0 else 0) * 0.3 +
        (pf_degradation / train_profit_factor if train_profit_factor > 0 else 0) * 0.2
    )
    
    # Compute robustness score (using robustness_scorer logic)
    from lib.robustness_scorer import StrategyPerformance, compute_robustness_score
    
    train_perf = StrategyPerformance(
        period_id='train',
        start_date='',
        end_date='',
        total_trades=train_metrics.get('total_trades', 0),
        win_rate=train_win_rate,
        avg_r=train_ev,
        profit_factor=train_profit_factor,
        max_drawdown_pct=train_metrics.get('max_drawdown_pct', 0.0),
        sharpe_ratio=train_metrics.get('sharpe_ratio', 0.0),
        total_return_pct=train_metrics.get('total_return_pct', 0.0),
    )
    
    test_perf = StrategyPerformance(
        period_id='test',
        start_date='',
        end_date='',
        total_trades=test_metrics.get('total_trades', 0),
        win_rate=test_win_rate,
        avg_r=test_ev,
        profit_factor=test_profit_factor,
        max_drawdown_pct=test_metrics.get('max_drawdown_pct', 0.0),
        sharpe_ratio=test_metrics.get('sharpe_ratio', 0.0),
        total_return_pct=test_metrics.get('total_return_pct', 0.0),
    )
    
    robustness_result = compute_robustness_score(
        train_perf,
        [test_perf],
    )
    
    robustness_score = robustness_result['robustness_score']
    
    # Check degradation
    degradation_check = degradation_pct <= max_degradation
    
    # Check robustness
    robustness_check = robustness_score >= min_robustness
    
    # Overall pass/fail
    passed = degradation_check and robustness_check
    
    # Build message
    if passed:
        message = (
            f"✅ Validation passed: "
            f"degradation={degradation_pct:.1%} (max {max_degradation:.1%}), "
            f"robustness={robustness_score:.3f} (min {min_robustness:.3f})"
        )
    else:
        failures = []
        if not degradation_check:
            failures.append(f"degradation {degradation_pct:.1%} > {max_degradation:.1%}")
        if not robustness_check:
            failures.append(f"robustness {robustness_score:.3f} < {min_robustness:.3f}")
        message = f"❌ Validation failed: {', '.join(failures)}"
    
    result = ValidationResult(
        passed=passed,
        message=message,
        robustness_score=robustness_score,
        degradation_pct=degradation_pct,
        metrics={
            'train_ev': train_ev,
            'test_ev': test_ev,
            'train_win_rate': train_win_rate,
            'test_win_rate': test_win_rate,
            'train_profit_factor': train_profit_factor,
            'test_profit_factor': test_profit_factor,
            'robustness_details': robustness_result,
        },
    )
    
    if enforce and not passed:
        raise OverfittingError(message)
    
    return result


def validate_optimizer_results(
    results: List[Dict[str, Any]],
    validation_split: float = 0.3,
    max_degradation: float = 0.10,
    min_robustness: float = 0.7,
    enforce: bool = True,
) -> List[ValidationResult]:
    """
    Validate multiple optimizer results.
    
    Args:
        results: List of optimizer result dicts with train/test metrics
        validation_split: Fraction of data used for validation
        max_degradation: Maximum allowed degradation
        min_robustness: Minimum robustness score
        enforce: If True, raise OverfittingError if any fail
    
    Returns:
        List of ValidationResult objects
    
    Raises:
        OverfittingError: If enforce=True and any validation fails
    """
    validation_results = []
    
    for i, result_dict in enumerate(results):
        try:
            optimizer_result = OptimizerResult(
                train_metrics=result_dict.get('train_metrics', {}),
                test_metrics=result_dict.get('test_metrics', {}),
                config=result_dict.get('config', {}),
            )
            
            validation = enforce_walk_forward_validation(
                optimizer_result,
                validation_split=validation_split,
                max_degradation=max_degradation,
                min_robustness=min_robustness,
                enforce=enforce,
            )
            
            validation_results.append(validation)
        except Exception as e:
            if enforce:
                raise OverfittingError(f"Validation failed for result {i}: {e}")
            validation_results.append(ValidationResult(
                passed=False,
                message=f"Validation error: {e}",
                robustness_score=0.0,
                degradation_pct=1.0,
                metrics={},
            ))
    
    return validation_results

