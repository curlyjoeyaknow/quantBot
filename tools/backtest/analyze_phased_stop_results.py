#!/usr/bin/env python3
"""
Analyze Phased Stop Results and Generate Recommendations

Analyzes phased stop simulation results and provides:
1. Performance statistics per caller
2. Recommended strategy configurations per caller
3. Suggestions for further testing
4. Integration guide for optimizer

Usage:
    python3 analyze_phased_stop_results.py output/immediate/phased_stop_results_7e0cb30d02f15805.parquet
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List

import pandas as pd


def analyze_caller_performance(df: pd.DataFrame, caller: str) -> Dict:
    """Analyze performance metrics for a specific caller."""
    caller_df = df[df['caller'] == caller].copy()
    
    if len(caller_df) == 0:
        return None
    
    # Group by strategy configuration
    strategy_groups = caller_df.groupby(['stop_mode', 'phase1_stop_pct', 'phase2_stop_pct', 'ladder_steps'])
    
    best_strategy = None
    best_score = float('-inf')
    strategy_stats = []
    
    for (stop_mode, p1_stop, p2_stop, ladder_steps), group in strategy_groups:
        stats = {
            'stop_mode': stop_mode,
            'phase1_stop_pct': p1_stop,
            'phase2_stop_pct': p2_stop,
            'ladder_steps': ladder_steps if not pd.isna(ladder_steps) else None,
            'n_trades': len(group),
            'avg_return_pct': group['return_pct'].mean(),
            'median_return_pct': group['return_pct'].median(),
            'total_return_pct': group['return_pct'].sum(),
            'win_rate_pct': (group['return_pct'] > 0).mean() * 100,
            'hit_2x_rate': group['hit_2x'].mean() * 100,
            'hit_3x_rate': group['hit_3x'].mean() * 100,
            'hit_5x_rate': group['hit_5x'].mean() * 100,
            'avg_exit_mult': group['exit_mult'].mean(),
            'median_exit_mult': group['exit_mult'].median(),
            'avg_peak_mult': group['peak_mult'].mean(),
            'median_peak_mult': group['peak_mult'].median(),
            'avg_giveback_pct': group['giveback_from_peak_pct'].mean(),
            'max_loss_pct': group['return_pct'].min(),
            'max_gain_pct': group['return_pct'].max(),
            'stopped_phase1_rate': (group['exit_reason'] == 'stopped_phase1').mean() * 100,
            'stopped_phase2_rate': (group['exit_reason'] == 'stopped_phase2').mean() * 100,
            'end_of_data_rate': (group['exit_reason'] == 'end_of_data').mean() * 100,
            'avg_hold_time_minutes': group['hold_time_minutes'].mean(),
        }
        
        # Composite score: weighted combination of metrics
        # Prioritize: total return, win rate, hit rates, risk-adjusted metrics
        score = (
            stats['total_return_pct'] * 0.3 +
            stats['avg_return_pct'] * 0.2 +
            stats['win_rate_pct'] * 0.15 +
            stats['hit_2x_rate'] * 0.1 +
            stats['hit_3x_rate'] * 0.1 +
            stats['median_exit_mult'] * 50 * 0.1 +  # Scale multiplier
            max(stats['max_loss_pct'], -50) * 0.05  # Penalize large losses
        )
        
        stats['composite_score'] = score
        strategy_stats.append(stats)
        
        if score > best_score:
            best_score = score
            best_strategy = stats
    
    # Overall caller metrics (aggregate across all strategies)
    overall = {
        'total_trades': len(caller_df),
        'unique_mints': caller_df['mint'].nunique(),
        'overall_avg_return_pct': caller_df['return_pct'].mean(),
        'overall_median_return_pct': caller_df['return_pct'].median(),
        'overall_win_rate_pct': (caller_df['return_pct'] > 0).mean() * 100,
        'overall_hit_2x_rate': caller_df['hit_2x'].mean() * 100,
        'overall_hit_3x_rate': caller_df['hit_3x'].mean() * 100,
        'overall_hit_5x_rate': caller_df['hit_5x'].mean() * 100,
        'overall_avg_exit_mult': caller_df['exit_mult'].mean(),
        'overall_median_exit_mult': caller_df['exit_mult'].median(),
        'overall_avg_peak_mult': caller_df['peak_mult'].mean(),
        'overall_median_peak_mult': caller_df['peak_mult'].median(),
    }
    
    # Sort strategies by composite score
    strategy_stats.sort(key=lambda x: x['composite_score'], reverse=True)
    
    return {
        'caller': caller,
        'overall': overall,
        'best_strategy': best_strategy,
        'all_strategies': strategy_stats[:10],  # Top 10 strategies
        'n_strategies_tested': len(strategy_stats),
    }


def generate_recommendations(analysis: Dict) -> Dict:
    """Generate strategy recommendations based on analysis."""
    caller = analysis['caller']
    best = analysis['best_strategy']
    
    if not best:
        return {
            'caller': caller,
            'recommended_strategy': None,
            'rationale': 'Insufficient data for recommendations',
            'confidence': 'low',
        }
    
    recommendations = {
        'caller': caller,
        'recommended_strategy': {
            'stop_mode': best['stop_mode'],
            'phase1_stop_pct': float(best['phase1_stop_pct']),
            'phase2_stop_pct': float(best['phase2_stop_pct']),
            'ladder_steps': best['ladder_steps'] if best['ladder_steps'] is not None else None,
        },
        'expected_performance': {
            'avg_return_pct': best['avg_return_pct'],
            'win_rate_pct': best['win_rate_pct'],
            'hit_2x_rate': best['hit_2x_rate'],
            'hit_3x_rate': best['hit_3x_rate'],
            'median_exit_mult': best['median_exit_mult'],
        },
        'rationale': [],
        'confidence': 'medium',
        'further_testing': [],
    }
    
    # Build rationale
    if best['stop_mode'] == 'phased':
        recommendations['rationale'].append(
            f"Phased stops ({best['phase1_stop_pct']*100:.1f}% / {best['phase2_stop_pct']*100:.1f}%) "
            f"outperformed universal stops for this caller"
        )
    elif best['stop_mode'] == 'universal':
        recommendations['rationale'].append(
            f"Universal stops ({best['phase1_stop_pct']*100:.1f}%) perform well across both phases"
        )
    
    if best['win_rate_pct'] > 60:
        recommendations['rationale'].append(f"High win rate ({best['win_rate_pct']:.1f}%)")
    elif best['win_rate_pct'] < 40:
        recommendations['rationale'].append(
            f"Low win rate ({best['win_rate_pct']:.1f}%) but strong average returns suggest "
            f"asymmetric payoff structure"
        )
    
    if best['hit_3x_rate'] > 30:
        recommendations['rationale'].append(
            f"Strong 3x+ capture rate ({best['hit_3x_rate']:.1f}%) indicates good tail capture"
        )
    
    if best['max_loss_pct'] < -30:
        recommendations['rationale'].append(
            f"Risk management: max loss of {best['max_loss_pct']:.1f}% observed"
        )
    
    # Confidence assessment
    if best['n_trades'] >= 100 and analysis['n_strategies_tested'] >= 5:
        recommendations['confidence'] = 'high'
    elif best['n_trades'] >= 50:
        recommendations['confidence'] = 'medium'
    else:
        recommendations['confidence'] = 'low'
    
    # Further testing suggestions
    if best['stopped_phase1_rate'] > 40:
        recommendations['further_testing'].append(
            f"High Phase 1 stop rate ({best['stopped_phase1_rate']:.1f}%) - "
            f"consider testing looser Phase 1 stops around {(best['phase1_stop_pct']*1.2)*100:.1f}%"
        )
    
    if best['stopped_phase2_rate'] > 30 and best['hit_3x_rate'] > 25:
        recommendations['further_testing'].append(
            f"Good 3x+ rates but high Phase 2 stops - consider tighter Phase 2 stops "
            f"around {(best['phase2_stop_pct']*0.8)*100:.1f}% to capture more tail"
        )
    
    if best['hit_2x_rate'] > 50 and best['hit_5x_rate'] < 10:
        recommendations['further_testing'].append(
            "High 2x rate but low 5x+ capture - test ladder exits to capture more tail multiples"
        )
    
    if best['avg_giveback_pct'] > 30:
        recommendations['further_testing'].append(
            f"High giveback from peak ({best['avg_giveback_pct']:.1f}%) - "
            f"consider tighter trailing stops or ladder exits"
        )
    
    return recommendations


def suggest_exit_strategies(analysis: Dict) -> List[str]:
    """Suggest additional exit strategies to test based on caller profile."""
    overall = analysis['overall']
    best = analysis['best_strategy']
    
    suggestions = []
    
    # High hit rates but low capture -> ladder exits
    if overall['overall_hit_3x_rate'] > 30 and best['hit_5x_rate'] < 15:
        suggestions.append({
            'strategy': 'ladder_exits',
            'rationale': f"High 3x+ hit rate ({overall['overall_hit_3x_rate']:.1f}%) but low 5x+ capture - "
                        f"ladder exits could capture more tail multiples",
            'config': {
                'type': 'ladder',
                'levels': [2.0, 3.0, 4.0, 5.0],
                'percentages': [25, 25, 25, 25],
            }
        })
    
    # High volatility (large giveback) -> tighter trailing stops
    if best['avg_giveback_pct'] > 25:
        suggestions.append({
            'strategy': 'tighter_trailing_stops',
            'rationale': f"Large giveback from peak ({best['avg_giveback_pct']:.1f}%) - "
                        f"tighter trailing stops could lock in more gains",
            'config': {
                'type': 'trailing_stop',
                'trail_pct': best['phase2_stop_pct'] * 0.7 if best['stop_mode'] == 'phased' else best['phase1_stop_pct'] * 0.7,
                'activation_multiple': 2.0,
            }
        })
    
    # High win rate but low average return -> scale up targets
    if best['win_rate_pct'] > 55 and best['avg_return_pct'] < 50:
        suggestions.append({
            'strategy': 'higher_take_profit_targets',
            'rationale': f"High win rate ({best['win_rate_pct']:.1f}%) but modest returns - "
                        f"consider higher TP targets (3x, 4x, 5x) to capture more upside",
            'config': {
                'type': 'take_profit',
                'targets': [3.0, 4.0, 5.0],
                'percentages': [33, 33, 34],
            }
        })
    
    # Time-based exits for volatile callers
    if best['avg_hold_time_minutes'] > 120 and best['avg_giveback_pct'] > 20:
        suggestions.append({
            'strategy': 'time_based_exits',
            'rationale': f"Long hold times ({best['avg_hold_time_minutes']:.0f} min) with giveback - "
                        f"time-based exits after hitting targets could preserve gains",
            'config': {
                'type': 'time_exit',
                'max_hold_after_target_minutes': 60,
                'target_multiple': 2.0,
            }
        })
    
    # Indicator-based exits (if data available)
    suggestions.append({
        'strategy': 'indicator_based_exits',
        'rationale': "Test indicator-based exits (RSI overbought, volume divergence, etc.) "
                    "to capture exits at better prices",
        'config': {
            'type': 'indicator_exit',
            'indicators': ['rsi_overbought', 'volume_divergence'],
            'priority': 'volume_divergence',
        }
    })
    
    return suggestions


def format_output(analyses: List[Dict], recommendations: List[Dict], exit_suggestions: Dict[str, List]) -> str:
    """Format analysis results as readable output."""
    output = []
    output.append("=" * 80)
    output.append("PHASED STOP RESULTS ANALYSIS")
    output.append("=" * 80)
    output.append("")
    
    # Summary table
    output.append("CALLER PERFORMANCE SUMMARY")
    output.append("-" * 80)
    output.append("{:<25} {:<8} {:<12} {:<12} {:<12} {:<12}".format(
        'Caller', 'Trades', 'Avg Return %', 'Win Rate %', 'Hit 3x %', 'Best Score'
    ))
    output.append("-" * 80)
    
    for analysis in sorted(analyses, key=lambda x: x['best_strategy']['composite_score'] if x['best_strategy'] else -999, reverse=True):
        caller = analysis['caller']
        overall = analysis['overall']
        best = analysis['best_strategy']
        if best:
            output.append(
                f"{caller:<25} {overall['total_trades']:<8} "
                f"{best['avg_return_pct']:>10.2f} {best['win_rate_pct']:>10.1f} "
                f"{best['hit_3x_rate']:>10.1f} {best['composite_score']:>10.1f}"
            )
    output.append("")
    
    # Detailed recommendations per caller
    output.append("DETAILED RECOMMENDATIONS BY CALLER")
    output.append("=" * 80)
    output.append("")
    
    for rec in sorted(recommendations, key=lambda x: x['expected_performance']['avg_return_pct'] if x['expected_performance'] else -999, reverse=True):
        caller = rec['caller']
        output.append("Caller: " + caller)
        output.append("-" * 80)
        
        if rec['recommended_strategy']:
            strat = rec['recommended_strategy']
            output.append("Recommended Strategy:")
            output.append("  Mode: " + strat['stop_mode'])
            output.append("  Phase 1 Stop: {:.1f}%".format(strat['phase1_stop_pct']*100))
            output.append("  Phase 2 Stop: {:.1f}%".format(strat['phase2_stop_pct']*100))
            if strat['ladder_steps']:
                output.append("  Ladder Steps: " + str(strat['ladder_steps']))
            
            output.append("\nExpected Performance:")
            perf = rec['expected_performance']
            output.append("  Avg Return: {:.2f}%".format(perf['avg_return_pct']))
            output.append("  Win Rate: {:.1f}%".format(perf['win_rate_pct']))
            output.append("  Hit 2x Rate: {:.1f}%".format(perf['hit_2x_rate']))
            output.append("  Hit 3x Rate: {:.1f}%".format(perf['hit_3x_rate']))
            output.append("  Median Exit Multiple: {:.2f}x".format(perf['median_exit_mult']))
            
            output.append("\nRationale:")
            for reason in rec['rationale']:
                output.append("  • " + reason)
            
            output.append(f"\nConfidence: {rec['confidence'].upper()}")
            
            if rec['further_testing']:
                output.append("\nFurther Testing Suggestions:")
                for suggestion in rec['further_testing']:
                    output.append("  • " + suggestion)
            
            if caller in exit_suggestions and exit_suggestions[caller]:
                output.append("\nAdditional Exit Strategy Ideas:")
                for suggestion in exit_suggestions[caller]:
                    output.append(f"  • {suggestion['strategy']}: {suggestion['rationale']}")
                    if 'config' in suggestion:
                        output.append(f"    Config: {json.dumps(suggestion['config'], indent=6)}")
        else:
            output.append("  Insufficient data for recommendations")
        
        output.append("")
    
    return "\n".join(output)


def export_for_optimizer(analyses: List[Dict], output_path: Path):
    """Export recommendations in format suitable for optimizer input."""
    optimizer_configs = []
    
    for analysis in analyses:
        caller = analysis['caller']
        best = analysis['best_strategy']
        
        if not best or analysis['overall']['total_trades'] < 20:
            continue
        
        # Create optimizer config based on best strategy
        config = {
            'caller': caller,
            'base_strategy': {
                'stop_mode': best['stop_mode'],
                'phase1_stop_pct': float(best['phase1_stop_pct']),
                'phase2_stop_pct': float(best['phase2_stop_pct']),
            },
            'search_space': {
                # Search around the best found parameters
                'phase1_stop_pct': [
                    float(best['phase1_stop_pct'] * 0.8),
                    float(best['phase1_stop_pct']),
                    float(best['phase1_stop_pct'] * 1.2),
                ],
                'phase2_stop_pct': [
                    float(best['phase2_stop_pct'] * 0.7),
                    float(best['phase2_stop_pct'] * 0.85),
                    float(best['phase2_stop_pct']),
                    float(best['phase2_stop_pct'] * 1.15),
                ],
            },
            'expected_performance': analysis['best_strategy'],
        }
        
        optimizer_configs.append(config)
    
    with open(output_path, 'w') as f:
        json.dump(optimizer_configs, f, indent=2)
    
    print(f"\nExported {len(optimizer_configs)} caller configurations to {output_path}")
    print("This file can be used as input for the optimizer to refine strategies further.")


def main():
    parser = argparse.ArgumentParser(description='Analyze phased stop results and generate recommendations')
    parser.add_argument('parquet_file', type=Path, help='Path to phased stop results parquet file')
    parser.add_argument('--output-dir', type=Path, default=None, help='Output directory for reports (default: same as input)')
    parser.add_argument('--min-trades', type=int, default=10, help='Minimum trades per caller to include (default: 10)')
    parser.add_argument('--export-optimizer-config', action='store_true', help='Export optimizer configuration file')
    
    args = parser.parse_args()
    
    if not args.parquet_file.exists():
        print(f"Error: File not found: {args.parquet_file}", file=sys.stderr)
        sys.exit(1)
    
    # Set output directory
    output_dir = args.output_dir or args.parquet_file.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load data
    print(f"Loading data from {args.parquet_file}...")
    df = pd.read_parquet(args.parquet_file)
    print(f"Loaded {len(df)} trade records")
    print(f"Unique callers: {df['caller'].nunique()}")
    
    # Filter callers with minimum trades
    caller_counts = df['caller'].value_counts()
    valid_callers = caller_counts[caller_counts >= args.min_trades].index.tolist()
    print(f"Callers with >= {args.min_trades} trades: {len(valid_callers)}")
    
    # Analyze each caller
    print("\nAnalyzing caller performance...")
    analyses = []
    recommendations = []
    exit_suggestions = {}
    
    for caller in valid_callers:
        analysis = analyze_caller_performance(df, caller)
        if analysis and analysis['best_strategy']:
            analyses.append(analysis)
            rec = generate_recommendations(analysis)
            recommendations.append(rec)
            exit_suggestions[caller] = suggest_exit_strategies(analysis)
    
    # Generate output
    output_text = format_output(analyses, recommendations, exit_suggestions)
    
    # Write report
    report_path = output_dir / f"analysis_report_{args.parquet_file.stem}.txt"
    with open(report_path, 'w') as f:
        f.write(output_text)
    
    print("\nAnalysis complete!")
    print("Report written to: " + str(report_path))
    
    # Also print to console
    print("\n" + output_text)
    
    # Export optimizer config if requested
    if args.export_optimizer_config:
        config_path = output_dir / f"optimizer_config_{args.parquet_file.stem}.json"
        export_for_optimizer(analyses, config_path)
    
    # Export JSON data
    json_path = output_dir / f"analysis_data_{args.parquet_file.stem}.json"
    export_data = {
        'analyses': analyses,
        'recommendations': recommendations,
        'exit_suggestions': exit_suggestions,
    }
    with open(json_path, 'w') as f:
        json.dump(export_data, f, indent=2, default=str)
    print(f"Detailed data exported to: {json_path}")


if __name__ == '__main__':
    main()

