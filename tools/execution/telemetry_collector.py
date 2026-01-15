"""
Live telemetry collector for execution monitoring.

Ingests execution events and computes drift metrics to calibrate execution models.
"""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import json
import statistics


@dataclass
class SlippageEvent:
    """Slippage event."""
    timestamp: int
    run_id: str
    strategy_id: str
    mint: str
    side: str
    expected_slippage_bps: float
    actual_slippage_bps: float
    delta_bps: float


@dataclass
class LatencyEvent:
    """Latency event."""
    timestamp: int
    run_id: str
    strategy_id: str
    mint: str
    order_type: str
    expected_latency_ms: float
    actual_latency_ms: float
    delta_ms: float


@dataclass
class FailureEvent:
    """Failure event."""
    timestamp: int
    run_id: str
    strategy_id: str
    mint: str
    failure_type: str
    error_message: str
    expected_success_probability: float
    retry_attempts: int
    recovered: bool


def compute_telemetry_summary(
    slippage_events: List[Dict[str, Any]],
    latency_events: List[Dict[str, Any]],
    failure_events: List[Dict[str, Any]],
    run_id: str,
    strategy_id: str,
    window_start: int,
    window_end: int,
) -> Dict[str, Any]:
    """
    Compute telemetry summary from events.
    
    Args:
        slippage_events: List of slippage event dicts
        latency_events: List of latency event dicts
        failure_events: List of failure event dicts
        run_id: Run ID
        strategy_id: Strategy ID
        window_start: Window start timestamp (ms)
        window_end: Window end timestamp (ms)
    
    Returns:
        Telemetry summary dict
    """
    # Slippage metrics
    if slippage_events:
        avg_expected_bps = statistics.mean(e['expected_slippage_bps'] for e in slippage_events)
        avg_actual_bps = statistics.mean(e['actual_slippage_bps'] for e in slippage_events)
        avg_delta_bps = statistics.mean(e['delta_bps'] for e in slippage_events)
        std_dev_delta_bps = statistics.stdev(e['delta_bps'] for e in slippage_events) if len(slippage_events) > 1 else 0.0
        max_delta_bps = max(abs(e['delta_bps']) for e in slippage_events)
    else:
        avg_expected_bps = 0.0
        avg_actual_bps = 0.0
        avg_delta_bps = 0.0
        std_dev_delta_bps = 0.0
        max_delta_bps = 0.0
    
    # Latency metrics
    if latency_events:
        avg_expected_ms = statistics.mean(e['expected_latency_ms'] for e in latency_events)
        avg_actual_ms = statistics.mean(e['actual_latency_ms'] for e in latency_events)
        avg_delta_ms = statistics.mean(e['delta_ms'] for e in latency_events)
        std_dev_delta_ms = statistics.stdev(e['delta_ms'] for e in latency_events) if len(latency_events) > 1 else 0.0
        max_delta_ms = max(abs(e['delta_ms']) for e in latency_events)
    else:
        avg_expected_ms = 0.0
        avg_actual_ms = 0.0
        avg_delta_ms = 0.0
        std_dev_delta_ms = 0.0
        max_delta_ms = 0.0
    
    # Failure metrics
    total_failures = len(failure_events)
    total_attempts = len(slippage_events) + len(latency_events) + total_failures
    failure_rate = total_failures / total_attempts if total_attempts > 0 else 0.0
    
    failures_by_type = {}
    if failure_events:
        for event in failure_events:
            failure_type = event['failure_type']
            failures_by_type[failure_type] = failures_by_type.get(failure_type, 0) + 1
    
    recovered_count = sum(1 for e in failure_events if e['recovered'])
    recovery_rate = recovered_count / total_failures if total_failures > 0 else 0.0
    
    return {
        'run_id': run_id,
        'strategy_id': strategy_id,
        'window_start': window_start,
        'window_end': window_end,
        'slippage': {
            'avg_expected_bps': avg_expected_bps,
            'avg_actual_bps': avg_actual_bps,
            'avg_delta_bps': avg_delta_bps,
            'std_dev_delta_bps': std_dev_delta_bps,
            'max_delta_bps': max_delta_bps,
            'event_count': len(slippage_events),
        },
        'latency': {
            'avg_expected_ms': avg_expected_ms,
            'avg_actual_ms': avg_actual_ms,
            'avg_delta_ms': avg_delta_ms,
            'std_dev_delta_ms': std_dev_delta_ms,
            'max_delta_ms': max_delta_ms,
            'event_count': len(latency_events),
        },
        'failures': {
            'total_failures': total_failures,
            'failure_rate': failure_rate,
            'failures_by_type': failures_by_type,
            'recovery_rate': recovery_rate,
        },
    }


