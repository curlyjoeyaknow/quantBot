#!/usr/bin/env ts-node
/**
 * Analyze Birdeye API Endpoint Usage
 *
 * Queries the event log to see which endpoints are being called
 * and how many requests per endpoint type.
 */

import { getDuckDBClient } from '@quantbot/storage';
import { join } from 'path';

async function main() {
  const dbPath = process.env.EVENT_LOG_DB_PATH || join(process.cwd(), 'data/event_log.duckdb');
  const client = getDuckDBClient(dbPath);

  console.log('=== Birdeye API Endpoint Analysis ===\n');

  try {
    // Query endpoint distribution
    const endpointQuery = `
      SELECT 
        endpoint,
        COUNT(*) as call_count,
        COUNT(*) FILTER (WHERE success = true) as success_count,
        COUNT(*) FILTER (WHERE success = false) as failure_count,
        AVG(latency_ms) as avg_latency_ms,
        SUM(credits_cost) as total_credits
      FROM api_event_log
      WHERE api_name = 'Birdeye'
        AND timestamp >= CURRENT_DATE
      GROUP BY endpoint
      ORDER BY call_count DESC
    `;

    const endpointResults = await client.query(endpointQuery);

    console.log('📊 Endpoint Distribution (Today):');
    if (endpointResults.rows.length === 0) {
      console.log('  No events found in event log for today');
      console.log('  Make sure event logging is enabled and events are being recorded');
    } else {
      console.log(
        `  ${'Endpoint'.padEnd(50)} ${'Calls'.padEnd(10)} ${'Success'.padEnd(10)} ${'Failed'.padEnd(10)} ${'Avg Latency'.padEnd(15)} ${'Credits'}`
      );
      console.log('  ' + '-'.repeat(110));

      let totalCalls = 0;
      let totalCredits = 0;

      for (const row of endpointResults.rows) {
        const endpoint = (row[0] as string) || 'unknown';
        const calls = row[1] as number;
        const success = row[2] as number;
        const failed = row[3] as number;
        const avgLatency = (row[4] as number) || 0;
        const credits = (row[5] as number) || 0;

        totalCalls += calls;
        totalCredits += credits;

        const endpointShort = endpoint.length > 48 ? endpoint.substring(0, 45) + '...' : endpoint;
        console.log(
          `  ${endpointShort.padEnd(50)} ${calls.toString().padEnd(10)} ${success.toString().padEnd(10)} ${failed.toString().padEnd(10)} ${avgLatency.toFixed(0).padEnd(15)} ${credits.toFixed(0)}`
        );
      }

      console.log('  ' + '-'.repeat(110));
      console.log(
        `  ${'TOTAL'.padEnd(50)} ${totalCalls.toString().padEnd(10)} ${''.padEnd(10)} ${''.padEnd(10)} ${''.padEnd(15)} ${totalCredits.toFixed(0)}`
      );
    }

    // Query by hour to see call patterns
    const hourlyQuery = `
      SELECT 
        strftime(timestamp, '%Y-%m-%d %H:00') as hour,
        COUNT(*) as call_count,
        COUNT(DISTINCT endpoint) as unique_endpoints
      FROM api_event_log
      WHERE api_name = 'Birdeye'
        AND timestamp >= CURRENT_DATE
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 24
    `;

    const hourlyResults = await client.query(hourlyQuery);

    console.log('\n⏰ Hourly Call Pattern (Last 24 hours):');
    if (hourlyResults.rows.length > 0) {
      console.log(`  ${'Hour'.padEnd(20)} ${'Calls'.padEnd(10)} ${'Unique Endpoints'}`);
      console.log('  ' + '-'.repeat(50));
      for (const row of hourlyResults.rows) {
        const hour = (row[0] as string) || 'unknown';
        const calls = row[1] as number;
        const endpoints = row[2] as number;
        console.log(`  ${hour.padEnd(20)} ${calls.toString().padEnd(10)} ${endpoints}`);
      }
    }

    // Check for rate limit errors
    const rateLimitQuery = `
      SELECT 
        COUNT(*) as rate_limit_errors
      FROM api_event_log
      WHERE api_name = 'Birdeye'
        AND timestamp >= CURRENT_DATE
        AND (status_code = 429 OR error_message LIKE '%rate limit%' OR error_message LIKE '%429%')
    `;

    const rateLimitResults = await client.query(rateLimitQuery);
    const rateLimitErrors = (rateLimitResults.rows[0]?.[0] as number) || 0;

    console.log('\n⚠️  Rate Limit Status:');
    console.log(`  Rate Limit Errors (429): ${rateLimitErrors}`);

    if (rateLimitErrors > 0) {
      console.log('\n💡 Recommendations:');
      console.log('  - Reduce concurrent requests');
      console.log('  - Increase delays between requests');
      console.log('  - Use storage/cache more to avoid API calls');
      console.log('  - Check coverage before fetching OHLCV data');
    }
  } catch (error) {
    console.error('Error querying event log:', error);
    console.log('\n💡 Make sure:');
    console.log('  1. Event logging is enabled');
    console.log('  2. Event log database exists at:', dbPath);
    console.log('  3. Events are being recorded (check observability config)');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
