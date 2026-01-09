/**
 * SimulationArtifactWriter
 *
 * Writes simulation artifacts to Parquet and JSON.
 *
 * Outputs:
 * - fills.parquet - All fill events
 * - positions.parquet - Position state over time
 * - events.parquet - All simulation events
 * - sim.summary.json - Summary metrics
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { DuckDBClient } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { submitArtifact } from '@quantbot/infra/utils';
import type { SimulationEvent, FillEvent, PositionSnapshot, SimulationState } from './types.js';

export interface WriteArtifactsOptions {
  outputDir: string;
  state: SimulationState;
  events: SimulationEvent[];
  fills: FillEvent[];
  positions: PositionSnapshot[];
  runId: string;
  presetName: string;
}

/**
 * SimulationArtifactWriter
 */
export class SimulationArtifactWriter {
  /**
   * Write all simulation artifacts
   */
  async writeArtifacts(options: WriteArtifactsOptions): Promise<{
    fillsPath: string;
    positionsPath: string;
    eventsPath: string;
    summaryPath: string;
  }> {
    const { outputDir, state, events, fills, positions, runId, presetName } = options;

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Write Parquet files
    const fillsPath = await this.writeFillsParquet(outputDir, fills);
    const positionsPath = await this.writePositionsParquet(outputDir, positions);
    const eventsPath = await this.writeEventsParquet(outputDir, events);

    // Write summary JSON
    const summaryPath = await this.writeSummaryJson(outputDir, {
      runId,
      presetName,
      state,
      events,
      fills,
      positions,
    });

    logger.info('Simulation artifacts written', {
      runId,
      presetName,
      fills: fills.length,
      events: events.length,
      positions: positions.length,
    });

    // Submit artifacts to bus (Phase 2: Bus migration)
    // This allows the daemon to catalog and manage these artifacts
    try {
      const busResults = await Promise.allSettled([
        submitArtifact({
          runId,
          producer: 'simulation',
          kind: 'fills',
          artifactId: 'fills',
          parquetPath: fillsPath,
          schemaHint: 'simulation.fills',
          rows: fills.length,
          meta: {
            presetName,
            totalFills: fills.length,
            outputDir,
          },
        }),
        submitArtifact({
          runId,
          producer: 'simulation',
          kind: 'positions',
          artifactId: 'positions',
          parquetPath: positionsPath,
          schemaHint: 'simulation.positions',
          rows: positions.length,
          meta: {
            presetName,
            totalPositions: positions.length,
            outputDir,
          },
        }),
        submitArtifact({
          runId,
          producer: 'simulation',
          kind: 'events',
          artifactId: 'events',
          parquetPath: eventsPath,
          schemaHint: 'simulation.events',
          rows: events.length,
          meta: {
            presetName,
            totalEvents: events.length,
            outputDir,
          },
        }),
      ]);

      // Log results (but don't fail if bus submission fails - artifacts are still written locally)
      const successful = busResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
      const failed = busResults.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      ).length;

      if (successful > 0) {
        logger.info('Simulation artifacts submitted to bus', {
          runId,
          successful,
          failed,
        });
      }

      if (failed > 0) {
        logger.warn('Some artifacts failed to submit to bus (artifacts still written locally)', {
          runId,
          successful,
          failed,
          errors: busResults
            .filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
            .map((r) =>
              r.status === 'rejected'
                ? r.reason?.message || String(r.reason)
                : r.value.error || 'Unknown error'
            ),
        });
      }
    } catch (error) {
      // Don't fail the entire operation if bus submission fails
      logger.warn('Failed to submit artifacts to bus (artifacts still written locally)', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      fillsPath,
      positionsPath,
      eventsPath,
      summaryPath,
    };
  }

