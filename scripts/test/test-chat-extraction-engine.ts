#!/usr/bin/env ts-node
/**
 * Test Telegram Ingestion and OHLCV Fetching
 *
 * Tests the ingestion services and OHLCV fetching by:
 * 1. Finding the most recent Telegram messages HTML file
 * 2. Using TelegramAlertIngestionService to extract tokens
 * 3. Attempting to fetch OHLCV candles for each extracted token
 * 4. Reporting success rate and metadata extraction quality
 *
 * This replaces the old chat extraction engine test.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { TelegramAlertIngestionService, TelegramCallIngestionService } from '@quantbot/ingestion';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { getOHLCVEngine } from '@quantbot/ohlcv';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';

interface TestResult {
  token: string;
  chain: string;
  metadata?: {
    name?: string;
    symbol?: string;
    price?: number;
    marketCap?: number;
  };
  candlesFetched: boolean;
  candleCount: number;
  error?: string;
}

/**
 * Find the most recent messages file
 */
function findMostRecentMessagesFile(): string | null {
  const messagesDir = path.join(process.cwd(), 'data', 'raw', 'messages');

  if (!fs.existsSync(messagesDir)) {
    return null;
  }

  // Find all HTML files recursively
  const htmlFiles: string[] = [];
  function findFiles(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        htmlFiles.push(fullPath);
      }
    }
  }

  findFiles(messagesDir);

  if (htmlFiles.length === 0) {
    return null;
  }

  // Sort by modification time (most recent first)
  htmlFiles.sort((a, b) => {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    return statB.mtime.getTime() - statA.mtime.getTime();
  });

  return htmlFiles[0];
}

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🧪 TESTING TELEGRAM INGESTION & OHLCV FETCHING');
  console.log(`${'='.repeat(80)}\n`);

  // Find most recent messages file
  const messagesFile = findMostRecentMessagesFile();
  if (!messagesFile) {
    console.error('❌ No messages HTML files found in data/raw/messages');
    process.exit(1);
  }

  console.log(`📂 Using messages file: ${path.basename(messagesFile)}`);
  console.log(`📅 File modified: ${fs.statSync(messagesFile).mtime.toISOString()}\n`);

  // Initialize repositories
  const callersRepo = new CallersRepository();
  const tokensRepo = new TokensRepository();
  const alertsRepo = new AlertsRepository();
  const callsRepo = new CallsRepository();

  // Initialize ingestion service
  const ingestionService = new TelegramAlertIngestionService(
    callersRepo,
    tokensRepo,
    alertsRepo,
    callsRepo
  );

  // Initialize OHLCV engine
  const ohlcvEngine = getOHLCVEngine();

  console.log('📖 Ingesting Telegram export...\n');

  // Ingest the file (this will extract tokens and store them)
  // Use a test caller name - adjust as needed
  const testCallerName = 'test-caller';
  const testChain: Chain = 'solana';

  try {
    const ingestResult = await ingestionService.ingestExport({
      filePath: messagesFile,
      callerName: testCallerName,
      chain: testChain,
    });

    console.log(`✅ Ingestion complete:`);
    console.log(`   Alerts inserted: ${ingestResult.alertsInserted}`);
    console.log(`   Calls inserted: ${ingestResult.callsInserted}`);
    console.log(`   Tokens upserted: ${ingestResult.tokensUpserted}`);
    console.log(`   Messages failed: ${ingestResult.messagesFailed}\n`);

    // Now fetch OHLCV for the ingested tokens
    console.log('🔍 Fetching OHLCV candles for ingested tokens...\n');

    // Query tokens that were just ingested (simplified - in production you'd query by timestamp)
    const testResults: TestResult[] = [];
    const uniqueTokens = new Map<string, TestResult>();

    // Get recent alerts to find tokens (last 7 days)
    const fromDate = DateTime.utc().minus({ days: 7 }).toJSDate();
    const toDate = DateTime.utc().toJSDate();
    const recentAlerts = await alertsRepo.findByTimeRange(fromDate, toDate);

    for (const alert of recentAlerts) {
      const token = await tokensRepo.findById(alert.tokenId);
      if (!token) continue;

      const key = `${token.address.toLowerCase()}_${token.chain}`;
      if (uniqueTokens.has(key)) continue;

      // Try to fetch candles
      const startTime = DateTime.utc().minus({ days: 7 });
      const endTime = DateTime.utc();

      try {
        const candleResult = await ohlcvEngine.fetch(
          token.address,
          startTime,
          endTime,
          token.chain as Chain,
          {
            cacheOnly: false,
            ensureIngestion: true,
            interval: '5m',
          }
        );

        const result: TestResult = {
          token: token.address,
          chain: token.chain,
          metadata: {
            name: token.name || undefined,
            symbol: token.symbol || undefined,
          },
          candlesFetched: candleResult.candles.length > 0,
          candleCount: candleResult.candles.length,
        };

        testResults.push(result);
        uniqueTokens.set(key, result);

        const status = result.candlesFetched ? '✅' : '❌';
        const metadata = result.metadata
          ? ` | ${result.metadata.symbol || 'N/A'} | ${result.metadata.name || 'N/A'}`
          : ' | No metadata';
        console.log(
          `  ${status} ${token.address.substring(0, 30)}... | ${result.candleCount} candles${metadata}`
        );
      } catch (error: any) {
        const result: TestResult = {
          token: token.address,
          chain: token.chain,
          candlesFetched: false,
          candleCount: 0,
          error: error.message || String(error),
        };

        testResults.push(result);
        uniqueTokens.set(key, result);

        console.log(`  ❌ ${token.address.substring(0, 30)}... | Error: ${result.error}`);
      }
    }

    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 TEST RESULTS SUMMARY');
    console.log(`${'='.repeat(80)}\n`);

    const total = testResults.length;
    const candlesFetched = testResults.filter((r) => r.candlesFetched).length;
    const successRate = total > 0 ? (candlesFetched / total) * 100 : 0;
    const withMetadata = testResults.filter(
      (r) => r.metadata && (r.metadata.name || r.metadata.symbol)
    ).length;
    const metadataRate = total > 0 ? (withMetadata / total) * 100 : 0;

    console.log(`Total tokens tested: ${total}`);
    console.log(`✅ Candles fetched successfully: ${candlesFetched} (${successRate.toFixed(1)}%)`);
    console.log(`📊 With metadata: ${withMetadata} (${metadataRate.toFixed(1)}%)`);

    // Detailed breakdown
    if (candlesFetched < total * 0.95) {
      console.log(`\n⚠️  SUCCESS RATE BELOW 95% TARGET`);
      console.log(`   Target: 95%+ (${Math.ceil(total * 0.95)} tokens)`);
      console.log(`   Actual: ${successRate.toFixed(1)}% (${candlesFetched} tokens)\n`);

      const failed = testResults.filter((r) => !r.candlesFetched);
      console.log(`Failed tokens (${failed.length}):`);
      for (const result of failed.slice(0, 10)) {
        console.log(
          `  - ${result.token.substring(0, 40)}... (${result.chain}) - ${result.error || 'No candles'}`
        );
      }
      if (failed.length > 10) {
        console.log(`  ... and ${failed.length - 10} more`);
      }
    } else {
      console.log(`\n✅ SUCCESS RATE MEETS 95%+ TARGET! 🎉\n`);
    }

    // Save results
    const outputFile = path.join(
      process.cwd(),
      'data',
      'exports',
      'telegram-ingestion-test-results.json'
    );
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(
      outputFile,
      JSON.stringify(
        {
          testDate: new Date().toISOString(),
          messagesFile: path.basename(messagesFile),
          ingestionResult: ingestResult,
          results: testResults,
          summary: {
            total,
            candlesFetched,
            successRate,
            withMetadata,
            metadataRate,
          },
        },
        null,
        2
      )
    );

    console.log(`\n💾 Results saved to: ${outputFile}`);
    console.log(`\n✅ Test complete!\n`);
  } catch (error) {
    logger.error('Test failed', error as Error);
    console.error('\n❌ Test failed:', (error as Error).message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
