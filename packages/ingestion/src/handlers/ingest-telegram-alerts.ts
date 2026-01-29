/**
 * Telegram Alert Ingestion Handler
 *
 * Pure handler for ingesting Telegram alerts as artifacts.
 * Depends on ports only (no direct dependencies on adapters).
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '@quantbot/utils';
import type { ArtifactStorePort } from '@quantbot/core';
import { parseJsonExport } from '../telegram/TelegramJsonExportParser.js';
import { normalizeTelegramMessage } from '../telegram/normalize.js';
import { normalizeAlerts, type NormalizeAlertsOptions } from '../alerts/normalize.js';
import { validateAlerts } from '../alerts/validate.js';
import { quarantineAlerts } from '../alerts/quarantine.js';

/**
 * Ingestion arguments
 */
export interface IngestTelegramAlertsArgs {
  /** Path to Telegram export file (JSON) */
  exportPath: string;

  /** Chain ('solana' | 'evm') */
  chain: 'solana' | 'evm';

  /** Date string (YYYY-MM-DD) for partitioning */
  date: string;

  /** Default caller name (optional) */
  defaultCallerName?: string;

  /** Chat ID (optional, will be extracted from export if not provided) */
  chatId?: string;
}

/**
 * Ingestion result
 */
export interface IngestTelegramAlertsResult {
  /** Artifact ID (if published) */
  artifactId?: string;

  /** Whether artifact was deduplicated */
  deduped: boolean;

  /** Number of valid alerts */
  validCount: number;

  /** Number of invalid alerts */
  invalidCount: number;

  /** Number of skipped messages */
  skippedCount: number;

  /** Quarantine artifact IDs (if any) */
  quarantinedIds?: string[];

  /** Error message (if ingestion failed) */
  error?: string;
}

/**
 * Ingest Telegram alerts handler
 *
 * Pipeline:
 * 1. Load Telegram export JSON
 * 2. Normalize to canonical schema
 * 3. Validate alerts
 * 4. Quarantine invalid alerts
 * 5. Write valid alerts to temp CSV
 * 6. Publish via ArtifactStorePort
 * 7. Cleanup temp file
 * 8. Return result
 *
 * @param args - Ingestion arguments
 * @param artifactStore - Artifact store port
 * @returns Ingestion result
 */
