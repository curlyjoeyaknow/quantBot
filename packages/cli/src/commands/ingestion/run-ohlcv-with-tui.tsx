/**
 * Run OHLCV ingestion with TUI
 * 
 * Wraps the ingestion workflow with a TUI that monitors all events.
 */

import { render } from 'ink';
import React from 'react';
import { resolve } from 'path';
import { ConfigurationError } from '@quantbot/utils';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';
import { OhlcvFetchJob } from '@quantbot/jobs';
import { OhlcvRepository } from '@quantbot/storage';
import { DuckDBStorageService } from '@quantbot/simulation';
import { PythonEngine } from '@quantbot/utils';
import { OhlcvIngestionTuiApp, OhlcvIngestionEventEmitter } from './ohlcv-tui.js';
import type { IngestOhlcvArgs } from '../ingestion/ingest-ohlcv.js';
import { Chain } from 'src/core/address-validator.js';

/**
 * Run OHLCV ingestion with interactive TUI
 */
export async function runOhlcvIngestionWithTui(args: IngestOhlcvArgs): Promise<void> {
  // Create event emitter
  const eventEmitter = new OhlcvIngestionEventEmitter();

  // Parse args → build spec
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdb',
      { envVar: 'DUCKDB_PATH' }
    );
  }
  const duckdbPath = resolve(process.cwd(), duckdbPathRaw);

  // Map CLI interval to workflow interval format
  const intervalMap: Record<string, '15s' | '1m' | '5m' | '1H'> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '5m',
    '1h': '1H',
  };
  const workflowInterval = intervalMap[args.interval] || '1m';

  const spec: IngestOhlcvSpec = {
    duckdbPath,
    from: args.from,
    to: args.to,
    side: 'buy',
    chain: 'solana',
    interval: workflowInterval,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
    errorMode: 'collect',
    checkCoverage: true,
    rateLimitMs: 100,
    maxRetries: 3,
  };

  // Create services
  const pythonEngine = new PythonEngine();
  const clickHouseRepo = new OhlcvRepository();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);

  // Create workflow context with event emitter wrapper
  const parallelWorkers = process.env.BIRDEYE_PARALLEL_WORKERS
    ? parseInt(process.env.BIRDEYE_PARALLEL_WORKERS, 10)
    : 16;
  const rateLimitMsPerWorker = process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER
    ? parseInt(process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER, 10)
    : 330;

  const ohlcvFetchJob = new OhlcvFetchJob({
    parallelWorkers,
    rateLimitMsPerWorker,
    maxRetries: spec.maxRetries,
    checkCoverage: spec.checkCoverage,
  });

  // Create base context
  const baseContext = createOhlcvIngestionContext({
    ohlcvFetchJob,
    duckdbStorage,
  });

  // Wrap fetchWorkList to emit events
  const originalFetchWorkList = baseContext.jobs.ohlcvFetchJob.fetchWorkList;
  baseContext.jobs.ohlcvFetchJob.fetchWorkList = async (worklist) => {
    eventEmitter.emitEvent({
      type: 'worklist_generated',
      metadata: { count: worklist.length },
    });

    const results = await originalFetchWorkList(worklist);

    // Emit events for each result
    for (const result of results) {
      const workItem = result.workItem;
      
      eventEmitter.emitEvent({
        type: 'fetch_started',
        mint: workItem.mint,
        chain: workItem.chain,
        interval: workItem.interval,
        alertTime: workItem.alertTime?.toISO() || undefined,
        startTime: workItem.startTime?.toISO() || undefined,
        endTime: workItem.endTime?.toISO() || undefined,
      });

      if (result.success) {
        eventEmitter.emitEvent({
          type: 'fetch_success',
          mint: workItem.mint,
          chain: workItem.chain,
          interval: workItem.interval,
          alertTime: workItem.alertTime?.toISO() || undefined,
          startTime: workItem.startTime?.toISO() || undefined,
          endTime: workItem.endTime?.toISO() || undefined,
          candlesFetched: result.candlesFetched,
          candlesStored: result.candlesStored,
          durationMs: result.durationMs,
        });
      } else {
        eventEmitter.emitEvent({
          type: 'fetch_failure',
          mint: workItem.mint,
          chain: workItem.chain,
          interval: workItem.interval,
          alertTime: workItem.alertTime?.toISO() || undefined,
          error: result.error,
          durationMs: result.durationMs,
        });
      }
    }

    return results;
  };

  // Wrap storeCandles function for event emission
  // Pass through context instead of monkey-patching (ES modules are read-only)
  const { storeCandles: originalStoreCandles } = await import('@quantbot/ohlcv');
  const wrappedStoreCandles = async (
    mint: string,
    chain: string,
    candles: Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>,
    interval: string
  ) => {
    eventEmitter.emitEvent({
      type: 'store_started',
      mint,
      chain,
      interval,
      candlesFetched: candles.length,
    });

    try {
      await originalStoreCandles(mint, chain as Chain, candles, interval as '1m' | '5m' | '15m' | '1h' | '15s' | '1H');
      eventEmitter.emitEvent({
        type: 'store_success',
        mint,
        chain,
        interval,
        candlesStored: candles.length,
      });
    } catch (error) {
      eventEmitter.emitEvent({
        type: 'store_failure',
        mint,
        chain,
        interval,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  // Pass wrapped storeCandles through context (workflow uses ctx.storeCandles || defaultStoreCandles)
  const workflowContext = {
    ...baseContext,
    storeCandles: wrappedStoreCandles,
  };

  // Wrap updateOhlcvMetadata to emit events
  if (workflowContext.duckdbStorage) {
    const originalUpdateMetadata = workflowContext.duckdbStorage.updateOhlcvMetadata.bind(workflowContext.duckdbStorage);
    workflowContext.duckdbStorage.updateOhlcvMetadata = async (
      duckdbPath,
      mint,
      alertTimestamp,
      intervalSeconds,
      timeRangeStart,
      timeRangeEnd,
      candleCount
    ) => {
      const result = await originalUpdateMetadata(
        duckdbPath,
        mint,
        alertTimestamp,
        intervalSeconds,
        timeRangeStart,
        timeRangeEnd,
        candleCount
      );

      if (result.success) {
        eventEmitter.emitEvent({
          type: 'metadata_updated',
          mint,
          alertTime: alertTimestamp,
          startTime: timeRangeStart,
          endTime: timeRangeEnd,
          candlesStored: candleCount,
        });
      }

      return result;
    };
  }

  // Start TUI in background
  const tuiPromise = new Promise<void>((resolve) => {
    render(
      <OhlcvIngestionTuiApp
        eventEmitter={eventEmitter}
        duckdbPath={duckdbPath}
        clickHouseRepo={clickHouseRepo}
        duckdbStorage={duckdbStorage}
      />
    );
    // TUI will exit when user presses Escape
    resolve();
  });

  // Start ingestion workflow
  eventEmitter.emitEvent({
    type: 'workflow_started',
    metadata: {
      from: spec.from,
      to: spec.to,
      interval: spec.interval,
      preWindowMinutes: spec.preWindowMinutes,
      postWindowMinutes: spec.postWindowMinutes,
    },
  });

  const ingestionPromise = ingestOhlcv(spec, workflowContext).then((result) => {
    eventEmitter.emitEvent({
      type: 'workflow_completed',
      metadata: {
        worklistGenerated: result.worklistGenerated,
        workItemsProcessed: result.workItemsProcessed,
        workItemsSucceeded: result.workItemsSucceeded,
        workItemsFailed: result.workItemsFailed,
        workItemsSkipped: result.workItemsSkipped,
        totalCandlesFetched: result.totalCandlesFetched,
        totalCandlesStored: result.totalCandlesStored,
      },
      durationMs: result.durationMs,
    });
    return result;
  });

  // Wait for both to complete
  await Promise.all([tuiPromise, ingestionPromise]);
}

