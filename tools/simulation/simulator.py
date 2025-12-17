"""
DuckDB-based simulation engine for backtesting trading strategies.
"""

import duckdb
import json
import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import logging

from .sql_functions import setup_simulation_schema

# Import canonical contracts
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / 'telegram' / 'simulation'))
from contracts import SimInput, SimResult, SimEvent, SimMetrics

logger = logging.getLogger(__name__)

@dataclass
class StrategyConfig:
    """Configuration for a trading strategy."""
    strategy_id: str
    name: str
    entry_type: str  # 'immediate'|'drop'|'trailing'
    profit_targets: List[Dict[str, float]]  # [{target: 2.0, percent: 0.5}, ...]
    stop_loss_pct: Optional[float] = None
    trailing_stop_pct: Optional[float] = None
    trailing_activation_pct: Optional[float] = None
    reentry_config: Optional[Dict[str, Any]] = None
    maker_fee: float = 0.001
    taker_fee: float = 0.001
    slippage: float = 0.005
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

@dataclass
class SimulationEvent:
    """A single simulation event (entry, exit, etc.)."""
    event_type: str  # 'entry'|'exit'|'stop_loss'|'reentry'
    timestamp: datetime
    price: float
    quantity: float
    value_usd: float
    fee_usd: float
    pnl_usd: float = 0.0
    cumulative_pnl_usd: float = 0.0
    position_size: float = 0.0
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            'event_type': self.event_type,
            'timestamp': self.timestamp.isoformat(),
            'price': self.price,
            'quantity': self.quantity,
            'value_usd': self.value_usd,
            'fee_usd': self.fee_usd,
            'pnl_usd': self.pnl_usd,
            'cumulative_pnl_usd': self.cumulative_pnl_usd,
            'position_size': self.position_size,
            'metadata': self.metadata or {}
        }

