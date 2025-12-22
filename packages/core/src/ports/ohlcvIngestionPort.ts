/**
 * OHLCV Ingestion Port
 *
 * Port interface for OHLCV ingestion operations.
 * Adapters implement this port to provide ingestion capabilities.
 */
export type IngestOhlcvSpec = {
  duckdbPath: string; // absolute path required (no env, no resolve here)
  from?: string;
  to?: string;
  side: 'buy' | 'sell';
  chain: 'solana' | 'evm';
  interval: '15s' | '1m' | '5m' | '1H';
  preWindowMinutes?: number;
  postWindowMinutes?: number;
  errorMode: 'collect' | 'failFast';
  checkCoverage: boolean;
  rateLimitMs?: number;
  maxRetries?: number;
  mints?: string[]; // Optional filter: only fetch OHLCV for these specific mints
};

export type IngestOhlcvResult = {
  ok: boolean;
  summary: Record<string, unknown>;
  details?: Record<string, unknown>;
  errors?: Array<{ message: string; context?: Record<string, unknown> }>;
};

export interface OhlcvIngestionPort {
  ingest(spec: IngestOhlcvSpec): Promise<IngestOhlcvResult>;
}

