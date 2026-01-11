import type {
  ClockPort,
  TelemetryPort,
  MarketDataPort,
  ExecutionPort,
  StatePort,
  QueryPort,
} from '@quantbot/core';

export type ProductionPorts = {
  marketData: MarketDataPort;
  execution: ExecutionPort;
  state: StatePort;
  query: QueryPort; // For analytical queries (ClickHouse, SQL, etc.)
  telemetry: TelemetryPort;
  clock: ClockPort;
};
