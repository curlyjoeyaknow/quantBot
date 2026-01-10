/**
 * Coverage Cache
 *
 * Stores and retrieves OHLCV coverage statistics for fast access
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { GetOhlcvStatsResult } from '@quantbot/workflows';
import { getArtifactsDir } from '@quantbot/core';

const CACHE_DIR = 'coverage-cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedResult {
  result: GetOhlcvStatsResult;
  timestamp: string;
  spec: {
    chain?: string;
    interval?: string;
    mint?: string;
  };
}

/**
 * Get cache file path for a given spec
 */
function getCachePath(spec: { chain?: string; interval?: string; mint?: string }): string {
  const artifactsDir = getArtifactsDir();
  const cacheDir = join(artifactsDir, CACHE_DIR);
  const specKey = JSON.stringify(spec);
  // Create a safe filename from spec
  const filename = Buffer.from(specKey).toString('base64').replace(/[/+=]/g, '_') + '.json';
  return join(cacheDir, filename);
}

/**
 * Store coverage result in cache
 */
export async function cacheCoverageResult(
  spec: { chain?: string; interval?: string; mint?: string },
  result: GetOhlcvStatsResult
): Promise<void> {
  try {
    const cachePath = getCachePath(spec);
    const cacheDir = join(cachePath, '..');
    await mkdir(cacheDir, { recursive: true });

    const cached: CachedResult = {
      result,
      timestamp: new Date().toISOString(),
      spec,
    };

    await writeFile(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
  } catch (error) {
    // Cache failures are non-fatal
    console.error('Failed to cache coverage result:', error);
  }
}

/**
 * Retrieve cached coverage result if available and not expired
 */
export async function getCachedCoverageResult(spec: {
  chain?: string;
  interval?: string;
  mint?: string;
}): Promise<GetOhlcvStatsResult | null> {
  try {
    const cachePath = getCachePath(spec);
    if (!existsSync(cachePath)) {
      return null;
    }

    const content = await readFile(cachePath, 'utf-8');
    const cached: CachedResult = JSON.parse(content);

    // Check if cache matches spec
    if (
      cached.spec.chain !== spec.chain ||
      cached.spec.interval !== spec.interval ||
      cached.spec.mint !== spec.mint
    ) {
      return null;
    }

    // Check if cache is expired
    const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
    if (cacheAge > CACHE_TTL_MS) {
      return null;
    }

    return cached.result;
  } catch (error) {
    // Cache read failures are non-fatal
    return null;
  }
}

/**
 * Clear all cached coverage results
 */
export async function clearCoverageCache(): Promise<void> {
  try {
    const artifactsDir = getArtifactsDir();
    const cacheDir = join(artifactsDir, CACHE_DIR);
    if (existsSync(cacheDir)) {
      const { rm } = await import('fs/promises');
      await rm(cacheDir, { recursive: true, force: true });
    }
  } catch (error) {
    // Cache clear failures are non-fatal
    console.error('Failed to clear coverage cache:', error);
  }
}
