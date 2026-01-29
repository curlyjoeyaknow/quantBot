/**
 * Alert Validation
 *
 * Validates canonical alerts before publishing to artifact store.
 * Ensures data quality and catches malformed alerts early.
 *
 * @packageDocumentation
 */

import { logger } from '@quantbot/utils';
import { isSolanaAddress, isEvmAddress } from '@quantbot/utils';
import type { CanonicalAlert } from './normalize.js';

/**
 * Validation result
 */
export interface ValidationResult {
  /** Valid alerts (ready for publishing) */
  valid: CanonicalAlert[];

  /** Invalid alerts (with reasons) */
  invalid: InvalidAlert[];
}

/**
 * Invalid alert with reason
 */
export interface InvalidAlert {
  /** The alert that failed validation */
  alert: CanonicalAlert;

  /** Validation failure reason */
  reason: string;

  /** Validation failure code */
  code: ValidationErrorCode;
}

/**
 * Validation error codes
 */
export type ValidationErrorCode =
  | 'missing_required_field'
  | 'invalid_mint_address'
  | 'invalid_timestamp'
  | 'invalid_chain'
  | 'duplicate_alert_id'
  | 'invalid_chat_id'
  | 'invalid_message_id';

/**
 * Validate alerts
 *
 * @param alerts - Alerts to validate
 * @returns Valid and invalid alerts
 */
export function validateAlerts(alerts: CanonicalAlert[]): ValidationResult {
  const valid: CanonicalAlert[] = [];
  const invalid: InvalidAlert[] = [];
  const seenAlertIds = new Set<string>();

  for (const alert of alerts) {
    const validationError = validateAlert(alert, seenAlertIds);

    if (validationError) {
      invalid.push({
        alert,
        reason: validationError.reason,
        code: validationError.code,
      });
      logger.debug('Alert validation failed', {
        alertId: alert.alert_id,
        reason: validationError.reason,
        code: validationError.code,
      });
    } else {
      valid.push(alert);
      seenAlertIds.add(alert.alert_id);
    }
  }

  return { valid, invalid };
}

/**
 * Validate single alert
 *
 * @param alert - Alert to validate
 * @param seenAlertIds - Set of already-seen alert IDs (for duplicate detection)
 * @returns Validation error or null if valid
 */
function validateAlert(
  alert: CanonicalAlert,
  seenAlertIds: Set<string>
): { reason: string; code: ValidationErrorCode } | null {
  // Required fields
  if (!alert.alert_ts_utc) {
    return { reason: 'Missing alert_ts_utc', code: 'missing_required_field' };
  }
  if (!alert.chain) {
    return { reason: 'Missing chain', code: 'missing_required_field' };
  }
  if (!alert.mint) {
    return { reason: 'Missing mint', code: 'missing_required_field' };
  }
  if (!alert.alert_id) {
    return { reason: 'Missing alert_id', code: 'missing_required_field' };
  }
  if (!alert.caller_name_norm) {
    return { reason: 'Missing caller_name_norm', code: 'missing_required_field' };
  }
  if (!alert.caller_id) {
    return { reason: 'Missing caller_id', code: 'missing_required_field' };
  }
  if (!alert.run_id) {
    return { reason: 'Missing run_id', code: 'missing_required_field' };
  }

  // Validate timestamp
  const timestamp = new Date(alert.alert_ts_utc);
  if (isNaN(timestamp.getTime())) {
    return { reason: `Invalid timestamp: ${alert.alert_ts_utc}`, code: 'invalid_timestamp' };
  }

  // Validate chain
  if (alert.chain !== 'solana' && alert.chain !== 'evm') {
    return { reason: `Invalid chain: ${alert.chain}`, code: 'invalid_chain' };
  }

  // Validate mint address
  const mintError = validateMintAddress(alert.mint, alert.chain);
  if (mintError) {
    return mintError;
  }

  // Validate chat ID
  if (typeof alert.alert_chat_id !== 'number' || alert.alert_chat_id < 0) {
    return {
      reason: `Invalid chat ID: ${alert.alert_chat_id}`,
      code: 'invalid_chat_id',
    };
  }

  // Validate message ID
  if (typeof alert.alert_message_id !== 'number' || alert.alert_message_id < 0) {
    return {
      reason: `Invalid message ID: ${alert.alert_message_id}`,
      code: 'invalid_message_id',
    };
  }

  // Check for duplicate alert_id
  if (seenAlertIds.has(alert.alert_id)) {
    return {
      reason: `Duplicate alert_id: ${alert.alert_id}`,
      code: 'duplicate_alert_id',
    };
  }

  return null;
}

/**
 * Validate mint address
 *
 * @param mint - Mint address to validate
 * @param chain - Chain ('solana' | 'evm')
 * @returns Validation error or null if valid
 */
function validateMintAddress(
  mint: string,
  chain: string
): { reason: string; code: ValidationErrorCode } | null {
  // Check length
  if (mint.length < 32 || mint.length > 44) {
    return {
      reason: `Mint address length invalid: ${mint.length} (expected 32-44)`,
      code: 'invalid_mint_address',
    };
  }

  // Chain-specific validation
  if (chain === 'solana') {
    if (!isSolanaAddress(mint)) {
      return {
        reason: `Invalid Solana address: ${mint}`,
        code: 'invalid_mint_address',
      };
    }
  } else if (chain === 'evm') {
    if (!isEvmAddress(mint)) {
      return {
        reason: `Invalid EVM address: ${mint}`,
        code: 'invalid_mint_address',
      };
    }
  }

  return null;
}

/**
 * Get validation summary
 *
 * @param result - Validation result
 * @returns Human-readable summary
 */
export function getValidationSummary(result: ValidationResult): string {
  const total = result.valid.length + result.invalid.length;
  const validPercent = total > 0 ? ((result.valid.length / total) * 100).toFixed(1) : '0.0';

  const lines = [
    `Validation Summary:`,
    `  Total: ${total}`,
    `  Valid: ${result.valid.length} (${validPercent}%)`,
    `  Invalid: ${result.invalid.length}`,
  ];

  if (result.invalid.length > 0) {
    lines.push('');
    lines.push('Invalid Alerts by Reason:');

    // Group by reason
    const byReason = new Map<string, number>();
    for (const inv of result.invalid) {
      const count = byReason.get(inv.code) || 0;
      byReason.set(inv.code, count + 1);
    }

    for (const [code, count] of byReason.entries()) {
      lines.push(`  ${code}: ${count}`);
    }
  }

  return lines.join('\n');
}

