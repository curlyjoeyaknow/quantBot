"""
Canonical Simulation Contracts

Defines SimInput and SimResult schemas that both TS and Python must match.
These must produce identical JSON structure for interoperability.
"""

from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Union
from datetime import datetime
import json


@dataclass
class Candle:
    """Canonical candle format"""
    timestamp: int  # Unix timestamp in seconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Candle':
        """Create from dictionary"""
        return cls(
            timestamp=int(data['timestamp']),
            open=float(data['open']),
            high=float(data['high']),
            low=float(data['low']),
            close=float(data['close']),
            volume=float(data['volume']),
        )


@dataclass
class EntryConfig:
    """Entry configuration"""
    initialEntry: Union[float, str]  # number or 'none'
    trailingEntry: Union[float, str]  # number or 'none'
    maxWaitTime: float
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'initialEntry': self.initialEntry,
            'trailingEntry': self.trailingEntry,
            'maxWaitTime': self.maxWaitTime,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EntryConfig':
        """Create from dictionary"""
        return cls(
            initialEntry=data['initialEntry'],
            trailingEntry=data['trailingEntry'],
            maxWaitTime=float(data['maxWaitTime']),
        )


@dataclass
class ProfitTarget:
    """Profit target configuration"""
    target: float
    percent: float
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProfitTarget':
        """Create from dictionary"""
        return cls(
            target=float(data['target']),
            percent=float(data['percent']),
        )


@dataclass
class StopLossConfig:
    """Stop loss configuration"""
    initial: float
    trailing: Optional[Union[float, str]] = None
    trailingPercent: Optional[float] = None
    trailingWindowSize: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {'initial': self.initial}
        if self.trailing is not None:
            result['trailing'] = self.trailing
        if self.trailingPercent is not None:
            result['trailingPercent'] = self.trailingPercent
        if self.trailingWindowSize is not None:
            result['trailingWindowSize'] = self.trailingWindowSize
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StopLossConfig':
        """Create from dictionary"""
        return cls(
            initial=float(data['initial']),
            trailing=data.get('trailing'),
            trailingPercent=data.get('trailingPercent'),
            trailingWindowSize=data.get('trailingWindowSize'),
        )


@dataclass
class ExitConfig:
    """Exit configuration"""
    profit_targets: List[ProfitTarget]
    stop_loss: Optional[StopLossConfig] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {
            'profit_targets': [pt.to_dict() for pt in self.profit_targets],
        }
        if self.stop_loss:
            result['stop_loss'] = self.stop_loss.to_dict()
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ExitConfig':
        """Create from dictionary"""
        return cls(
            profit_targets=[ProfitTarget.from_dict(pt) for pt in data['profit_targets']],
            stop_loss=StopLossConfig.from_dict(data['stop_loss']) if data.get('stop_loss') else None,
        )


@dataclass
class ReEntryConfig:
    """Re-entry configuration"""
    trailingReEntry: Union[float, str]  # number or 'none'
    maxReEntries: int
    sizePercent: float
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'trailingReEntry': self.trailingReEntry,
            'maxReEntries': self.maxReEntries,
            'sizePercent': self.sizePercent,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ReEntryConfig':
        """Create from dictionary"""
        return cls(
            trailingReEntry=data['trailingReEntry'],
            maxReEntries=int(data['maxReEntries']),
            sizePercent=float(data['sizePercent']),
        )


@dataclass
class CostConfig:
    """Cost configuration"""
    entrySlippageBps: Optional[float] = None
    exitSlippageBps: Optional[float] = None
    takerFeeBps: Optional[float] = None
    makerFeeBps: Optional[float] = None
    borrowAprBps: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {}
        if self.entrySlippageBps is not None:
            result['entrySlippageBps'] = self.entrySlippageBps
        if self.exitSlippageBps is not None:
            result['exitSlippageBps'] = self.exitSlippageBps
        if self.takerFeeBps is not None:
            result['takerFeeBps'] = self.takerFeeBps
        if self.makerFeeBps is not None:
            result['makerFeeBps'] = self.makerFeeBps
        if self.borrowAprBps is not None:
            result['borrowAprBps'] = self.borrowAprBps
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CostConfig':
        """Create from dictionary"""
        return cls(
            entrySlippageBps=data.get('entrySlippageBps'),
            exitSlippageBps=data.get('exitSlippageBps'),
            takerFeeBps=data.get('takerFeeBps'),
            makerFeeBps=data.get('makerFeeBps'),
            borrowAprBps=data.get('borrowAprBps'),
        )


