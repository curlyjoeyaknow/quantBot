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
  const timestamp = DateTime.fromISO(components.alertTimestamp).toFormat('yyyyMMddHHmmss');

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
 *
 * @param runId - Run ID to parse
 * @returns Parsed components (partial)
 */
export function parseRunId(runId: string): ParsedRunId {
  const parts = runId.split('_');

  if (parts.length < 5) {
    return {};
  }

  // Format: command_strategyId_mintShort_timestamp_hash[_suffix]
  const [command, strategyId, mintShort, timestamp, hash, ...suffixParts] = parts;

  return {
    command,
    strategyId,
    mintShort,
    timestamp,
    hash,
    suffix: suffixParts.length > 0 ? suffixParts.join('_') : undefined,
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
