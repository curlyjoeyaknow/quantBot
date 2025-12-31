/**
 * Pure Simulator Types
 *
 * These types match the Python sim_types.py for compatibility.
 * All types are JSON-serializable for replay and storage.
 */

export type EventType =
  | 'ENTRY_SIGNAL_TRUE'
  | 'ENTRY_FILLED'
  | 'TARGET_HIT'
  | 'PARTIAL_EXIT'
  | 'STOP_SET'
  | 'STOP_MOVED'
  | 'STOP_HIT'
  | 'EXIT_FULL'
  | 'INFO';

export interface Candle {
  ts: string; // ISO timestamp string
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface Event {
  ts: string; // ISO timestamp string
  candle_index: number;
  type: EventType;
  data: Record<string, unknown>;
}

export interface Trade {
  trade_id: string;
  token: string;
  entry_ts: string; // ISO timestamp string
  exit_ts: string; // ISO timestamp string
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  exit_reason: string;
  size_pct_initial?: number; // Default 100.0
}

export interface ReplayFrame {
  seq: number;
  candle: Candle;
  events: Array<{ ts: string; type: EventType; data: Record<string, unknown> }>;
  position: {
    is_open: boolean;
    size_pct: number;
    avg_price: number | null;
    stop_price: number | null;
    unrealized_pnl_pct: number | null;
  };
}

export interface SimulationSummary {
  token: string;
  trades: number;
  win_rate: number;
  avg_pnl_pct: number;
}

export interface SimulationResult {
  summary: SimulationSummary;
  trades: Trade[];
  events: Event[];
  frames: ReplayFrame[];
}
