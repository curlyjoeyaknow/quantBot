import type {
  ClockPort,
  TelemetryPort,
  MarketDataPort,
  ExecutionPort,
  StatePort,
  QueryPort,
  RunEventPort,
} from '@quantbot/core';

export type ProductionPorts = {
  marketData: MarketDataPort;
  execution: ExecutionPort;
  state: StatePort;
  query: QueryPort; // For analytical queries (ClickHouse, SQL, etc.)
  telemetry: TelemetryPort;
  clock: ClockPort;
  events?: RunEventPort; // Optional - for event sourcing
};
