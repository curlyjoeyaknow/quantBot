/**
 * Alert Normalization
 *
 * Converts raw Telegram export messages to canonical alert schema.
 * Preserves mint addresses exactly (no truncation, no case changes).
 *
 * @packageDocumentation
 */

import { logger } from '@quantbot/utils';
import type { NormalizedTelegramMessage } from '../telegram/normalize.js';
import { extractSolanaAddresses } from '../extractSolanaAddresses.js';

/**
 * Canonical alert schema
 *
 * This is the stable, authoritative schema for alert artifacts.
 * All alerts must conform to this schema before publishing.
 */
export interface CanonicalAlert {
  /** Alert timestamp (ISO8601 UTC) */
  alert_ts_utc: string;

  /** Chain ('solana' | 'evm') */
  chain: string;

  /** Full mint address (NEVER truncated, case-preserved) */
  mint: string;

  /** Telegram chat ID */
  alert_chat_id: number;

  /** Telegram message ID */
  alert_message_id: number;

  /** Content-derived stable ID (for deduplication) */
  alert_id: string;

  /** Normalized caller name */
  caller_name_norm: string;

  /** Caller ID (derived from caller_name_norm) */
  caller_id: string;

  /** How mint was extracted ('text' | 'link' | 'reply') */
  mint_source: string;

  /** Bot name (if extracted from bot message) */
  bot_name: string;

  /** Ingestion run ID (for provenance) */
  run_id: string;
}

/**
 * Normalization options
 */
export interface NormalizeAlertsOptions {
  /** Chain for this batch */
  chain: 'solana' | 'evm';

  /** Run ID for provenance tracking */
  runId: string;

  /** Default caller name (if not extractable from message) */
  defaultCallerName?: string;
}

/**
 * Normalization result
 */
export interface NormalizeAlertsResult {
  /** Successfully normalized alerts */
  alerts: CanonicalAlert[];

  /** Skipped messages (with reasons) */
  skipped: Array<{
    messageId: number;
    reason: string;
  }>;
}

/**
 * Normalize Telegram messages to canonical alerts
 *
 * @param messages - Normalized Telegram messages
 * @param options - Normalization options
 * @returns Normalized alerts and skipped messages
 */
export function normalizeAlerts(
  messages: NormalizedTelegramMessage[],
  options: NormalizeAlertsOptions
): NormalizeAlertsResult {
  const alerts: CanonicalAlert[] = [];
  const skipped: Array<{ messageId: number; reason: string }> = [];

  for (const msg of messages) {
    try {
      // Skip service messages
      if (msg.isService) {
        skipped.push({ messageId: msg.messageId, reason: 'service_message' });
        continue;
      }

      // Extract mint addresses
      const mints = extractMintsFromMessage(msg, options.chain);
      if (mints.length === 0) {
        skipped.push({ messageId: msg.messageId, reason: 'no_mint_found' });
        continue;
      }

      // Extract caller name
      const callerName = extractCallerName(msg, options.defaultCallerName);
      if (!callerName) {
        skipped.push({ messageId: msg.messageId, reason: 'no_caller_name' });
        continue;
      }

      // Create alert for each mint
      for (const { mint, source } of mints) {
        const alert = createCanonicalAlert({
          message: msg,
          mint,
          mintSource: source,
          callerName,
          chain: options.chain,
          runId: options.runId,
        });

        alerts.push(alert);
      }
    } catch (error) {
      logger.error('Failed to normalize message', {
        messageId: msg.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped.push({
        messageId: msg.messageId,
        reason: `error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { alerts, skipped };
}

/**
 * Extract mint addresses from message
 */
function extractMintsFromMessage(
  msg: NormalizedTelegramMessage,
  chain: 'solana' | 'evm'
): Array<{ mint: string; source: string }> {
  const mints: Array<{ mint: string; source: string }> = [];

  if (chain === 'solana') {
    // Extract from text
    const textMints = extractSolanaAddresses(msg.text);
    for (const mint of textMints) {
      mints.push({ mint, source: 'text' });
    }

    // Extract from links
    for (const link of msg.links) {
      const linkMints = extractSolanaAddresses(link.href);
      for (const mint of linkMints) {
        // Deduplicate (prefer text source)
        if (!mints.some((m) => m.mint === mint)) {
          mints.push({ mint, source: 'link' });
        }
      }
    }
  } else {
    // EVM extraction (simplified - can be enhanced)
    const evmPattern = /0x[a-fA-F0-9]{40}/g;
    const textMatches = msg.text.match(evmPattern) || [];
    for (const mint of textMatches) {
      mints.push({ mint, source: 'text' });
    }

    // Extract from links
    for (const link of msg.links) {
      const linkMatches = link.href.match(evmPattern) || [];
      for (const mint of linkMatches) {
        if (!mints.some((m) => m.mint === mint)) {
          mints.push({ mint, source: 'link' });
        }
      }
    }
  }

  return mints;
}

/**
 * Extract caller name from message
 */
function extractCallerName(
  msg: NormalizedTelegramMessage,
  defaultCallerName?: string
): string | null {
  // Prefer fromName
  if (msg.fromName) {
    return normalizeCallerName(msg.fromName);
  }

  // Fallback to default
  if (defaultCallerName) {
    return normalizeCallerName(defaultCallerName);
  }

  return null;
}

/**
 * Normalize caller name
 *
 * Converts caller name to lowercase, replaces spaces with underscores.
 */
function normalizeCallerName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Create canonical alert from components
 */
function createCanonicalAlert(params: {
  message: NormalizedTelegramMessage;
  mint: string;
  mintSource: string;
  callerName: string;
  chain: string;
  runId: string;
}): CanonicalAlert {
  const { message, mint, mintSource, callerName, chain, runId } = params;

  // Create stable alert ID (content-derived)
  const alertId = createAlertId({
    chatId: message.chatId,
    messageId: message.messageId,
    mint,
    timestampMs: message.timestampMs,
  });

  // Create caller ID (normalized name)
  const callerId = callerName;

  // Extract bot name (if present)
  const botName = extractBotName(message.text);

  return {
    alert_ts_utc: new Date(message.timestampMs).toISOString(),
    chain,
    mint, // ⚠️ NEVER MODIFIED - preserved exactly
    alert_chat_id: parseInt(message.chatId, 10) || 0,
    alert_message_id: message.messageId,
    alert_id: alertId,
    caller_name_norm: callerName,
    caller_id: callerId,
    mint_source: mintSource,
    bot_name: botName,
    run_id: runId,
  };
}

/**
 * Create stable alert ID
 *
 * Content-derived ID for deduplication.
 * Format: {chatId}_{messageId}_{mint}_{timestampMs}
 */
function createAlertId(params: {
  chatId: string;
  messageId: number;
  mint: string;
  timestampMs: number;
}): string {
  const { chatId, messageId, mint, timestampMs } = params;
  // Use first 8 chars of mint for brevity (still unique enough)
  const mintPrefix = mint.substring(0, 8);
  return `${chatId}_${messageId}_${mintPrefix}_${timestampMs}`;
}

/**
 * Extract bot name from message text
 *
 * Looks for common bot patterns (e.g., "Phanes:", "Rick:", etc.)
 */
function extractBotName(text: string): string {
  const botPatterns = [
    /^(Phanes|Rick|Maestro|BonkBot|Trojan|Sol Trading Bot):/i,
    /\[(Phanes|Rick|Maestro|BonkBot|Trojan|Sol Trading Bot)\]/i,
  ];

  for (const pattern of botPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return '';
}

