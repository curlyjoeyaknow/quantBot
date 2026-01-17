"""
Python Simulation Engine

Migrated from TypeScript simulation code to provide better integration with Python tooling.
This module implements the core simulation logic matching the TypeScript simulator contract.
"""

import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
import json
import logging

# Add workspace root to path for imports
# This allows importing from tools.backtest.lib.simulation
workspace_root = Path(__file__).parent.parent.parent.parent.parent
sys.path.insert(0, str(workspace_root))

from tools.backtest.lib.simulation.contracts import (
    SimInput,
    SimResult,
    SimEvent,
    SimMetrics,
    Candle,
    EntryConfig,
    ExitConfig,
    ReEntryConfig,
    CostConfig,
    CURRENT_CONTRACT_VERSION,
    SUPPORTED_CONTRACT_VERSIONS,
)
from tools.backtest.lib.simulation.entry import detect_entry
from tools.backtest.lib.simulation.reentry import validate_reentry_sequence
from tools.backtest.lib.simulation.trailing_stop import (
    init_trailing_stop_state,
    update_rolling_trailing_stop,
)

logger = logging.getLogger(__name__)


def get_entry_cost_multiplier(cost_config: Optional[CostConfig]) -> float:
    """Calculate entry cost multiplier (>1)."""
    if not cost_config:
        return 1.0
    entry_slippage_bps = cost_config.entrySlippageBps or 0
    taker_fee_bps = cost_config.takerFeeBps or 0
    return 1.0 + (entry_slippage_bps + taker_fee_bps) / 10_000


def get_exit_cost_multiplier(cost_config: Optional[CostConfig]) -> float:
    """Calculate exit cost multiplier (<1)."""
    if not cost_config:
        return 1.0
    exit_slippage_bps = cost_config.exitSlippageBps or 0
    taker_fee_bps = cost_config.takerFeeBps or 0
    return max(0.0, 1.0 - (exit_slippage_bps + taker_fee_bps) / 10_000)


def calculate_entry_price_with_costs(price: float, cost_config: Optional[CostConfig]) -> float:
    """Calculate entry price after costs (price you actually pay)."""
    if price <= 0 or not (price > 0 and price < float('inf')):
        return 0.0
    multiplier = get_entry_cost_multiplier(cost_config)
    result = price * multiplier
    return result if (result > 0 and result < float('inf')) else price


def calculate_exit_price_with_costs(price: float, cost_config: Optional[CostConfig]) -> float:
    """Calculate exit price after costs (price you actually receive)."""
    if price <= 0 or not (price > 0 and price < float('inf')):
        return 0.0
    multiplier = get_exit_cost_multiplier(cost_config)
    result = price * multiplier
    return max(0.0, result) if (result > 0 and result < float('inf')) else 0.0


