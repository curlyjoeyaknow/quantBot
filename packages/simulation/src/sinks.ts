import { promises as fs } from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { OutputTargetConfig } from './config';
import { SimulationResultSink, SimulationRunContext, SimulationLogger } from './engine';
import { AppError } from '@quantbot/utils';

type CsvSinkConfig = Extract<OutputTargetConfig, { type: 'csv' }>;
type JsonSinkConfig = Extract<OutputTargetConfig, { type: 'json' }>;
type StdoutSinkConfig = Extract<OutputTargetConfig, { type: 'stdout' }>;

export interface ConfigDrivenSinkOptions {
  defaultOutputs?: OutputTargetConfig[];
  logger?: SimulationLogger;
}

export class ConfigDrivenSink implements SimulationResultSink {
  public readonly name = 'config-driven-sink';
  private readonly defaultOutputs: OutputTargetConfig[];
  private readonly logger?: SimulationLogger;
  private readonly initializedCsv = new Set<string>();

  constructor(options: ConfigDrivenSinkOptions = {}) {
    this.defaultOutputs = options.defaultOutputs ?? [];
    this.logger = options.logger;
  }

  async handle(context: SimulationRunContext): Promise<void> {
    const outputs: OutputTargetConfig[] = context.scenario.outputs?.length
      ? context.scenario.outputs
      : this.defaultOutputs.length
        ? this.defaultOutputs
        : [{ type: 'stdout', detail: 'summary' }];

    for (const output of outputs) {
      try {
        switch (output.type) {
          case 'stdout':
            this.writeStdout(output as StdoutSinkConfig, context);
            break;
          case 'json':
            await this.writeJson(output as JsonSinkConfig, context);
            break;
          case 'csv':
            await this.writeCsv(output as CsvSinkConfig, context);
            break;
          case 'clickhouse':
            await this.writeClickHouse(
              output as Extract<OutputTargetConfig, { type: 'clickhouse' }>,
              context
            );
            break;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger?.error?.('Failed to emit simulation result', {
          scenario: context.scenario.name,
          target: output.type,
          error: err.message,
        });
      }
    }
  }

  private writeStdout(config: StdoutSinkConfig, context: SimulationRunContext): void {
    const tokenSymbol =
      (context.target.metadata?.tokenSymbol as string) || context.target.mint.substring(0, 8);
    const tokenName = (context.target.metadata?.tokenName as string) || undefined;
    const displayName = tokenName ? `${tokenName} (${tokenSymbol})` : tokenSymbol;

    const summary = {
      scenario: context.scenario.name,
      mint: context.target.mint,
      token: displayName,
      chain: context.target.chain,
      finalPnl: Number((context.result.finalPnl - 1).toFixed(4)),
      candles: context.result.totalCandles,
    };

    if (config.detail === 'detailed') {
      console.log('[simulation]', {
        ...summary,
        entryPrice: context.result.entryPrice,
        finalPrice: context.result.finalPrice,
        events: context.result.events.length,
      });
    } else {
      console.log(
        `[simulation] ${summary.scenario} ${displayName} ${summary.finalPnl >= 0 ? '+' : ''}${summary.finalPnl * 100}%`
      );
    }
  }

  private async writeJson(config: JsonSinkConfig, context: SimulationRunContext): Promise<void> {
    const filePath = this.resolvePath(config.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const tokenSymbol = (context.target.metadata?.tokenSymbol as string) || undefined;
    const tokenName = (context.target.metadata?.tokenName as string) || undefined;

    const payload = {
      scenario: context.scenario.name,
      mint: context.target.mint,
      tokenSymbol,
      tokenName,
      chain: context.target.chain,
      startTime: context.target.startTime.toISO(),
      endTime: context.target.endTime.toISO(),
      result: config.includeEvents
        ? context.result
        : {
            finalPnl: context.result.finalPnl,
            entryPrice: context.result.entryPrice,
            finalPrice: context.result.finalPrice,
            totalCandles: context.result.totalCandles,
          },
    };

    const data = JSON.stringify(payload, null, config.pretty ? 2 : undefined);
    await fs.appendFile(filePath, data + '\n', 'utf-8');
  }

  private async writeCsv(config: CsvSinkConfig, context: SimulationRunContext): Promise<void> {
    const filePath = this.resolvePath(config.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (!this.initializedCsv.has(filePath) || !config.append) {
      const header =
        'scenario,mint,token_symbol,token_name,chain,start_time,end_time,entry_price,final_price,final_pnl,total_candles\n';
      await fs.writeFile(filePath, header, 'utf-8');
      this.initializedCsv.add(filePath);
    }

    const tokenSymbol = (context.target.metadata?.tokenSymbol as string) || '';
    const tokenName = (context.target.metadata?.tokenName as string) || '';

    const row = [
      context.scenario.name,
      context.target.mint,
      tokenSymbol,
      tokenName,
      context.target.chain,
      context.target.startTime.toISO(),
      context.target.endTime.toISO(),
      context.result.entryPrice.toFixed(8),
      context.result.finalPrice.toFixed(8),
      context.result.finalPnl.toFixed(6),
      context.result.totalCandles.toString(),
    ].join(',');

    await fs.appendFile(filePath, `${row}\n`, 'utf-8');
  }

  private resolvePath(targetPath: string): string {
    return path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
  }

  private async writeClickHouse(
    config: Extract<OutputTargetConfig, { type: 'clickhouse' }>,
    context: SimulationRunContext
  ): Promise<void> {
    // This sink uses @quantbot/storage which violates architectural rules.
    // It should be moved to @quantbot/workflows.
    throw new AppError(
      'ConfigDrivenSink.writeClickHouse is deprecated and uses @quantbot/storage (forbidden in simulation package). ' +
        'Move this sink to @quantbot/workflows or use dependency injection to provide storage client.',
      'DEPRECATED_METHOD',
      501,
      { method: 'writeClickHouse', package: '@quantbot/simulation' }
    );
  }
}
