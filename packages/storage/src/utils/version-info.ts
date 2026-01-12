/**
 * Version information utilities for audit trail.
 *
 * Captures package version, Node version, and platform for run tracking.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface VersionInfo {
  packageVersion: string;
  nodeVersion: string;
  platform: string;
}

/**
 * Capture version info for audit trail.
 */
export function getVersionInfo(packageJsonPath?: string): VersionInfo {
  let packageVersion = 'unknown';
  try {
    const pkgPath = packageJsonPath ?? join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    packageVersion = pkg.version ?? 'unknown';
  } catch {
    // Ignore errors reading package.json
  }

  return {
    packageVersion,
    nodeVersion: process.version,
    platform: process.platform,
  };
}
