/**
 * Alert Quarantine Handler
 *
 * Quarantines invalid alerts for review by publishing them as
 * quarantine artifacts in the artifact store.
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '@quantbot/utils';
import type { ArtifactStorePort } from '@quantbot/core';
import type { InvalidAlert } from './validate.js';

/**
 * Quarantine result
 */
export interface QuarantineResult {
  /** Artifact ID of quarantine artifact (if published) */
  artifactId?: string;

  /** Number of alerts quarantined */
  count: number;

  /** Error message (if quarantine failed) */
  error?: string;
}

/**
 * Quarantine invalid alerts
 *
 * @param invalid - Invalid alerts to quarantine
 * @param artifactStore - Artifact store port
 * @param date - Date string (YYYY-MM-DD)
 * @param chain - Chain ('solana' | 'evm')
 * @param runId - Run ID for provenance
 * @returns Quarantine result
 */
export async function quarantineAlerts(
  invalid: InvalidAlert[],
  artifactStore: ArtifactStorePort,
  date: string,
  chain: string,
  runId: string
): Promise<QuarantineResult> {
  if (invalid.length === 0) {
    return { count: 0 };
  }

  try {
    logger.info('Quarantining invalid alerts', {
      count: invalid.length,
      date,
      chain,
    });

    // Create temp CSV file
    const tempPath = await writeTempCsv(invalid);

    try {
      // Publish quarantine artifact
      const result = await artifactStore.publishArtifact({
        artifactType: 'alerts_quarantine',
        schemaVersion: 1,
        logicalKey: `day=${date}/chain=${chain}/reason=validation_failed`,
        dataPath: tempPath,
        tags: {
          quarantine_reason: 'validation_failed',
          date,
          chain,
          run_id: runId,
        },
        inputArtifactIds: [],
        writerName: 'telegram-alert-ingestion',
        gitCommit: process.env.GIT_COMMIT || 'unknown',
      });

      if (result.deduped) {
        logger.info('Quarantine artifact already exists (deduped)', {
          artifactId: result.artifactId,
        });
      } else {
        logger.info('Quarantine artifact published', {
          artifactId: result.artifactId,
        });
      }

      return {
        artifactId: result.artifactId,
        count: invalid.length,
      };
    } finally {
      // Cleanup temp file
      await fs.unlink(tempPath).catch((err) => {
        logger.warn('Failed to cleanup temp quarantine file', {
          path: tempPath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (error) {
    logger.error('Failed to quarantine alerts', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      count: invalid.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Write invalid alerts to temp CSV file
 *
 * @param invalid - Invalid alerts
 * @returns Path to temp CSV file
 */
async function writeTempCsv(invalid: InvalidAlert[]): Promise<string> {
  const tempDir = os.tmpdir();
  const tempPath = path.join(
    tempDir,
    `quarantine_${Date.now()}_${Math.random().toString(36).substring(7)}.csv`
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
    'validation_error_code',
    'validation_error_reason',
  ].join(',');

  // CSV rows
  const rows = invalid.map((inv) => {
    const alert = inv.alert;
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
      escapeCsv(inv.code),
      escapeCsv(inv.reason),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');

  await fs.writeFile(tempPath, csv, 'utf8');

  logger.debug('Wrote temp quarantine CSV', {
    path: tempPath,
    rows: invalid.length,
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