def generate_calibration_recommendations(
    summary: Dict[str, Any],
    confidence_threshold: float = 0.7,
) -> Dict[str, Any]:
    """
    Generate calibration recommendations based on telemetry summary.
    
    Args:
        summary: Telemetry summary
        confidence_threshold: Minimum confidence to recommend adjustment
    
    Returns:
        Calibration recommendations dict
    """
    recommendations = {
        'run_id': summary['run_id'],
        'strategy_id': summary['strategy_id'],
        'timestamp': summary['window_end'],
    }
    
    # Slippage adjustment
    slippage = summary['slippage']
    if slippage['event_count'] >= 10:  # Need sufficient data
        delta_bps = slippage['avg_delta_bps']
        std_dev = slippage['std_dev_delta_bps']
        
        # Significant drift if delta > 2 bps and consistent (low std dev)
        if abs(delta_bps) > 2.0:
            confidence = min(1.0, slippage['event_count'] / 50) * (1 - min(1.0, std_dev / abs(delta_bps)))
            
            if confidence >= confidence_threshold:
                recommendations['slippage_adjustment'] = {
                    'current_bps': slippage['avg_expected_bps'],
                    'recommended_bps': slippage['avg_actual_bps'],
                    'confidence': confidence,
                    'reason': f'Observed consistent slippage drift of {delta_bps:.2f} bps over {slippage["event_count"]} events',
                }
    
    # Latency adjustment
    latency = summary['latency']
    if latency['event_count'] >= 10:
        delta_ms = latency['avg_delta_ms']
        std_dev = latency['std_dev_delta_ms']
        
        # Significant drift if delta > 50ms and consistent
        if abs(delta_ms) > 50.0:
            confidence = min(1.0, latency['event_count'] / 50) * (1 - min(1.0, std_dev / abs(delta_ms)))
            
            if confidence >= confidence_threshold:
                recommendations['latency_adjustment'] = {
                    'current_ms': latency['avg_expected_ms'],
                    'recommended_ms': latency['avg_actual_ms'],
                    'confidence': confidence,
                    'reason': f'Observed consistent latency drift of {delta_ms:.0f}ms over {latency["event_count"]} events',
                }
    
    # Failure probability adjustment
    failures = summary['failures']
    total_events = slippage['event_count'] + latency['event_count'] + failures['total_failures']
    if total_events >= 20:
        actual_failure_rate = failures['failure_rate']
        
        # Significant drift if failure rate differs by > 5%
        # Assume expected failure rate was low (e.g., 1%)
        expected_failure_rate = 0.01
        delta_rate = actual_failure_rate - expected_failure_rate
        
        if abs(delta_rate) > 0.05:
            confidence = min(1.0, total_events / 100)
            
            if confidence >= confidence_threshold:
                recommendations['failure_probability_adjustment'] = {
                    'current_probability': expected_failure_rate,
                    'recommended_probability': actual_failure_rate,
                    'confidence': confidence,
                    'reason': f'Observed failure rate of {actual_failure_rate*100:.1f}% over {total_events} events',
                }
    
    return recommendations


def main():
    """CLI entry point."""
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description='Compute telemetry summary and calibration recommendations')
    parser.add_argument('--events-json', required=True, help='JSON file with telemetry events')
    parser.add_argument('--run-id', required=True, help='Run ID')
    parser.add_argument('--strategy-id', required=True, help='Strategy ID')
    parser.add_argument('--window-start', type=int, required=True, help='Window start timestamp (ms)')
    parser.add_argument('--window-end', type=int, required=True, help='Window end timestamp (ms)')
    
    args = parser.parse_args()
    
    # Load events
    with open(args.events_json, 'r') as f:
        events = json.load(f)
    
    slippage_events = events.get('slippage', [])
    latency_events = events.get('latency', [])
    failure_events = events.get('failures', [])
    
    # Compute summary
    summary = compute_telemetry_summary(
        slippage_events,
        latency_events,
        failure_events,
        args.run_id,
        args.strategy_id,
        args.window_start,
        args.window_end,
    )
    
    # Generate recommendations
    recommendations = generate_calibration_recommendations(summary)
    
    # Output JSON
    result = {
        'summary': summary,
        'recommendations': recommendations,
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()

