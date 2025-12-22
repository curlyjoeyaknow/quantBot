/**
 * Ingest OHLCV Command
 *
 * Pure command type - no I/O, no env, no path resolution.
 * All values must be resolved before creating the command.
 */
export type IngestOhlcvCommand = {
  duckdbPath: string; // absolute path required (no env, no resolve here)
  from?: string;
  to?: string;
  interval: '1m' | '5m' | '15m' | '1h'; // CLI-facing interval
  preWindowMinutes?: number;
  postWindowMinutes?: number;
};

