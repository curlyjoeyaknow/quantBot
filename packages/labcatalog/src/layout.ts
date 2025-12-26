/**
 * Catalog Layout - Path conventions and naming
 *
 * Defines the directory structure for the lab catalog.
 * Pure functions - no FS operations.
 */

import { join } from 'path';
import type { SliceManifestV1 } from '@quantbot/core';
import { DateTime } from 'luxon';

/**
 * Catalog directory structure paths
 */
export interface CatalogPaths {
  /** Root catalog directory */
  catalogRoot: string;
  /** Data directory (slices/bars) */
  dataDir: string;
  /** Bars/candles directory */
  barsDir: string;
  /** Runs directory */
  runsDir: string;
  /** Root manifest path */
  rootManifestPath: string;
}

/**
 * Generate catalog directory structure
 *
 * @param basePath - Base path for catalog (default: './catalog')
 * @returns Catalog paths
 */
export function getCatalogPaths(basePath: string = './catalog'): CatalogPaths {
  return {
    catalogRoot: basePath,
    dataDir: join(basePath, 'data'),
    barsDir: join(basePath, 'data', 'bars'),
    runsDir: join(basePath, 'runs'),
    rootManifestPath: join(basePath, 'manifest.json'),
  };
}

/**
 * Generate path for a slice file
 *
 * Pattern: `data/bars/<token>/<start>_<end>.parquet`
 *
 * @param tokenId - Token mint address
 * @param startIso - Start timestamp (ISO 8601)
 * @param endIso - End timestamp (ISO 8601)
 * @param basePath - Base catalog path
 * @returns Path to slice file
 */
export function getSliceFilePath(
  tokenId: string,
  startIso: string,
  endIso: string,
  basePath: string = './catalog'
): string {
  // Normalize token ID for filesystem (sanitize)
  const sanitizedToken = sanitizeTokenId(tokenId);
  const barsDir = getCatalogPaths(basePath).barsDir;
  const tokenDir = join(barsDir, sanitizedToken);

  // Format dates as compact ISO (YYYYMMDDTHHMMSS)
  const startDate = DateTime.fromISO(startIso);
  const endDate = DateTime.fromISO(endIso);
  const startStr = startDate.toFormat("yyyyMMdd'T'HHmmss");
  const endStr = endDate.toFormat("yyyyMMdd'T'HHmmss");

  const filename = `${startStr}_${endStr}.parquet`;
  return join(tokenDir, filename);
}

/**
 * Generate path for a slice manifest
 *
 * Pattern: `data/bars/<token>/<manifestId>.manifest.json`
 *
 * @param manifestId - Manifest ID (hash-based)
 * @param tokenId - Token mint address (optional, for organization)
 * @param basePath - Base catalog path
 * @returns Path to manifest file
 */
export function getSliceManifestPath(
  manifestId: string,
  tokenId?: string,
  basePath: string = './catalog'
): string {
  const barsDir = getCatalogPaths(basePath).barsDir;

  if (tokenId) {
    // Store in token-specific directory
    const sanitizedToken = sanitizeTokenId(tokenId);
    const tokenDir = join(barsDir, sanitizedToken);
    return join(tokenDir, `${manifestId}.manifest.json`);
  }

  // Store at root of bars directory
  return join(barsDir, `${manifestId}.manifest.json`);
}

/**
 * Generate path for a run directory
 *
 * Pattern: `runs/<runId>/`
 *
 * @param runId - Run ID
 * @param basePath - Base catalog path
 * @returns Path to run directory
 */
export function getRunDirPath(runId: string, basePath: string = './catalog'): string {
  const runsDir = getCatalogPaths(basePath).runsDir;
  return join(runsDir, runId);
}

/**
 * Generate path for a run manifest
 *
 * Pattern: `runs/<runId>/manifest.json`
 *
 * @param runId - Run ID
 * @param basePath - Base catalog path
 * @returns Path to run manifest
 */
export function getRunManifestPath(runId: string, basePath: string = './catalog'): string {
  const runDir = getRunDirPath(runId, basePath);
  return join(runDir, 'manifest.json');
}

/**
 * Extract token ID and time range from a slice file path
 *
 * @param filePath - Path to slice file
 * @returns Parsed components or null if path is invalid
 */
export function parseSliceFilePath(
  filePath: string
): { tokenId: string; startIso: string; endIso: string } | null {
  // Expected pattern: .../bars/<token>/<start>_<end>.parquet
  const match = filePath.match(/\/bars\/([^/]+)\/(\d{8}T\d{6})_(\d{8}T\d{6})\.parquet$/);
  if (!match) {
    return null;
  }

  const [, tokenId, startStr, endStr] = match;

  // Convert compact format back to ISO
  // YYYYMMDDTHHMMSS -> YYYY-MM-DDTHH:MM:SS
  const startIso = formatCompactToIso(startStr);
  const endIso = formatCompactToIso(endStr);

  if (!startIso || !endIso) {
    return null;
  }

  return {
    tokenId: unsanitizeTokenId(tokenId),
    startIso,
    endIso,
  };
}

/**
 * Extract run ID from a run directory path
 *
 * @param runDirPath - Path to run directory
 * @returns Run ID or null if path is invalid
 */
export function parseRunDirPath(runDirPath: string): string | null {
  // Expected pattern: .../runs/<runId>/
  const match = runDirPath.match(/\/runs\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/**
 * Sanitize token ID for filesystem use
 *
 * Replaces invalid characters with underscores, limits length.
 *
 * @param tokenId - Token mint address
 * @returns Sanitized token ID
 */
export function sanitizeTokenId(tokenId: string): string {
  // Replace invalid filesystem characters with underscore
  // Keep alphanumeric, limit length to 100 chars
  return tokenId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
}

/**
 * Reverse sanitization (for display)
 *
 * Note: This is lossy - we can't perfectly reconstruct the original.
 * In practice, catalog should store a mapping file.
 *
 * @param sanitized - Sanitized token ID
 * @returns Original token ID (approximation)
 */
export function unsanitizeTokenId(sanitized: string): string {
  // This is approximate - actual mapping should be in manifest
  return sanitized;
}

/**
 * Convert compact date format to ISO 8601
 *
 * @param compact - Compact format (YYYYMMDDTHHMMSS)
 * @returns ISO 8601 format (YYYY-MM-DDTHH:MM:SS) or null if invalid
 */
function formatCompactToIso(compact: string): string | null {
  // YYYYMMDDTHHMMSS -> YYYY-MM-DDTHH:MM:SS
  if (compact.length !== 15 || compact[8] !== 'T') {
    return null;
  }

  const year = compact.substring(0, 4);
  const month = compact.substring(4, 6);
  const day = compact.substring(6, 8);
  const hour = compact.substring(9, 11);
  const minute = compact.substring(11, 13);
  const second = compact.substring(13, 15);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Generate slice directory path for a token
 *
 * @param tokenId - Token mint address
 * @param basePath - Base catalog path
 * @returns Path to token's slice directory
 */
export function getTokenSliceDir(tokenId: string, basePath: string = './catalog'): string {
  const sanitizedToken = sanitizeTokenId(tokenId);
  const barsDir = getCatalogPaths(basePath).barsDir;
  return join(barsDir, sanitizedToken);
}
