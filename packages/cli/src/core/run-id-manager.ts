/**
 * Run ID Manager - Deterministic, traceable run IDs
 *
 * Generates deterministic run IDs from command components.
 * Same inputs always produce the same run ID for reproducibility.
 */

import { createHash } from 'crypto';
import { DateTime } from 'luxon';

/**
 * Components used to generate a run ID
 */
export interface RunIdComponents {
  /** Command name (e.g., 'simulation.run-duckdb') */
  command: string;
  /** Strategy ID or name */
  strategyId: string;
  /** Mint address */
  mint: string;
  /** Alert timestamp (ISO 8601) */
  alertTimestamp: string;
  /** Optional: caller name */
  callerName?: string;
  /** Optional: custom suffix */
  suffix?: string;
}

/**
 * Generate deterministic run ID from components
 *
 * Format: {command}_{strategyId}_{mint_short}_{timestamp}_{hash8}[_{suffix}]
 *
 * Example: sim_PT2_So1111_20240101120000_a3f2b1c9
 *
 * @param components - Components to generate ID from
 * @returns Deterministic run ID
 */
export function generateRunId(components: RunIdComponents): string {
  const hashInput = [
    components.command,
    components.strategyId,
    components.mint,
    components.alertTimestamp,
    components.callerName || '',
    components.suffix || '',
  ].join('|');

  const hash = createHash('sha256').update(hashInput).digest('hex').substring(0, 8);
  const mintShort = components.mint.substring(0, 8);
  const timestamp = DateTime.fromISO(components.alertTimestamp, { zone: 'utc' }).toFormat(
    'yyyyMMddHHmmss'
  );

  const parts = [
    components.command.replace(/\./g, '_'),
    components.strategyId,
    mintShort,
    timestamp,
    hash,
  ];

  if (components.suffix) {
    parts.push(components.suffix);
  }

  return parts.join('_');
}

/**
 * Parsed run ID components (for debugging/tracing)
 */
export interface ParsedRunId {
  command?: string;
  strategyId?: string;
  mintShort?: string;
  timestamp?: string;
  hash?: string;
  suffix?: string;
}

/**
 * Parse run ID to extract components (for debugging/tracing)
 *
 * Note: This is best-effort parsing. The exact format may vary.
 * Format: command_strategyId_mintShort_timestamp_hash[_suffix]
 * We parse from the end since command name can have variable parts.
 *
 * @param runId - Run ID to parse
 * @returns Parsed components (partial)
 */
export function parseRunId(runId: string): ParsedRunId {
  const parts = runId.split('_');

  if (parts.length < 5) {
    return {};
  }

  // Parse from the end: hash, timestamp, mintShort, strategyId, then command (rest)
  // Format: command_strategyId_mintShort_timestamp_hash[_suffix]
  const hash = parts[parts.length - 1];
  const timestamp = parts[parts.length - 2];
  const mintShort = parts[parts.length - 3];
  const strategyId = parts[parts.length - 4];
  const command = parts.slice(0, parts.length - 4).join('_');

  // Check if there's a suffix (if hash is not 8 hex chars, it might be part of suffix)
  let actualHash = hash;
  let suffix: string | undefined = undefined;

  if (!/^[a-f0-9]{8}$/.test(hash)) {
    // Hash doesn't match pattern, might be suffix
    // Try to find the actual hash (8 hex chars) before the last part
    const hashIndex = parts.findIndex((p, i) => i >= parts.length - 3 && /^[a-f0-9]{8}$/.test(p));
    if (hashIndex >= 0) {
      actualHash = parts[hashIndex];
      suffix = parts.slice(hashIndex + 1).join('_');
    }
  } else if (parts.length > 5) {
    // Check if there's a suffix after the hash
    const potentialSuffix = parts.slice(parts.length - 1);
    if (potentialSuffix.length > 0 && !/^[a-f0-9]{8}$/.test(potentialSuffix[0])) {
      suffix = potentialSuffix.join('_');
    }
  }

  return {
    command,
    strategyId,
    mintShort,
    timestamp,
    hash: actualHash,
    suffix,
  };
}

/**
 * Check if a command should generate a run ID
 *
 * @param commandName - Command name (e.g., 'simulation.run-duckdb')
 * @returns True if command should generate run ID
 */
export function shouldGenerateRunId(commandName: string): boolean {
  // Commands that should generate run IDs
  const runIdCommands = ['simulation.run', 'simulation.run-duckdb', 'simulation.store-run-duckdb'];

  return runIdCommands.some((cmd) => commandName.includes(cmd));
}
