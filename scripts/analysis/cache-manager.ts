/**
 * Cache manager for API responses to avoid wasting credits
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { logger } from '../../src/utils/logger';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'api-responses');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

interface CachedResponse {
  timestamp: number;
  data: any;
  tokenAddress: string;
  chain: string;
  startTime: number;
  endTime: number;
  interval: string;
}

/**
 * Get cache key for a request
 */
function getCacheKey(
  tokenAddress: string,
  chain: string,
  startTime: number,
  endTime: number,
  interval: string
): string {
  const keyString = `${tokenAddress}_${chain}_${startTime}_${endTime}_${interval}`;
  return createHash('sha256').update(keyString).digest('hex');
}

/**
 * Get cache file path
 */
function getCacheFilePath(cacheKey: string): string {
  // Use first 2 chars of hash for directory structure
  const subDir = cacheKey.substring(0, 2);
  const cacheSubDir = path.join(CACHE_DIR, subDir);
  if (!fs.existsSync(cacheSubDir)) {
    fs.mkdirSync(cacheSubDir, { recursive: true });
  }
  return path.join(cacheSubDir, `${cacheKey}.json`);
}

/**
 * Get cached response if available and not expired
 */
export function getCachedResponse(
  tokenAddress: string,
  chain: string,
  startTime: number,
  endTime: number,
  interval: string
): CachedResponse | null {
  // Bypass cache if environment variable is set
  if (process.env.BYPASS_CACHE === 'true') {
    return null;
  }

  try {
    const cacheKey = getCacheKey(tokenAddress, chain, startTime, endTime, interval);
    const cacheFile = getCacheFilePath(cacheKey);

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const cached: CachedResponse = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const age = Date.now() - cached.timestamp;

    if (age > CACHE_TTL) {
      // Cache expired, delete it
      fs.unlinkSync(cacheFile);
      return null;
    }

    logger.debug('Using cached API response', {
      tokenAddress: tokenAddress.substring(0, 20),
      ageHours: (age / (60 * 60 * 1000)).toFixed(1),
    });

    return cached;
  } catch (error: any) {
    logger.warn('Error reading cache', { error: error.message });
    return null;
  }
}

/**
 * Store response in cache
 */
export function cacheResponse(
  tokenAddress: string,
  chain: string,
  startTime: number,
  endTime: number,
  interval: string,
  data: any
): void {
  try {
    const cacheKey = getCacheKey(tokenAddress, chain, startTime, endTime, interval);
    const cacheFile = getCacheFilePath(cacheKey);

    const cached: CachedResponse = {
      timestamp: Date.now(),
      data,
      tokenAddress,
      chain,
      startTime,
      endTime,
      interval,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2));
    logger.debug('Cached API response', {
      tokenAddress: tokenAddress.substring(0, 20),
      cacheKey: cacheKey.substring(0, 8),
    });
  } catch (error: any) {
    logger.warn('Error caching response', { error: error.message });
  }
}

/**
 * Cache a "no data" response (to avoid retrying tokens with no data)
 */
export function cacheNoDataResponse(
  tokenAddress: string,
  chain: string,
  startTime: number,
  endTime: number,
  interval: string
): void {
  cacheResponse(tokenAddress, chain, startTime, endTime, interval, { items: [] });
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { totalFiles: number; totalSize: number } {
  let totalFiles = 0;
  let totalSize = 0;

  if (!fs.existsSync(CACHE_DIR)) {
    return { totalFiles: 0, totalSize: 0 };
  }

  function countFiles(dir: string): void {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        countFiles(filePath);
      } else if (file.endsWith('.json')) {
        totalFiles++;
        totalSize += stat.size;
      }
    }
  }

  countFiles(CACHE_DIR);

  return { totalFiles, totalSize };
}

