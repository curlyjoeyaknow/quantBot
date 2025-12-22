import type {
  ClockPort,
  TelemetryPort,
  MarketDataPort,
  ExecutionPort,
  StatePort,
} from '@quantbot/core';

export type ProductionPorts = {
  marketData: MarketDataPort;
  execution: ExecutionPort;
  state: StatePort;
  telemetry: TelemetryPort;
  clock: ClockPort;
};