class Simulator:
    """
    Python implementation of the simulation engine.
    
    Migrated from TypeScript simulateStrategy function to match the contract interface.
    """
    
    def __init__(self):
        """Initialize the simulator."""
        pass
    
    def simulate(self, sim_input: SimInput) -> SimResult:
        """
        Run simulation based on SimInput contract.
        
        Args:
            sim_input: Simulation input contract
            
        Returns:
            SimResult with simulation results
        """
        # Validate contract version
        if sim_input.contractVersion not in SUPPORTED_CONTRACT_VERSIONS:
            raise ValueError(
                f"Unsupported contract version: {sim_input.contractVersion}. "
                f"Supported versions: {SUPPORTED_CONTRACT_VERSIONS}"
            )
        
        # Handle empty candles
        if not sim_input.candles:
            return self._create_empty_result(sim_input.run_id, sim_input.candles)
        
        # Get cost multipliers
        entry_cost_multiplier = get_entry_cost_multiplier(sim_input.cost_config)
        exit_cost_multiplier = get_exit_cost_multiplier(sim_input.cost_config)
        
        # Handle entry logic (initial drop, trailing entry, etc.)
        entry_result = detect_entry(
            sim_input.candles,
            0,
            sim_input.entry_config,
        )
        
        if not entry_result['should_enter']:
            # No entry triggered - return no trade result
            return self._create_no_trade_result(
                sim_input.run_id,
                sim_input.candles,
                sim_input.candles[0].open if sim_input.candles else 0.0,
                sim_input.candles[-1].close if sim_input.candles else 0.0,
            )
        
        # Entry price from entry detection
        entry_price = entry_result['price']
        entry_candle_index = entry_result['candle_index']
        entry_price_with_costs = entry_price * entry_cost_multiplier
        
        # Slice candles from entry point
        candles_from_entry = sim_input.candles[entry_candle_index:]
        
        # Initialize state
        events: List[SimEvent] = []
        remaining = 1.0
        target_index = 0
        pnl = 0.0
        
        # Stop loss configuration
        stop_loss_config = sim_input.exit_config.stop_loss
        if stop_loss_config:
            stop_loss_price = entry_price * (1.0 + stop_loss_config.initial)
            stop_moved_to_entry = False
            has_trailing = stop_loss_config.trailing != 'none' and stop_loss_config.trailing is not None
        else:
            stop_loss_price = float('inf')
            stop_moved_to_entry = False
            has_trailing = False
        
        # Track price extremes
        lowest_price = entry_price
        lowest_price_timestamp = candles_from_entry[0].timestamp if candles_from_entry else entry_result['timestamp']
        current_peak_price = entry_price
        
        # Re-entry state
        reentry_config = sim_input.reentry_config
        reentry_count = 0
        waiting_for_reentry = False
        reentry_trigger_price = 0.0
        last_exit_index = -1
        
        # Rolling trailing stop state
        trailing_stop_state = None
        if stop_loss_config and stop_loss_config.trailingWindowSize is not None:
            trailing_stop_state = init_trailing_stop_state(entry_price, stop_loss_config)
        
        # Main simulation loop
        for i, candle in enumerate(candles_from_entry):
            # Track price extremes
            if candle.low < lowest_price:
                lowest_price = candle.low
                lowest_price_timestamp = candle.timestamp
            
            if candle.high > current_peak_price:
                current_peak_price = candle.high
            
            # Update rolling trailing stop if enabled
            if trailing_stop_state is not None and stop_loss_config:
                trailing_percent = stop_loss_config.trailingPercent if stop_loss_config.trailingPercent else 0.25
                window_size = stop_loss_config.trailingWindowSize
                trailing_stop_state = update_rolling_trailing_stop(
                    trailing_stop_state,
                    candle,
                    i,
                    trailing_percent,
                    window_size,
                )
                stop_loss_price = trailing_stop_state['current_stop']
            elif has_trailing and stop_loss_config and not stop_moved_to_entry:
                # Legacy trailing stop activation
                trailing_trigger = entry_price * (1.0 + stop_loss_config.trailing)
                if candle.high >= trailing_trigger:
                    stop_loss_price = entry_price
                    stop_moved_to_entry = True
                    events.append(SimEvent(
                        event_type='stop_moved',
                        timestamp=candle.timestamp,
                        price=candle.high,
                        quantity=0.0,
                        value_usd=0.0,
                        fee_usd=0.0,
                        position_size=remaining,
                        pnl_usd=pnl,
                        cumulative_pnl_usd=pnl,
                    ))
            
            # Check re-entry (before stop loss check)
            if waiting_for_reentry and candle.low <= reentry_trigger_price:
                # Validate sequential ordering
                if last_exit_index >= 0:
                    is_valid = validate_reentry_sequence(
                        candles_from_entry,
                        last_exit_index,
                        i,
                        stop_loss_price,
                    )
                    if not is_valid:
                        # Stop loss was hit between exit and re-entry, reject re-entry
                        events.append(SimEvent(
                            event_type='re_entry_rejected',
                            timestamp=candle.timestamp,
                            price=reentry_trigger_price,
                            quantity=0.0,
                            value_usd=0.0,
                            fee_usd=0.0,
                            position_size=remaining,
                            pnl_usd=pnl,
                            cumulative_pnl_usd=pnl,
                        ))
                        waiting_for_reentry = False
                        break
                
                # Execute re-entry
                remaining = min(1.0, remaining + reentry_config.sizePercent)
                reentry_count += 1
                waiting_for_reentry = False
                stop_loss_price = reentry_trigger_price * (1.0 + stop_loss_config.initial)
                stop_moved_to_entry = False
                current_peak_price = reentry_trigger_price
                
                # Reset trailing stop state for new entry
                if trailing_stop_state is not None:
                    trailing_stop_state = init_trailing_stop_state(reentry_trigger_price, stop_loss_config)
                
                events.append(SimEvent(
                    event_type='re_entry',
                    timestamp=candle.timestamp,
                    price=reentry_trigger_price,
                    quantity=reentry_config.sizePercent,
                    value_usd=reentry_trigger_price * reentry_config.sizePercent,
                    fee_usd=0.0,
                    position_size=remaining,
                    pnl_usd=pnl,
                    cumulative_pnl_usd=pnl,
                ))
                continue
            
            # Check stop loss (before profit targets - sequential detection)
            if remaining > 0 and stop_loss_config:
                # Get target price for sequential detection
                target_price = float('inf')
                if target_index < len(sim_input.exit_config.profit_targets):
                    target_price = entry_price * sim_input.exit_config.profit_targets[target_index].target
                
                # Sequential detection: check if stop loss was hit before target
                stop_hit = candle.low <= stop_loss_price
                target_hit = candle.high >= target_price
                
                # If both hit in same candle, stop loss takes precedence
                if stop_hit:
                    # Execute stop loss
                    exit_price = calculate_exit_price_with_costs(stop_loss_price, sim_input.cost_config)
                    stop_component = (exit_price / entry_price_with_costs) * remaining
                    pnl += stop_component
                    
                    events.append(SimEvent(
                        event_type='stop_loss',
                        timestamp=candle.timestamp,
                        price=stop_loss_price,
                        quantity=remaining,
                        value_usd=stop_loss_price * remaining,
                        fee_usd=(stop_loss_price * remaining) - (exit_price * remaining),
                        position_size=0.0,
                        pnl_usd=stop_component - remaining,
                        cumulative_pnl_usd=pnl,
                    ))
                    remaining = 0.0
                    last_exit_index = i
                    
                    # Check for re-entry possibility
                    if (reentry_config and 
                        reentry_config.trailingReEntry != 'none' and 
                        reentry_count < reentry_config.maxReEntries):
                        reentry_trigger_price = entry_price * (1.0 - reentry_config.trailingReEntry)
                        waiting_for_reentry = True
                    else:
                        break
                    continue  # Skip target check since stop was hit first
            
            # Check profit targets (only if stop not hit)
            if remaining > 0 and target_index < len(sim_input.exit_config.profit_targets):
                profit_target = sim_input.exit_config.profit_targets[target_index]
                target_price = entry_price * profit_target.target
                
                if candle.high >= target_price:
                    # Execute profit target
                    exit_price = calculate_exit_price_with_costs(target_price, sim_input.cost_config)
                    target_pnl = profit_target.percent * (exit_price / entry_price_with_costs)
                    pnl += target_pnl
                    remaining = max(0.0, remaining - profit_target.percent)
                    
                    events.append(SimEvent(
                        event_type='target_hit',
                        timestamp=candle.timestamp,
                        price=target_price,
                        quantity=profit_target.percent,
                        value_usd=target_price * profit_target.percent,
                        fee_usd=(target_price * profit_target.percent) - (exit_price * profit_target.percent),
                        position_size=remaining,
                        pnl_usd=target_pnl - profit_target.percent,
                        cumulative_pnl_usd=pnl,
                    ))
                    target_index += 1
                    last_exit_index = i
                    
                    # Setup re-entry after target
                    if (reentry_config and 
                        reentry_config.trailingReEntry != 'none' and 
                        reentry_count < reentry_config.maxReEntries):
                        reentry_trigger_price = target_price * (1.0 - reentry_config.trailingReEntry)
                        waiting_for_reentry = True
        
        # Final exit if position remains
        if remaining > 0:
            final_price = candles_from_entry[-1].close if candles_from_entry else sim_input.candles[-1].close
            exit_price = calculate_exit_price_with_costs(final_price, sim_input.cost_config)
            final_component = remaining * (exit_price / entry_price_with_costs)
            pnl += final_component
            
            final_candle = candles_from_entry[-1] if candles_from_entry else sim_input.candles[-1]
            events.append(SimEvent(
                event_type='final_exit',
                timestamp=final_candle.timestamp,
                price=final_price,
                quantity=remaining,
                value_usd=final_price * remaining,
                fee_usd=(final_price * remaining) - (exit_price * remaining),
                position_size=0.0,
                pnl_usd=final_component - remaining,
                cumulative_pnl_usd=pnl,
            ))
        
        # Add entry event at the beginning (if not already added)
        if not any(e.event_type == 'entry' for e in events):
            entry_candle = candles_from_entry[0] if candles_from_entry else sim_input.candles[0]
            entry_event = SimEvent(
                event_type='entry',
                timestamp=entry_candle.timestamp,
                price=entry_price,
                quantity=1.0,
                value_usd=entry_price,
                fee_usd=entry_price_with_costs - entry_price,
                pnl_usd=0.0,
                cumulative_pnl_usd=0.0,
                position_size=1.0,
            )
            events.insert(0, entry_event)
        
        # Calculate final PnL multiplier
        final_pnl = pnl
        
        # Create metrics
        metrics = SimMetrics(
            max_drawdown=None,
            sharpe_ratio=None,
            win_rate=1.0 if final_pnl > 1.0 else 0.0,
            total_trades=len([e for e in events if e.event_type in ['target_hit', 'stop_loss', 'final_exit']]),
            profit_factor=None,
            average_win=None,
            average_loss=None,
        )
        
        return SimResult(
            run_id=sim_input.run_id,
            final_pnl=final_pnl,
            events=events,
            entry_price=entry_price,
            final_price=candles_from_entry[-1].close if candles_from_entry else sim_input.candles[-1].close,
            total_candles=len(candles_from_entry) if candles_from_entry else len(sim_input.candles),
            metrics=metrics,
        )
    
    def _create_no_trade_result(
        self,
        run_id: str,
        candles: List[Candle],
        initial_price: float,
        final_price: float,
    ) -> SimResult:
        """Create a no-trade result (entry conditions not met)."""
        return SimResult(
            run_id=run_id,
            final_pnl=1.0,  # No trade = no PnL change
            events=[],
            entry_price=initial_price,
            final_price=final_price,
            total_candles=len(candles),
            metrics=SimMetrics(),
        )
    
    def _create_empty_result(self, run_id: str, candles: List[Candle]) -> SimResult:
        """Create an empty result for empty candle list."""
        if candles:
            final_price = candles[-1].close
        else:
            final_price = 0.0
        
        return SimResult(
            run_id=run_id,
            final_pnl=1.0,
            events=[],
            entry_price=0.0,
            final_price=final_price,
            total_candles=len(candles),
            metrics=SimMetrics(),
        )


def simulate_strategy(sim_input: SimInput) -> SimResult:
    """
    Convenience function to run simulation.
    
    Args:
        sim_input: Simulation input contract
        
    Returns:
        SimResult with simulation results
    """
    simulator = Simulator()
    return simulator.simulate(sim_input)


def main():
    """
    CLI entry point for running simulations.
    Reads SimInput from stdin (JSON), writes SimResult to stdout (JSON).
    """
    try:
        # Read input from stdin
        input_json = json.load(sys.stdin)
        
        # Parse SimInput
        sim_input = SimInput.from_dict(input_json)
        
        # Run simulation
        result = simulate_strategy(sim_input)
        
        # Write result to stdout
        print(json.dumps(result.to_dict(), indent=2))
        
    except Exception as e:
        logger.error(f"Simulation failed: {e}", exc_info=True)
        error_result = {
            'error': str(e),
            'run_id': input_json.get('run_id', 'unknown') if 'input_json' in locals() else 'unknown',
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == '__main__':
    main()