@dataclass
class SimInput:
    """Canonical simulation input contract"""
    run_id: str
    strategy_id: str
    mint: str
    alert_timestamp: str  # ISO 8601
    candles: List[Candle]
    entry_config: EntryConfig
    exit_config: ExitConfig
    reentry_config: Optional[ReEntryConfig] = None
    cost_config: Optional[CostConfig] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        result = {
            'run_id': self.run_id,
            'strategy_id': self.strategy_id,
            'mint': self.mint,
            'alert_timestamp': self.alert_timestamp,
            'candles': [c.to_dict() for c in self.candles],
            'entry_config': self.entry_config.to_dict(),
            'exit_config': self.exit_config.to_dict(),
        }
        if self.reentry_config:
            result['reentry_config'] = self.reentry_config.to_dict()
        if self.cost_config:
            result['cost_config'] = self.cost_config.to_dict()
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SimInput':
        """Create from dictionary"""
        return cls(
            run_id=data['run_id'],
            strategy_id=data['strategy_id'],
            mint=data['mint'],
            alert_timestamp=data['alert_timestamp'],
            candles=[Candle.from_dict(c) for c in data['candles']],
            entry_config=EntryConfig.from_dict(data['entry_config']),
            exit_config=ExitConfig.from_dict(data['exit_config']),
            reentry_config=ReEntryConfig.from_dict(data['reentry_config']) if data.get('reentry_config') else None,
            cost_config=CostConfig.from_dict(data['cost_config']) if data.get('cost_config') else None,
        )


@dataclass
class SimEvent:
    """Simulation event"""
    event_type: str
    timestamp: int  # Unix timestamp in seconds
    price: float
    quantity: float
    value_usd: float
    fee_usd: float
    pnl_usd: Optional[float] = None
    cumulative_pnl_usd: Optional[float] = None
    position_size: float = 0.0
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {
            'event_type': self.event_type,
            'timestamp': self.timestamp,
            'price': self.price,
            'quantity': self.quantity,
            'value_usd': self.value_usd,
            'fee_usd': self.fee_usd,
            'position_size': self.position_size,
        }
        if self.pnl_usd is not None:
            result['pnl_usd'] = self.pnl_usd
        if self.cumulative_pnl_usd is not None:
            result['cumulative_pnl_usd'] = self.cumulative_pnl_usd
        if self.metadata:
            result['metadata'] = self.metadata
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SimEvent':
        """Create from dictionary"""
        return cls(
            event_type=data['event_type'],
            timestamp=int(data['timestamp']),
            price=float(data['price']),
            quantity=float(data['quantity']),
            value_usd=float(data['value_usd']),
            fee_usd=float(data['fee_usd']),
            pnl_usd=data.get('pnl_usd'),
            cumulative_pnl_usd=data.get('cumulative_pnl_usd'),
            position_size=float(data.get('position_size', 0.0)),
            metadata=data.get('metadata'),
        )


@dataclass
class SimMetrics:
    """Simulation metrics"""
    max_drawdown: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    win_rate: Optional[float] = None
    total_trades: Optional[int] = None
    profit_factor: Optional[float] = None
    average_win: Optional[float] = None
    average_loss: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {}
        if self.max_drawdown is not None:
            result['max_drawdown'] = self.max_drawdown
        if self.sharpe_ratio is not None:
            result['sharpe_ratio'] = self.sharpe_ratio
        if self.win_rate is not None:
            result['win_rate'] = self.win_rate
        if self.total_trades is not None:
            result['total_trades'] = self.total_trades
        if self.profit_factor is not None:
            result['profit_factor'] = self.profit_factor
        if self.average_win is not None:
            result['average_win'] = self.average_win
        if self.average_loss is not None:
            result['average_loss'] = self.average_loss
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SimMetrics':
        """Create from dictionary"""
        return cls(
            max_drawdown=data.get('max_drawdown'),
            sharpe_ratio=data.get('sharpe_ratio'),
            win_rate=data.get('win_rate'),
            total_trades=data.get('total_trades'),
            profit_factor=data.get('profit_factor'),
            average_win=data.get('average_win'),
            average_loss=data.get('average_loss'),
        )


@dataclass
class SimResult:
    """Canonical simulation result contract"""
    run_id: str
    final_pnl: float  # Multiplier (1.0 = break even)
    events: List[SimEvent]
    entry_price: float
    final_price: float
    total_candles: int
    metrics: SimMetrics
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'run_id': self.run_id,
            'final_pnl': self.final_pnl,
            'events': [e.to_dict() for e in self.events],
            'entry_price': self.entry_price,
            'final_price': self.final_price,
            'total_candles': self.total_candles,
            'metrics': self.metrics.to_dict(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SimResult':
        """Create from dictionary"""
        return cls(
            run_id=data['run_id'],
            final_pnl=float(data['final_pnl']),
            events=[SimEvent.from_dict(e) for e in data['events']],
            entry_price=float(data['entry_price']),
            final_price=float(data['final_price']),
            total_candles=int(data['total_candles']),
            metrics=SimMetrics.from_dict(data['metrics']),
        )