  /**
   * Write fills to Parquet
   */
  private async writeFillsParquet(outputDir: string, fills: FillEvent[]): Promise<string> {
    const db = new DuckDBClient(':memory:');
    try {
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      // Create table from fills
      if (fills.length > 0) {
        const values = fills
          .map(
            (f) =>
              `('${f.tokenId.replace(/'/g, "''")}', ${f.ts}, '${f.side}', ${f.price}, ${f.size}, ${f.quoteAmount}, ${f.fees})`
          )
          .join(',\n');

        await db.execute(`
          CREATE TABLE fills AS
          SELECT * FROM (VALUES ${values}) AS t(token_id, ts, side, price, size, quote_amount, fees)
        `);

        const parquetPath = join(outputDir, 'fills.parquet');
        await db.execute(`COPY fills TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        return parquetPath;
      } else {
        // Create empty Parquet file
        const parquetPath = join(outputDir, 'fills.parquet');
        await db.execute(`
          CREATE TABLE fills (token_id TEXT, ts BIGINT, side TEXT, price DOUBLE, size DOUBLE, quote_amount DOUBLE, fees DOUBLE)
        `);
        await db.execute(`COPY fills TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        return parquetPath;
      }
    } finally {
      await db.close();
    }
  }

  /**
   * Write positions to Parquet
   */
  private async writePositionsParquet(
    outputDir: string,
    positions: PositionSnapshot[]
  ): Promise<string> {
    const db = new DuckDBClient(':memory:');
    try {
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      if (positions.length > 0) {
        const values = positions
          .map(
            (p) =>
              `('${p.tokenId.replace(/'/g, "''")}', ${p.ts}, ${p.entryTs}, ${p.entryPrice}, ${p.currentPrice}, ${p.size}, ${p.unrealizedPnl}, ${p.stopLossPrice ?? 'NULL'}, ${p.takeProfitPrice ?? 'NULL'}, ${p.trailingStopPrice ?? 'NULL'})`
          )
          .join(',\n');

        await db.execute(`
          CREATE TABLE positions AS
          SELECT * FROM (VALUES ${values}) AS t(token_id, ts, entry_ts, entry_price, current_price, size, unrealized_pnl, stop_loss_price, take_profit_price, trailing_stop_price)
        `);

        const parquetPath = join(outputDir, 'positions.parquet');
        await db.execute(`COPY positions TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        return parquetPath;
      } else {
        const parquetPath = join(outputDir, 'positions.parquet');
        await db.execute(`
          CREATE TABLE positions (
            token_id TEXT, ts BIGINT, entry_ts BIGINT, entry_price DOUBLE, 
            current_price DOUBLE, size DOUBLE, unrealized_pnl DOUBLE,
            stop_loss_price DOUBLE, take_profit_price DOUBLE, trailing_stop_price DOUBLE
          )
        `);
        await db.execute(`COPY positions TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        return parquetPath;
      }
    } finally {
      await db.close();
    }
  }

  /**
   * Write events to Parquet
   */
  private async writeEventsParquet(outputDir: string, events: SimulationEvent[]): Promise<string> {
    const db = new DuckDBClient(':memory:');
    try {
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      if (events.length > 0) {
        const values = events
          .map(
            (e) =>
              `('${e.type}', '${e.tokenId.replace(/'/g, "''")}', ${e.ts}, ${e.price}, ${e.size ?? 'NULL'}, ${e.pnl ?? 'NULL'}, ${e.pnlSoFar ?? 'NULL'}, ${e.reason ? `'${e.reason.replace(/'/g, "''")}'` : 'NULL'})`
          )
          .join(',\n');

        await db.execute(`
          CREATE TABLE events AS
          SELECT * FROM (VALUES ${values}) AS t(type, token_id, ts, price, size, pnl, pnl_so_far, reason)
        `);

        const parquetPath = join(outputDir, 'events.parquet');
        await db.execute(`COPY events TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        return parquetPath;
      } else {
        const parquetPath = join(outputDir, 'events.parquet');
        await db.execute(`
          CREATE TABLE events (
            type TEXT, token_id TEXT, ts BIGINT, price DOUBLE,
            size DOUBLE, pnl DOUBLE, pnl_so_far DOUBLE, reason TEXT
          )
        `);
        await db.execute(`COPY events TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        return parquetPath;
      }
    } finally {
      await db.close();
    }
  }

  /**
   * Write summary JSON
   */
  private async writeSummaryJson(
    outputDir: string,
    data: {
      runId: string;
      presetName: string;
      state: SimulationState;
      events: SimulationEvent[];
      fills: FillEvent[];
      positions: PositionSnapshot[];
    }
  ): Promise<string> {
    const summary = {
      runId: data.runId,
      presetName: data.presetName,
      initialCapital: data.state.capital + data.state.totalPnl, // Reconstruct initial
      finalCapital: data.state.capital,
      totalPnl: data.state.totalPnl,
      totalPnlPercent: data.state.totalPnl / (data.state.capital + data.state.totalPnl),
      totalTrades: data.fills.filter((f) => f.side === 'buy').length,
      totalEvents: data.events.length,
      openPositions: data.positions.length,
      createdAtIso: new Date().toISOString(),
    };

    const summaryPath = join(outputDir, 'sim.summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return summaryPath;
  }
}