class DuckDBSimulator:
    """Run simulations directly in DuckDB using SQL."""
    
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        setup_simulation_schema(con)
    
    def run_simulation(
        self,
        strategy: StrategyConfig,
        mint: str,
        alert_timestamp: datetime,
        initial_capital: float = 1000.0,
        lookback_minutes: int = 260,  # Pre-alert window
        lookforward_minutes: int = 1440  # Post-alert window
    ) -> Dict[str, Any]:
        """
        Run a complete simulation for a single token/alert.
        
        Returns:
            {
                'run_id': str,
                'final_capital': float,
                'total_return_pct': float,
                'max_drawdown_pct': float,
                'sharpe_ratio': float,
                'win_rate': float,
                'total_trades': int,
                'events': List[Dict]
            }
        """
        try:
            # 1. Fetch candles for time window
            candles = self._fetch_candles(
                mint, alert_timestamp, lookback_minutes, lookforward_minutes
            )
            
            if not candles:
                return {
                    'run_id': None,
                    'error': 'No candles available for simulation',
                    'mint': mint,
                    'alert_timestamp': alert_timestamp.isoformat()
                }
            
            # 2. Execute entry logic
            entry_event = self._execute_entry(strategy, alert_timestamp, candles)
            
            if not entry_event:
                return {
                    'run_id': None,
                    'error': 'Failed to execute entry',
                    'mint': mint,
                    'alert_timestamp': alert_timestamp.isoformat()
                }
            
            # 3. Execute exit logic (profit targets, stop loss, trailing stop)
            exit_events = self._execute_exits(strategy, entry_event, candles)
            
            # 4. Calculate metrics
            metrics = self._calculate_metrics(
                entry_event, exit_events, initial_capital, candles
            )
            
            # 5. Store results
            run_id = self._store_simulation_run(
                strategy, mint, alert_timestamp, metrics, lookback_minutes, lookforward_minutes
            )
            
            if run_id:
                all_events = [entry_event] + exit_events
                self._store_simulation_events(run_id, all_events)
            
            return {
                'run_id': run_id,
                **metrics,
                'events': [e.to_dict() for e in [entry_event] + exit_events]
            }
        except Exception as e:
            logger.error(f"Simulation failed for {mint} at {alert_timestamp}: {e}", exc_info=True)
            return {
                'run_id': None,
                'error': str(e),
                'mint': mint,
                'alert_timestamp': alert_timestamp.isoformat()
            }
    
    def batch_simulate(
        self,
        strategy: StrategyConfig,
        mints: List[str],
        alert_timestamps: List[datetime],
        initial_capital: float = 1000.0
    ) -> List[Dict[str, Any]]:
        """Run simulations for multiple tokens in parallel."""
        results = []
        for mint, alert_ts in zip(mints, alert_timestamps):
            try:
                result = self.run_simulation(strategy, mint, alert_ts, initial_capital)
                results.append(result)
            except Exception as e:
                logger.error(f"Simulation failed for {mint} at {alert_ts}: {e}")
                results.append({
                    'error': str(e),
                    'mint': mint,
                    'alert_timestamp': alert_ts.isoformat()
                })
        return results
    
    def _fetch_candles(
        self,
        mint: str,
        alert_timestamp: datetime,
        lookback_minutes: int,
        lookforward_minutes: int
    ) -> List[Dict[str, Any]]:
        """Fetch candles for the simulation window."""
        start_time = alert_timestamp - timedelta(minutes=lookback_minutes)
        end_time = alert_timestamp + timedelta(minutes=lookforward_minutes)
        
        start_ts = int(start_time.timestamp())
        end_ts = int(end_time.timestamp())
        
        # Try to fetch from ohlcv_candles_d table
        result = self.con.execute("""
            SELECT 
                timestamp,
                open,
                high,
                low,
                close,
                volume,
                interval_seconds
            FROM ohlcv_candles_d
            WHERE mint = ? 
              AND timestamp >= ? 
              AND timestamp <= ?
            ORDER BY timestamp ASC
        """, [mint, start_ts, end_ts]).fetchall()
        
        if result:
            return [
                {
                    'timestamp': datetime.fromtimestamp(row[0]),
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': float(row[5]),
                    'interval_seconds': int(row[6])
                }
                for row in result
            ]
        
        # Fallback: try to get price from user_calls_d
        price_result = self.con.execute("""
            SELECT price_usd
            FROM user_calls_d
            WHERE mint = ? AND call_ts_ms = ?
        """, [mint, int(alert_timestamp.timestamp() * 1000)]).fetchone()
        
        if price_result and price_result[0]:
            # Create a single candle at alert time
            price = float(price_result[0])
            return [{
                'timestamp': alert_timestamp,
                'open': price,
                'high': price,
                'low': price,
                'close': price,
                'volume': 0.0,
                'interval_seconds': 60
            }]
        
        return []
    
    def _execute_entry(
        self,
        strategy: StrategyConfig,
        alert_ts: datetime,
        candles: List[Dict[str, Any]]
    ) -> Optional[SimulationEvent]:
        """Execute entry logic based on strategy type."""
        if strategy.entry_type == 'immediate':
            # Entry at alert time price
            entry_price = self._get_price_at_timestamp(candles, alert_ts)
            if entry_price is None:
                return None
            
            quantity = 1.0  # Normalized
            value_usd = entry_price * quantity
            fee_usd = value_usd * strategy.maker_fee
            
            return SimulationEvent(
                event_type='entry',
                timestamp=alert_ts,
                price=entry_price,
                quantity=quantity,
                value_usd=value_usd,
                fee_usd=fee_usd,
                position_size=quantity
            )
        elif strategy.entry_type == 'drop':
            return self._execute_drop_entry(strategy, alert_ts, candles)
        elif strategy.entry_type == 'trailing':
            return self._execute_trailing_entry(strategy, alert_ts, candles)
        else:
            logger.warning(f"Unknown entry type: {strategy.entry_type}")
            return None
    
    def _execute_drop_entry(
        self,
        strategy: StrategyConfig,
        alert_ts: datetime,
        candles: List[Dict[str, Any]]
    ) -> Optional[SimulationEvent]:
        """Execute drop-based entry (entry on price drop)."""
        # For now, fallback to immediate entry
        # TODO: Implement drop entry logic
        return self._execute_entry(
            StrategyConfig(
                strategy_id=strategy.strategy_id,
                name=strategy.name,
                entry_type='immediate',
                profit_targets=strategy.profit_targets,
                stop_loss_pct=strategy.stop_loss_pct
            ),
            alert_ts,
            candles
        )
    
    def _execute_trailing_entry(
        self,
        strategy: StrategyConfig,
        alert_ts: datetime,
        candles: List[Dict[str, Any]]
    ) -> Optional[SimulationEvent]:
        """Execute trailing entry (entry on trailing condition)."""
        # For now, fallback to immediate entry
        # TODO: Implement trailing entry logic
        return self._execute_entry(
            StrategyConfig(
                strategy_id=strategy.strategy_id,
                name=strategy.name,
                entry_type='immediate',
                profit_targets=strategy.profit_targets,
                stop_loss_pct=strategy.stop_loss_pct
            ),
            alert_ts,
            candles
        )
    
    def _execute_exits(
        self,
        strategy: StrategyConfig,
        entry_event: SimulationEvent,
        candles: List[Dict[str, Any]]
    ) -> List[SimulationEvent]:
        """Execute exit logic: profit targets, stop loss, trailing stop."""
        exit_events = []
        entry_price = entry_event.price
        entry_ts = entry_event.timestamp
        
        # Filter candles after entry
        post_entry_candles = [
            c for c in candles 
            if c['timestamp'] > entry_ts
        ]
        
        if not post_entry_candles:
            return []
        
        # Check profit targets
        for target in strategy.profit_targets:
            exit_event = self._check_profit_target(
                entry_price, target, post_entry_candles, strategy, entry_event
            )
            if exit_event:
                exit_events.append(exit_event)
        
        # Check stop loss
        if strategy.stop_loss_pct:
            stop_event = self._check_stop_loss(
                entry_price, strategy.stop_loss_pct, post_entry_candles, strategy, entry_event
            )
            if stop_event:
                exit_events.append(stop_event)
        
        # Check trailing stop
        if strategy.trailing_stop_pct and strategy.trailing_activation_pct:
            trailing_event = self._check_trailing_stop(
                entry_price, strategy.trailing_stop_pct,
                strategy.trailing_activation_pct, post_entry_candles, strategy, entry_event
            )
            if trailing_event:
                exit_events.append(trailing_event)
        
        # Sort by timestamp, take first exit
        exit_events.sort(key=lambda e: e.timestamp)
        return exit_events[:1] if exit_events else []
    
    def _check_profit_target(
        self,
        entry_price: float,
        target: Dict[str, float],
        candles: List[Dict[str, Any]],
        strategy: StrategyConfig,
        entry_event: SimulationEvent
    ) -> Optional[SimulationEvent]:
        """Check if profit target is hit."""
        target_price = entry_price * target['target']
        target_percent = target.get('percent', 1.0)
        
        for candle in candles:
            # Check if high price reached target
            if candle['high'] >= target_price:
                exit_price = target_price
                quantity = entry_event.quantity * target_percent
                value_usd = exit_price * quantity
                fee_usd = value_usd * strategy.taker_fee
                
                # Calculate PnL
                entry_value = entry_price * quantity
                pnl_usd = value_usd - entry_value - fee_usd - entry_event.fee_usd
                
                return SimulationEvent(
                    event_type='exit',
                    timestamp=candle['timestamp'],
                    price=exit_price,
                    quantity=quantity,
                    value_usd=value_usd,
                    fee_usd=fee_usd,
                    pnl_usd=pnl_usd,
                    cumulative_pnl_usd=pnl_usd,
                    position_size=quantity,
                    metadata={
                        'target_hit': target['target'],
                        'reason': 'profit_target',
                        'percent_exited': target_percent
                    }
                )
        
        return None
    
    def _check_stop_loss(
        self,
        entry_price: float,
        stop_loss_pct: float,
        candles: List[Dict[str, Any]],
        strategy: StrategyConfig,
        entry_event: SimulationEvent
    ) -> Optional[SimulationEvent]:
        """Check if stop loss is hit."""
        stop_price = entry_price * (1 - stop_loss_pct)
        
        for candle in candles:
            # Check if low price hit stop loss
            if candle['low'] <= stop_price:
                exit_price = stop_price
                quantity = entry_event.quantity
                value_usd = exit_price * quantity
                fee_usd = value_usd * strategy.taker_fee
                
                # Calculate PnL
                entry_value = entry_price * quantity
                pnl_usd = value_usd - entry_value - fee_usd - entry_event.fee_usd
                
                return SimulationEvent(
                    event_type='stop_loss',
                    timestamp=candle['timestamp'],
                    price=exit_price,
                    quantity=quantity,
                    value_usd=value_usd,
                    fee_usd=fee_usd,
                    pnl_usd=pnl_usd,
                    cumulative_pnl_usd=pnl_usd,
                    position_size=quantity,
                    metadata={
                        'stop_loss_pct': stop_loss_pct,
                        'reason': 'stop_loss'
                    }
                )
        
        return None
    
    def _check_trailing_stop(
        self,
        entry_price: float,
        trailing_stop_pct: float,
        activation_pct: float,
        candles: List[Dict[str, Any]],
        strategy: StrategyConfig,
        entry_event: SimulationEvent
    ) -> Optional[SimulationEvent]:
        """Check if trailing stop is hit."""
        # Trailing stop activates after price moves up by activation_pct
        activation_price = entry_price * (1 + activation_pct)
        highest_price = entry_price
        trailing_stop_price = entry_price * (1 - trailing_stop_pct)
        activated = False
        
        for candle in candles:
            # Update highest price
            if candle['high'] > highest_price:
                highest_price = candle['high']
            
            # Activate trailing stop if price reached activation level
            if not activated and highest_price >= activation_price:
                activated = True
                trailing_stop_price = highest_price * (1 - trailing_stop_pct)
            
            # Update trailing stop if activated
            if activated:
                new_trailing_stop = highest_price * (1 - trailing_stop_pct)
                if new_trailing_stop > trailing_stop_price:
                    trailing_stop_price = new_trailing_stop
            
            # Check if trailing stop hit
            if activated and candle['low'] <= trailing_stop_price:
                exit_price = trailing_stop_price
                quantity = entry_event.quantity
                value_usd = exit_price * quantity
                fee_usd = value_usd * strategy.taker_fee
                
                # Calculate PnL
                entry_value = entry_price * quantity
                pnl_usd = value_usd - entry_value - fee_usd - entry_event.fee_usd
                
                return SimulationEvent(
                    event_type='exit',
                    timestamp=candle['timestamp'],
                    price=exit_price,
                    quantity=quantity,
                    value_usd=value_usd,
                    fee_usd=fee_usd,
                    pnl_usd=pnl_usd,
                    cumulative_pnl_usd=pnl_usd,
                    position_size=quantity,
                    metadata={
                        'trailing_stop_pct': trailing_stop_pct,
                        'activation_pct': activation_pct,
                        'highest_price': highest_price,
                        'reason': 'trailing_stop'
                    }
                )
        
        return None
    
    def _calculate_metrics(
        self,
        entry_event: SimulationEvent,
        exit_events: List[SimulationEvent],
        initial_capital: float,
        candles: List[Dict[str, Any]]
    ) -> Dict[str, float]:
        """Calculate simulation metrics."""
        if not exit_events:
            return {
                'final_capital': initial_capital,
                'total_return_pct': 0.0,
                'max_drawdown_pct': 0.0,
                'sharpe_ratio': 0.0,
                'win_rate': 0.0,
                'total_trades': 0
            }
        
        exit_event = exit_events[0]
        entry_price = entry_event.price
        exit_price = exit_event.price
        
        # Calculate return
        return_pct = ((exit_price - entry_price) / entry_price) * 100
        final_capital = initial_capital * (1 + return_pct / 100)
        
        # Calculate drawdown
        max_drawdown_pct = self._calculate_drawdown(entry_price, exit_price, candles, entry_event.timestamp)
        
        # Calculate Sharpe ratio (simplified - would need returns series)
        sharpe_ratio = 0.0  # TODO: implement with returns series
        
        return {
            'final_capital': final_capital,
            'total_return_pct': return_pct,
            'max_drawdown_pct': max_drawdown_pct,
            'sharpe_ratio': sharpe_ratio,
            'win_rate': 1.0 if return_pct > 0 else 0.0,
            'total_trades': 1
        }
    
    def _calculate_drawdown(
        self,
        entry_price: float,
        exit_price: float,
        candles: List[Dict[str, Any]],
        entry_timestamp: datetime
    ) -> float:
        """Calculate maximum drawdown percentage."""
        post_entry_candles = [c for c in candles if c['timestamp'] > entry_timestamp]
        
        if not post_entry_candles:
            return 0.0
        
        max_price = entry_price
        max_drawdown = 0.0
        
        for candle in post_entry_candles:
            if candle['high'] > max_price:
                max_price = candle['high']
            
            drawdown = (max_price - candle['low']) / max_price
            if drawdown > max_drawdown:
                max_drawdown = drawdown
        
        return max_drawdown * 100
    
    def _get_price_at_timestamp(
        self,
        candles: List[Dict[str, Any]],
        timestamp: datetime
    ) -> Optional[float]:
        """Get price at a specific timestamp."""
        # Find closest candle
        closest_candle = None
        min_diff = None
        
        for candle in candles:
            diff = abs((candle['timestamp'] - timestamp).total_seconds())
            if min_diff is None or diff < min_diff:
                min_diff = diff
                closest_candle = candle
        
        if closest_candle:
            return closest_candle['close']
        
        return None
    
    def _store_simulation_run(
        self,
        strategy: StrategyConfig,
        mint: str,
        alert_timestamp: datetime,
        metrics: Dict[str, float],
        lookback_minutes: int,
        lookforward_minutes: int
    ) -> Optional[str]:
        """Store simulation run in database."""
        run_id = str(uuid.uuid4())
        start_time = alert_timestamp - timedelta(minutes=lookback_minutes)
        end_time = alert_timestamp + timedelta(minutes=lookforward_minutes)
        
        try:
            self.con.execute("""
                INSERT INTO simulation_runs
                (run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                 initial_capital, final_capital, total_return_pct, max_drawdown_pct,
                 sharpe_ratio, win_rate, total_trades)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run_id,
                strategy.strategy_id,
                mint,
                alert_timestamp,
                start_time,
                end_time,
                1000.0,  # initial_capital (hardcoded for now)
                metrics.get('final_capital', 1000.0),
                metrics.get('total_return_pct', 0.0),
                metrics.get('max_drawdown_pct', 0.0),
                metrics.get('sharpe_ratio', 0.0),
                metrics.get('win_rate', 0.0),
                metrics.get('total_trades', 0)
            ])
            self.con.commit()
            return run_id
        except Exception as e:
            logger.error(f"Failed to store simulation run: {e}")
            return None
    
    def _store_simulation_events(
        self,
        run_id: str,
        events: List[SimulationEvent]
    ) -> None:
        """Store simulation events in database."""
        for event in events:
            event_id = str(uuid.uuid4())
            try:
                self.con.execute("""
                    INSERT INTO simulation_events
                    (event_id, run_id, event_type, timestamp, price, quantity,
                     value_usd, fee_usd, pnl_usd, cumulative_pnl_usd, position_size, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    event_id,
                    run_id,
                    event.event_type,
                    event.timestamp,
                    event.price,
                    event.quantity,
                    event.value_usd,
                    event.fee_usd,
                    event.pnl_usd,
                    event.cumulative_pnl_usd,
                    event.position_size,
                    json.dumps(event.metadata) if event.metadata else None
                ])
            except Exception as e:
                logger.error(f"Failed to store simulation event: {e}")
        
        self.con.commit()
    
    def run_from_contract(self, sim_input: 'SimInput') -> 'SimResult':
        """
        Run simulation from canonical SimInput contract.
        
        This method accepts a canonical SimInput and returns a canonical SimResult,
        ensuring compatibility with the TypeScript simulator.
        
        Args:
            sim_input: Canonical simulation input (from contracts module)
            
        Returns:
            Canonical simulation result
        """
        try:
            # Import contracts here to avoid circular imports
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).parent.parent / 'telegram' / 'simulation'))
            from contracts import SimInput, SimResult, SimEvent, SimMetrics
            
            # Convert SimInput to internal format
            alert_timestamp = datetime.fromisoformat(sim_input.alert_timestamp.replace('Z', '+00:00'))
            
            # Convert candles to internal format
            candles = []
            for c in sim_input.candles:
                candles.append({
                    'timestamp': datetime.fromtimestamp(c.timestamp),
                    'open': c.open,
                    'high': c.high,
                    'low': c.low,
                    'close': c.close,
                    'volume': c.volume,
                    'interval_seconds': 300,  # Default 5m
                })
            
            # Convert entry config
            entry_type = 'immediate'
            if sim_input.entry_config.initialEntry != 'none':
                entry_type = 'drop'
            elif sim_input.entry_config.trailingEntry != 'none':
                entry_type = 'trailing'
            
            # Convert exit config to StrategyConfig
            profit_targets = [
                {'target': pt.target, 'percent': pt.percent}
                for pt in sim_input.exit_config.profit_targets
            ]
            
            stop_loss_pct = None
            if sim_input.exit_config.stop_loss:
                stop_loss_pct = abs(sim_input.exit_config.stop_loss.initial)
            
            strategy = StrategyConfig(
                strategy_id=sim_input.strategy_id,
                name=sim_input.strategy_id,
                entry_type=entry_type,
                profit_targets=profit_targets,
                stop_loss_pct=stop_loss_pct,
                trailing_stop_pct=sim_input.exit_config.stop_loss.trailingPercent if sim_input.exit_config.stop_loss and sim_input.exit_config.stop_loss.trailingPercent else None,
                reentry_config=sim_input.reentry_config.to_dict() if sim_input.reentry_config else None,
                maker_fee=(sim_input.cost_config.makerFeeBps / 10000) if sim_input.cost_config and sim_input.cost_config.makerFeeBps else 0.001,
                taker_fee=(sim_input.cost_config.takerFeeBps / 10000) if sim_input.cost_config and sim_input.cost_config.takerFeeBps else 0.001,
                slippage=(sim_input.cost_config.entrySlippageBps / 10000) if sim_input.cost_config and sim_input.cost_config.entrySlippageBps else 0.005,
            )
            
            # Run simulation using existing method with provided candles
            result = self._run_simulation_with_candles(
                strategy, sim_input.mint, alert_timestamp, candles
            )
            
            if 'error' in result:
                # Return error result
                return SimResult(
                    run_id=sim_input.run_id,
                    final_pnl=0.0,
                    events=[],
                    entry_price=0.0,
                    final_price=0.0,
                    total_candles=len(sim_input.candles),
                    metrics=SimMetrics(),
                )
            
            # Convert result to canonical format
            events = []
            for e in result.get('events', []):
                event_ts = e.get('timestamp')
                if isinstance(event_ts, datetime):
                    ts_int = int(event_ts.timestamp())
                elif isinstance(event_ts, str):
                    ts_int = int(datetime.fromisoformat(event_ts.replace('Z', '+00:00')).timestamp())
                else:
                    ts_int = int(event_ts) if event_ts else 0
                
                event = SimEvent(
                    event_type=e.get('event_type', 'unknown'),
                    timestamp=ts_int,
                    price=float(e.get('price', 0.0)),
                    quantity=float(e.get('quantity', 0.0)),
                    value_usd=float(e.get('value_usd', 0.0)),
                    fee_usd=float(e.get('fee_usd', 0.0)),
                    pnl_usd=e.get('pnl_usd'),
                    cumulative_pnl_usd=e.get('cumulative_pnl_usd'),
                    position_size=float(e.get('position_size', 0.0)),
                    metadata=e.get('metadata'),
                )
                events.append(event)
            
            # Calculate final PnL from events
            final_pnl = 1.0
            if events:
                last_event = events[-1]
                if last_event.cumulative_pnl_usd is not None:
                    # Convert to multiplier (assuming initial capital of 1.0)
                    final_pnl = 1.0 + (last_event.cumulative_pnl_usd / 1.0)
            
            entry_price = float(result.get('entry_price', 0.0))
            final_price = float(result.get('final_price', entry_price))
            
            metrics = SimMetrics(
                max_drawdown=result.get('max_drawdown_pct') / 100.0 if result.get('max_drawdown_pct') else None,
                sharpe_ratio=result.get('sharpe_ratio'),
                win_rate=result.get('win_rate'),
                total_trades=result.get('total_trades'),
            )
            
            return SimResult(
                run_id=sim_input.run_id,
                final_pnl=final_pnl,
                events=events,
                entry_price=entry_price,
                final_price=final_price,
                total_candles=len(sim_input.candles),
                metrics=metrics,
            )
        except Exception as e:
            logger.error(f"Failed to run simulation from contract: {e}", exc_info=True)
            # Import here to avoid issues if import fails
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).parent.parent / 'telegram' / 'simulation'))
            from contracts import SimResult, SimMetrics
            
            # Return error result
            return SimResult(
                run_id=sim_input.run_id,
                final_pnl=0.0,
                events=[],
                entry_price=0.0,
                final_price=0.0,
                total_candles=len(sim_input.candles),
                metrics=SimMetrics(),
            )
    
    def _run_simulation_with_candles(
        self,
        strategy: StrategyConfig,
        mint: str,
        alert_timestamp: datetime,
        candles: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Internal method to run simulation with provided candles"""
        if not candles:
            return {
                'error': 'No candles provided',
                'mint': mint,
                'alert_timestamp': alert_timestamp.isoformat()
            }
        
        # Execute entry logic
        entry_event = self._execute_entry(strategy, alert_timestamp, candles)
        
        if not entry_event:
            return {
                'error': 'Failed to execute entry',
                'mint': mint,
                'alert_timestamp': alert_timestamp.isoformat()
            }
        
        # Execute exit logic
        exit_events = self._execute_exits(strategy, entry_event, candles)
        
        # Calculate metrics
        initial_capital = 1000.0
        metrics = self._calculate_metrics(
            entry_event, exit_events, initial_capital, candles
        )
        
        # Get entry and final prices
        entry_price = entry_event.price
        final_price = candles[-1]['close'] if candles else entry_price
        
        return {
            'entry_price': entry_price,
            'final_price': final_price,
            'events': [entry_event.to_dict()] + [e.to_dict() for e in exit_events],
            **metrics,
        }

