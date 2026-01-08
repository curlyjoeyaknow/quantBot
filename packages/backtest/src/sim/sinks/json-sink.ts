/**
 * JSON Sink
 * =========
 * Output simulation results to JSON file.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { SimulationRunContext } from '../core/index.js';
import type { ResultSink, BaseSinkOptions } from './base.js';

/**
 * JSON sink options
 */
export interface JsonSinkOptions extends BaseSinkOptions {
  /** Output file path */
  path: string;
  /** Include event details */
  includeEvents?: boolean;
  /** Pretty print JSON */
  pretty?: boolean;
}

/**
 * JSON result sink
 */
export class JsonSink implements ResultSink {
  readonly name = 'json';
  private readonly filePath: string;
  private readonly includeEvents: boolean;
  private readonly pretty: boolean;

  constructor(options: JsonSinkOptions) {
    this.filePath = path.isAbsolute(options.path)
      ? options.path
      : path.join(process.cwd(), options.path);
    this.includeEvents = options.includeEvents ?? true;
    this.pretty = options.pretty ?? true;
  }

  async handle(context: SimulationRunContext): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const payload = this.formatPayload(context);
    const data = JSON.stringify(payload, null, this.pretty ? 2 : undefined);

    await fs.appendFile(this.filePath, data + '\n', 'utf-8');
  }

  private formatPayload(context: SimulationRunContext): Record<string, unknown> {
    const metadata = context.target.metadata as { symbol?: string; name?: string } | undefined;
    const tokenSymbol = metadata?.symbol;
    const tokenName = metadata?.name;

    return {
      scenario: context.scenario.name,
      mint: context.target.mint,
      tokenSymbol,
      tokenName,
      chain: context.target.chain,
      startTime: context.target.startTime.toISO(),
      endTime: context.target.endTime.toISO(),
      result: this.includeEvents
        ? context.result
        : {
            finalPnl: context.result.finalPnl,
            entryPrice: context.result.entryPrice,
            finalPrice: context.result.finalPrice,
            totalCandles: context.result.totalCandles,
          },
    };
  }
}
