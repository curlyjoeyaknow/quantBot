"""
Strategy robustness scoring.

Scores strategies based on walk-forward performance, not just in-sample optimization.
"""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import json


@dataclass
class StrategyPerformance:
    """Performance metrics for a strategy in a time period."""
    period_id: str
    start_date: str
    end_date: str
    total_trades: int
    win_rate: float
    avg_r: float
    profit_factor: float
    max_drawdown_pct: float
    sharpe_ratio: float
    total_return_pct: float


def compute_robustness_score(
    in_sample_perf: StrategyPerformance,
    out_of_sample_perfs: List[StrategyPerformance],
    weights: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Compute robustness score for a strategy.
    
    Robustness is measured by:
    1. Consistency across out-of-sample periods
    2. Degradation from in-sample to out-of-sample
    3. Stability of key metrics
    
    Args:
        in_sample_perf: In-sample (training) performance
        out_of_sample_perfs: List of out-of-sample (test) performances
        weights: Metric weights for scoring
    
    Returns:
        Dict with robustness_score, degradation_metrics, consistency_metrics
    """
    if not out_of_sample_perfs:
        return {
            'robustness_score': 0.0,
            'degradation': {},
            'consistency': {},
            'warning': 'No out-of-sample periods provided',
        }
    
    # Default weights
    if weights is None:
        weights = {
            'win_rate': 0.2,
            'avg_r': 0.3,
            'profit_factor': 0.2,
            'max_drawdown_pct': 0.15,
            'sharpe_ratio': 0.15,
        }
    
    # Calculate degradation (in-sample vs out-of-sample average)
    oos_avg_win_rate = sum(p.win_rate for p in out_of_sample_perfs) / len(out_of_sample_perfs)
    oos_avg_r = sum(p.avg_r for p in out_of_sample_perfs) / len(out_of_sample_perfs)
    oos_avg_pf = sum(p.profit_factor for p in out_of_sample_perfs) / len(out_of_sample_perfs)
    oos_avg_dd = sum(p.max_drawdown_pct for p in out_of_sample_perfs) / len(out_of_sample_perfs)
    oos_avg_sharpe = sum(p.sharpe_ratio for p in out_of_sample_perfs) / len(out_of_sample_perfs)
    
    # Degradation (lower is better, 0 = no degradation)
    win_rate_deg = max(0, in_sample_perf.win_rate - oos_avg_win_rate)
    avg_r_deg = max(0, in_sample_perf.avg_r - oos_avg_r)
    pf_deg = max(0, in_sample_perf.profit_factor - oos_avg_pf)
    dd_deg = max(0, oos_avg_dd - in_sample_perf.max_drawdown_pct)  # Higher DD is worse
    sharpe_deg = max(0, in_sample_perf.sharpe_ratio - oos_avg_sharpe)
    
    # Normalize degradation (0-1, where 1 is no degradation)
    win_rate_deg_norm = max(0, 1 - (win_rate_deg / in_sample_perf.win_rate)) if in_sample_perf.win_rate > 0 else 0
    avg_r_deg_norm = max(0, 1 - (avg_r_deg / abs(in_sample_perf.avg_r))) if in_sample_perf.avg_r != 0 else 0
    pf_deg_norm = max(0, 1 - (pf_deg / in_sample_perf.profit_factor)) if in_sample_perf.profit_factor > 0 else 0
    dd_deg_norm = max(0, 1 - (dd_deg / abs(in_sample_perf.max_drawdown_pct))) if in_sample_perf.max_drawdown_pct != 0 else 0
    sharpe_deg_norm = max(0, 1 - (sharpe_deg / abs(in_sample_perf.sharpe_ratio))) if in_sample_perf.sharpe_ratio != 0 else 0
    
    # Calculate consistency (lower std dev is better)
    if len(out_of_sample_perfs) > 1:
        win_rate_std = (sum((p.win_rate - oos_avg_win_rate) ** 2 for p in out_of_sample_perfs) / len(out_of_sample_perfs)) ** 0.5
        avg_r_std = (sum((p.avg_r - oos_avg_r) ** 2 for p in out_of_sample_perfs) / len(out_of_sample_perfs)) ** 0.5
        pf_std = (sum((p.profit_factor - oos_avg_pf) ** 2 for p in out_of_sample_perfs) / len(out_of_sample_perfs)) ** 0.5
        
        # Normalize consistency (0-1, where 1 is perfectly consistent)
        win_rate_consistency = max(0, 1 - (win_rate_std / oos_avg_win_rate)) if oos_avg_win_rate > 0 else 0
        avg_r_consistency = max(0, 1 - (avg_r_std / abs(oos_avg_r))) if oos_avg_r != 0 else 0
        pf_consistency = max(0, 1 - (pf_std / oos_avg_pf)) if oos_avg_pf > 0 else 0
    else:
        win_rate_consistency = 1.0
        avg_r_consistency = 1.0
        pf_consistency = 1.0
    
    # Weighted robustness score
    degradation_score = (
        win_rate_deg_norm * weights['win_rate'] +
        avg_r_deg_norm * weights['avg_r'] +
        pf_deg_norm * weights['profit_factor'] +
        dd_deg_norm * weights['max_drawdown_pct'] +
        sharpe_deg_norm * weights['sharpe_ratio']
    )
    
    consistency_score = (
        win_rate_consistency * weights['win_rate'] +
        avg_r_consistency * weights['avg_r'] +
        pf_consistency * weights['profit_factor']
    ) / (weights['win_rate'] + weights['avg_r'] + weights['profit_factor'])
    
    # Final robustness score (average of degradation and consistency)
    robustness_score = (degradation_score * 0.6 + consistency_score * 0.4)
    
    return {
        'robustness_score': robustness_score,
        'degradation': {
            'win_rate': {
                'in_sample': in_sample_perf.win_rate,
                'out_of_sample_avg': oos_avg_win_rate,
                'degradation': win_rate_deg,
                'degradation_pct': (win_rate_deg / in_sample_perf.win_rate * 100) if in_sample_perf.win_rate > 0 else 0,
            },
            'avg_r': {
                'in_sample': in_sample_perf.avg_r,
                'out_of_sample_avg': oos_avg_r,
                'degradation': avg_r_deg,
                'degradation_pct': (avg_r_deg / abs(in_sample_perf.avg_r) * 100) if in_sample_perf.avg_r != 0 else 0,
            },
            'profit_factor': {
                'in_sample': in_sample_perf.profit_factor,
                'out_of_sample_avg': oos_avg_pf,
                'degradation': pf_deg,
                'degradation_pct': (pf_deg / in_sample_perf.profit_factor * 100) if in_sample_perf.profit_factor > 0 else 0,
            },
        },
        'consistency': {
            'win_rate': win_rate_consistency,
            'avg_r': avg_r_consistency,
            'profit_factor': pf_consistency,
        },
        'out_of_sample_periods': len(out_of_sample_perfs),
    }


def main():
    """CLI entry point."""
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description='Compute strategy robustness score')
    parser.add_argument('--performance-json', required=True, help='JSON file with performance data')
    
    args = parser.parse_args()
    
    # Load performance data
    with open(args.performance_json, 'r') as f:
        data = json.load(f)
    
    in_sample = StrategyPerformance(**data['in_sample'])
    out_of_sample = [StrategyPerformance(**p) for p in data['out_of_sample']]
    
    # Compute robustness
    result = compute_robustness_score(in_sample, out_of_sample)
    
    # Output JSON
    print(json.dumps(result))


if __name__ == '__main__':
    main()

