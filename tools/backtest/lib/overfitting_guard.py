"""
Overfitting Protection Guard

Addresses: Risk #3 from ARCHITECTURE_REVIEW_2026-01-21.md
          "Optimizer overfitting protections are weak"

This module enforces mandatory walk-forward validation and degradation analysis.
No optimizer can return results without passing overfitting checks.

Usage:
    from lib.overfitting_guard import enforce_walk_forward_validation
    
    # After optimization
    validation_result = enforce_walk_forward_validation(
        optimizer_result,
        validation_split=0.3,  # 30% OOS
        max_degradation=0.10   # Max 10% EV drop
    )
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional


@dataclass
class ValidationResult:
    """Result of walk-forward validation"""
    passed: bool
    in_sample_ev: float
    out_of_sample_ev: float
    degradation_pct: float  # (OOS - IS) / IS
    robustness_score: float  # 0.0 to 1.0
    message: str
    metrics: Dict[str, Any]


class OverfittingError(Exception):
    """Raised when optimizer results fail overfitting checks"""
    
    def __init__(self, message: str, validation_result: ValidationResult):
        super().__init__(message)
        self.validation_result = validation_result


def enforce_walk_forward_validation(
    optimizer_result: Dict[str, Any],
    validation_split: float = 0.3,
    max_degradation: float = 0.10,
    min_robustness: float = 0.7,
    enforce: bool = True
) -> ValidationResult:
    """
    Enforce walk-forward validation on optimizer results.
    
    Args:
        optimizer_result: Result from optimizer (must include train/test splits)
        validation_split: Fraction of data for OOS testing (default 0.3 = 30%)
        max_degradation: Maximum allowed EV degradation OOS (default 0.10 = 10%)
        min_robustness: Minimum robustness score (default 0.7)
        enforce: If True, raise OverfittingError on failure
    
    Returns:
        ValidationResult with pass/fail and metrics
    
    Raises:
        OverfittingError if validation fails and enforce=True
    """
    
    # Extract metrics from optimizer result
    in_sample_ev = optimizer_result.get('train_ev', 0.0)
    out_of_sample_ev = optimizer_result.get('test_ev', 0.0)
    robustness_score = optimizer_result.get('robustness_score', 0.0)
    
    # Calculate degradation
    if in_sample_ev == 0:
        degradation_pct = 0.0
    else:
        degradation_pct = (out_of_sample_ev - in_sample_ev) / abs(in_sample_ev)
    
    # Check thresholds
    passed = True
    reasons = []
    
    if degradation_pct < -max_degradation:
        passed = False
        reasons.append(
            f"Degradation too high: {degradation_pct:.1%} < -{max_degradation:.0%}"
        )
    
    if robustness_score < min_robustness:
        passed = False
        reasons.append(
            f"Robustness too low: {robustness_score:.2f} < {min_robustness:.2f}"
        )
    
    message = "Validation passed" if passed else f"Validation failed: {'; '.join(reasons)}"
    
    result = ValidationResult(
        passed=passed,
        in_sample_ev=in_sample_ev,
        out_of_sample_ev=out_of_sample_ev,
        degradation_pct=degradation_pct,
        robustness_score=robustness_score,
        message=message,
        metrics={
            'validation_split': validation_split,
            'max_degradation': max_degradation,
            'min_robustness': min_robustness,
            'actual_degradation': degradation_pct,
            'actual_robustness': robustness_score
        }
    )
    
    if not passed and enforce:
        raise OverfittingError(message, result)
    
    return result


def require_validation_split(
    date_from: str,
    date_to: str,
    validation_split: float = 0.3
) -> tuple[str, str, str, str]:
    """
    Split date range into train/test periods.
    
    Args:
        date_from: Start date (YYYY-MM-DD)
        date_to: End date (YYYY-MM-DD)
        validation_split: Fraction for testing (default 0.3)
    
    Returns:
        (train_from, train_to, test_from, test_to)
    """
    from datetime import datetime, timedelta
    
    start = datetime.fromisoformat(date_from)
    end = datetime.fromisoformat(date_to)
    
    total_days = (end - start).days
    test_days = int(total_days * validation_split)
    train_days = total_days - test_days
    
    train_from = start.strftime('%Y-%m-%d')
    train_to = (start + timedelta(days=train_days)).strftime('%Y-%m-%d')
    test_from = train_to
    test_to = end.strftime('%Y-%m-%d')
    
    return train_from, train_to, test_from, test_to


def calculate_robustness_score(
    train_metrics: Dict[str, float],
    test_metrics: Dict[str, float]
) -> float:
    """
    Calculate robustness score (0.0 to 1.0).
    
    Higher score = more consistent performance across train/test.
    
    Formula:
        score = 1.0 - |degradation| - consistency_penalty
    
    Where:
        degradation = (test_ev - train_ev) / train_ev
        consistency_penalty = variance in win_rate, avg_r, etc.
    """
    train_ev = train_metrics.get('avg_r', 0.0)
    test_ev = test_metrics.get('avg_r', 0.0)
    
    if train_ev == 0:
        return 0.0
    
    # Degradation component (0.0 to 1.0, lower is worse)
    degradation = abs((test_ev - train_ev) / train_ev)
    degradation_score = max(0.0, 1.0 - degradation)
    
    # Consistency component (win rate, avg R should be similar)
    train_wr = train_metrics.get('win_rate', 0.0)
    test_wr = test_metrics.get('win_rate', 0.0)
    wr_consistency = 1.0 - abs(train_wr - test_wr)
    
    # Combined score (weighted average)
    robustness = 0.7 * degradation_score + 0.3 * wr_consistency
    
    return max(0.0, min(1.0, robustness))

