"use strict";
/**
 * Cache manager for API responses to avoid wasting credits
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedResponse = getCachedResponse;
exports.cacheResponse = cacheResponse;
exports.cacheNoDataResponse = cacheNoDataResponse;
exports.getCacheStats = getCacheStats;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const logger_1 = require("../../src/utils/logger");
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'api-responses');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
/**
 * Get cache key for a request
 */
function getCacheKey(tokenAddress, chain, startTime, endTime, interval) {
    const keyString = `${tokenAddress}_${chain}_${startTime}_${endTime}_${interval}`;
    return (0, crypto_1.createHash)('sha256').update(keyString).digest('hex');
}
/**
 * Get cache file path
 */
function getCacheFilePath(cacheKey) {
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
function getCachedResponse(tokenAddress, chain, startTime, endTime, interval) {
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
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const age = Date.now() - cached.timestamp;
        if (age > CACHE_TTL) {
            // Cache expired, delete it
            fs.unlinkSync(cacheFile);
            return null;
        }
        logger_1.logger.debug('Using cached API response', {
            tokenAddress: tokenAddress.substring(0, 20),
            ageHours: (age / (60 * 60 * 1000)).toFixed(1),
        });
        return cached;
    }
    catch (error) {
        logger_1.logger.warn('Error reading cache', { error: error.message });
        return null;
    }
}
/**
 * Store response in cache
 */
function cacheResponse(tokenAddress, chain, startTime, endTime, interval, data) {
    try {
        const cacheKey = getCacheKey(tokenAddress, chain, startTime, endTime, interval);
        const cacheFile = getCacheFilePath(cacheKey);
        const cached = {
            timestamp: Date.now(),
            data,
            tokenAddress,
            chain,
            startTime,
            endTime,
            interval,
        };
        fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2));
        logger_1.logger.debug('Cached API response', {
            tokenAddress: tokenAddress.substring(0, 20),
            cacheKey: cacheKey.substring(0, 8),
        });
    }
    catch (error) {
        logger_1.logger.warn('Error caching response', { error: error.message });
    }
}
/**
 * Cache a "no data" response (to avoid retrying tokens with no data)
 */
function cacheNoDataResponse(tokenAddress, chain, startTime, endTime, interval) {
    cacheResponse(tokenAddress, chain, startTime, endTime, interval, { items: [] });
}
/**
 * Get cache statistics
 */
function getCacheStats() {
    let totalFiles = 0;
    let totalSize = 0;
    if (!fs.existsSync(CACHE_DIR)) {
        return { totalFiles: 0, totalSize: 0 };
    }
    function countFiles(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                countFiles(filePath);
            }
            else if (file.endsWith('.json')) {
                totalFiles++;
                totalSize += stat.size;
            }
        }
    }
    countFiles(CACHE_DIR);
    return { totalFiles, totalSize };
}
//# sourceMappingURL=cache-manager.js.map