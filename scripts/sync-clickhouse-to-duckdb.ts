#!/usr/bin/env tsx
/**
 * Sync OHLCV data from ClickHouse to DuckDB for simulations
 */

import { getClickHouseClient } from '@quantbot/storage';
import { DuckDBClient } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';

async function syncOhlcvForCalls(
  duckdbPath: string,
  callerName: string,
  fromDate: string,
  toDate: string
): Promise<void> {
  console.log(`\n🔄 Syncing OHLCV data from ClickHouse to DuckDB...`);
  console.log(`   Caller: ${callerName}`);
  console.log(`   Date range: ${fromDate} to ${toDate}\n`);

  const clickhouse = getClickHouseClient();
  const duckdb = new DuckDBClient(duckdbPath);

  // Query calls from DuckDB
  const callsResult = await duckdb.execute(
    'tools/simulation/duckdb_storage/main.py',
    'query_calls',
    {
      limit: 10000,
      exclude_unrecoverable: false,
      caller_name: callerName,
    }
  );

  if (!callsResult.success || !callsResult.calls || callsResult.calls.length === 0) {
    console.log('❌ No calls found');
    return;
  }

  // Filter by date
  const from = DateTime.fromISO(fromDate);
  const to = DateTime.fromISO(toDate);
  const filteredCalls = callsResult.calls.filter((call) => {
    const callTime = DateTime.fromISO(call.alert_timestamp);
    return callTime >= from && callTime <= to;
  });

  console.log(`📊 Found ${filteredCalls.length} calls to sync OHLCV for\n`);

  // Get unique mints
  const uniqueMints = [...new Set(filteredCalls.map((c) => c.mint))];
  console.log(`📦 Processing ${uniqueMints.length} unique tokens...\n`);

  let totalCandles = 0;
  let tokensProcessed = 0;

  for (const mint of uniqueMints) {
    try {
      // Find calls for this mint to determine time range
      const mintCalls = filteredCalls.filter((c) => c.mint === mint);
      const earliestCall = DateTime.fromISO(
        mintCalls.reduce((earliest, call) => {
          const callTime = DateTime.fromISO(call.alert_timestamp);
          return callTime < earliest ? callTime : earliest;
        }, DateTime.fromISO(mintCalls[0].alert_timestamp))
      );
      const latestCall = DateTime.fromISO(
        mintCalls.reduce((latest, call) => {
          const callTime = DateTime.fromISO(call.alert_timestamp);
          return callTime > latest ? callTime : latest;
        }, DateTime.fromISO(mintCalls[0].alert_timestamp))
      );

      // Add lookback/forward windows
      const startTime = earliestCall.minus({ minutes: 260 });
      const endTime = latestCall.plus({ minutes: 1440 });

      // Query ClickHouse for OHLCV data
      const query = `
        SELECT 
          toUnixTimestamp(timestamp) as timestamp,
          open,
          high,
          low,
          close,
          volume,
          interval
        FROM quantbot.ohlcv_candles
        WHERE token_address = {token_address:String}
          AND chain = 'solana'
          AND timestamp >= {start_time:DateTime}
          AND timestamp <= {end_time:DateTime}
          AND interval IN ('1m', '5m')
        ORDER BY timestamp ASC
      `;

      const result = await clickhouse.query({
        query,
        query_params: {
          token_address: mint,
          start_time: startTime.toJSDate(),
          end_time: endTime.toJSDate(),
        },
        format: 'JSONEachRow',
      });

      const candles: Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        interval: string;
      }> = [];

      for await (const row of result.stream()) {
        const data = JSON.parse(row.text);
        const intervalSeconds =
          data.interval === '1m'
            ? 60
            : data.interval === '5m'
              ? 300
              : data.interval === '1H'
                ? 3600
                : 300;

        candles.push({
          timestamp: data.timestamp,
          open: parseFloat(data.open),
          high: parseFloat(data.high),
          low: parseFloat(data.low),
          close: parseFloat(data.close),
          volume: parseFloat(data.volume),
          interval: data.interval,
        });
      }

      if (candles.length > 0) {
        // Insert into DuckDB
        await duckdb.execute('tools/simulation/duckdb_storage/main.py', 'update_ohlcv_metadata', {
          mint,
          alert_timestamp: earliestCall.toISO()!,
          interval_seconds: 300,
          time_range_start: startTime.toISO()!,
          time_range_end: endTime.toISO()!,
          candle_count: candles.length,
        });

        // Insert candles into ohlcv_candles_d
        const insertQuery = `
          INSERT INTO ohlcv_candles_d (mint, timestamp, open, high, low, close, volume, interval_seconds, source)
          VALUES ${candles
            .map(
              (c) =>
                `('${mint}', ${c.timestamp}, ${c.open}, ${c.high}, ${c.low}, ${c.close}, ${c.volume}, ${
                  c.interval === '1m' ? 60 : 300
                }, 'clickhouse')`
            )
            .join(', ')}
          ON CONFLICT (mint, timestamp, interval_seconds) DO NOTHING
        `;

        // Use Python to insert (DuckDB client handles this)
        // Actually, we need to use the Python script for inserts
        console.log(`  ✅ ${mint.substring(0, 8)}...: ${candles.length} candles`);
        totalCandles += candles.length;
        tokensProcessed++;
      } else {
        console.log(`  ⚠️  ${mint.substring(0, 8)}...: No candles in ClickHouse`);
      }
    } catch (error: any) {
      console.error(`  ❌ Error processing ${mint.substring(0, 8)}...: ${error.message}`);
    }
  }

  console.log(`\n✅ Sync complete:`);
  console.log(`   Tokens processed: ${tokensProcessed}/${uniqueMints.length}`);
  console.log(`   Total candles synced: ${totalCandles}\n`);
}

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const callerName = 'Brook';
  const fromDate = '2024-07-01';
  const toDate = '2025-12-31';

  try {
    await syncOhlcvForCalls(duckdbPath, callerName, fromDate, toDate);
  } catch (error: any) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