export async function ingestTelegramAlertsHandler(
  args: IngestTelegramAlertsArgs,
  artifactStore: ArtifactStorePort
): Promise<IngestTelegramAlertsResult> {
  const runId = `telegram_alerts_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  try {
    logger.info('Starting Telegram alert ingestion', {
      exportPath: args.exportPath,
      chain: args.chain,
      date: args.date,
      runId,
    });

    // Step 1: Load Telegram export JSON
    const exportResult = await parseJsonExport(args.exportPath);
    if (!exportResult.ok) {
      return {
        deduped: false,
        validCount: 0,
        invalidCount: 0,
        skippedCount: 0,
        error: `Failed to parse export: ${exportResult.error}`,
      };
    }

    const rawMessages = exportResult.messages;
    logger.info('Loaded Telegram export', {
      messageCount: rawMessages.length,
      chatId: args.chatId || exportResult.chatId || 'unknown',
    });

    // Determine chat ID
    const chatId = args.chatId || exportResult.chatId || 'unknown';

    // Step 2: Normalize messages
    const normalizedMessages = rawMessages
      .map((msg) => normalizeTelegramMessage(msg, chatId))
      .filter((result) => result.ok)
      .map((result) => (result as { ok: true; value: any }).value);

    logger.info('Normalized messages', {
      normalizedCount: normalizedMessages.length,
      skippedCount: rawMessages.length - normalizedMessages.length,
    });

    // Step 3: Normalize to canonical alerts
    const normalizeOptions: NormalizeAlertsOptions = {
      chain: args.chain,
      runId,
      defaultCallerName: args.defaultCallerName,
    };

    const { alerts, skipped } = normalizeAlerts(normalizedMessages, normalizeOptions);

    logger.info('Normalized alerts', {
      alertCount: alerts.length,
      skippedCount: skipped.length,
    });

    // Step 4: Validate alerts
    const { valid, invalid } = validateAlerts(alerts);

    logger.info('Validated alerts', {
      validCount: valid.length,
      invalidCount: invalid.length,
    });

    // Step 5: Quarantine invalid alerts
    let quarantinedIds: string[] = [];
    if (invalid.length > 0) {
      const quarantineResult = await quarantineAlerts(
        invalid,
        artifactStore,
        args.date,
        args.chain,
        runId
      );

      if (quarantineResult.artifactId) {
        quarantinedIds = [quarantineResult.artifactId];
      }

      logger.info('Quarantined invalid alerts', {
        count: quarantineResult.count,
        artifactId: quarantineResult.artifactId,
      });
    }

    // Step 6: Publish valid alerts
    if (valid.length === 0) {
      logger.warn('No valid alerts to publish');
      return {
        deduped: false,
        validCount: 0,
        invalidCount: invalid.length,
        skippedCount: skipped.length,
        quarantinedIds,
      };
    }

    // Write valid alerts to temp CSV
    const tempPath = await writeTempCsv(valid);

    try {
      // Publish artifact
      const publishResult = await artifactStore.publishArtifact({
        artifactType: 'alerts_v1',
        schemaVersion: 1,
        logicalKey: `day=${args.date}/chain=${args.chain}`,
        dataPath: tempPath,
        tags: {
          date: args.date,
          chain: args.chain,
          run_id: runId,
        },
        inputArtifactIds: [],
        writerName: 'telegram-alert-ingestion',
        gitCommit: process.env.GIT_COMMIT || 'unknown',
      });

      logger.info('Published alert artifact', {
        artifactId: publishResult.artifactId,
        deduped: publishResult.deduped,
        validCount: valid.length,
      });

      return {
        artifactId: publishResult.artifactId,
        deduped: publishResult.deduped,
        validCount: valid.length,
        invalidCount: invalid.length,
        skippedCount: skipped.length,
        quarantinedIds,
      };
    } finally {
      // Cleanup temp file
      await fs.unlink(tempPath).catch((err) => {
        logger.warn('Failed to cleanup temp file', {
          path: tempPath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (error) {
    logger.error('Telegram alert ingestion failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      deduped: false,
      validCount: 0,
      invalidCount: 0,
      skippedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Write alerts to temp CSV file
 */
async function writeTempCsv(alerts: any[]): Promise<string> {
  const tempDir = os.tmpdir();
  const tempPath = path.join(
    tempDir,
    `alerts_${Date.now()}_${Math.random().toString(36).substring(7)}.csv`
  );

  // CSV header
  const header = [
    'alert_ts_utc',
    'chain',
    'mint',
    'alert_chat_id',
    'alert_message_id',
    'alert_id',
    'caller_name_norm',
    'caller_id',
    'mint_source',
    'bot_name',
    'run_id',
  ].join(',');

  // CSV rows
  const rows = alerts.map((alert) => {
    return [
      escapeCsv(alert.alert_ts_utc),
      escapeCsv(alert.chain),
      escapeCsv(alert.mint),
      alert.alert_chat_id,
      alert.alert_message_id,
      escapeCsv(alert.alert_id),
      escapeCsv(alert.caller_name_norm),
      escapeCsv(alert.caller_id),
      escapeCsv(alert.mint_source),
      escapeCsv(alert.bot_name),
      escapeCsv(alert.run_id),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');

  await fs.writeFile(tempPath, csv, 'utf8');

  logger.debug('Wrote temp CSV', {
    path: tempPath,
    rows: alerts.length,
  });

  return tempPath;
}

/**
 * Escape CSV value
 */
function escapeCsv(value: string | number): string {
  if (typeof value === 'number') {
    return String(value);
  }

  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

