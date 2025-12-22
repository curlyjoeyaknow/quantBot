import type { IngestOhlcvCommand } from '../commands/ingestOhlcvCommand.js';
import type {
  OhlcvIngestionPort,
  IngestOhlcvSpec,
  IngestOhlcvResult,
} from '../ports/ohlcvIngestionPort.js';
import type { ClockPort } from '../ports/clockPort.js';

export type HandlerContext = {
  correlationId?: string;
};

export type IngestOhlcvHandlerPorts = {
  ohlcvIngestion: OhlcvIngestionPort;
  clock: ClockPort;
};

export type IngestOhlcvHandlerOutput = {
  result: IngestOhlcvResult;
  events: Array<{ type: string; data?: Record<string, unknown> }>;
  metrics: Array<{ name: string; value: number; tags?: Record<string, string> }>;
  warnings: Array<{ message: string; context?: Record<string, unknown> }>;
};

const intervalMap: Record<IngestOhlcvCommand['interval'], IngestOhlcvSpec['interval']> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15s',
  '1h': '1H',
};

export async function ingestOhlcvHandler(
  cmd: IngestOhlcvCommand,
  ports: IngestOhlcvHandlerPorts,
  _ctx: HandlerContext = {}
): Promise<IngestOhlcvHandlerOutput> {
  if (!cmd.duckdbPath || cmd.duckdbPath.trim() === '') {
    return {
      result: {
        ok: false,
        summary: { reason: 'duckdbPath_missing' },
        errors: [{ message: 'duckdbPath is required (absolute path).' }],
      },
      events: [{ type: 'ohlcv.ingest.rejected', data: { reason: 'duckdbPath_missing' } }],
      metrics: [{ name: 'ohlcv_ingest_rejected', value: 1 }],
      warnings: [],
    };
  }

  const spec: IngestOhlcvSpec = {
    duckdbPath: cmd.duckdbPath,
    from: cmd.from,
    to: cmd.to,
    side: 'buy',
    chain: 'solana',
    interval: intervalMap[cmd.interval],
    preWindowMinutes: cmd.preWindowMinutes,
    postWindowMinutes: cmd.postWindowMinutes,
    errorMode: 'collect',
    checkCoverage: true,
  };

  const start = ports.clock.nowMs();
  const result = await ports.ohlcvIngestion.ingest(spec);
  const elapsed = ports.clock.nowMs() - start;

  return {
    result,
    events: [{ type: 'ohlcv.ingest.completed', data: { ok: result.ok } }],
    metrics: [
      { name: 'ohlcv_ingest_calls', value: 1, tags: { ok: String(result.ok) } },
      { name: 'ohlcv_ingest_elapsed_ms', value: elapsed },
    ],
    warnings: [],
  };
}
