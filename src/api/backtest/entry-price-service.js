"use strict";
/**
 * Entry Price Determination Service
 *
 * Determines entry price based on alert, time, or manual input.
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
exports.determineEntryPrice = determineEntryPrice;
const ohlcv_service_1 = require("../../services/ohlcv-service");
const logger_1 = require("../../utils/logger");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * Determine entry price based on type
 */
async function determineEntryPrice(mint, chain, entryTime, entryType, manualPrice) {
    switch (entryType) {
        case 'alert':
            return await getAlertEntryPrice(mint, chain, entryTime);
        case 'time':
            return await getTimeEntryPrice(mint, chain, entryTime);
        case 'manual':
            if (manualPrice === undefined) {
                throw new Error('Manual entry price is required');
            }
            return {
                entryPrice: manualPrice,
                entryTimestamp: Math.floor(entryTime.toSeconds()),
                entryType: 'manual',
                source: 'user_provided',
            };
        default:
            throw new Error(`Unknown entry type: ${entryType}`);
    }
}
/**
 * Get entry price from alert (ca_calls table)
 */
async function getAlertEntryPrice(mint, chain, entryTime) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
            const entryUnix = Math.floor(entryTime.toSeconds());
            // Find the closest alert within 1 hour window
            const windowStart = entryUnix - 3600; // 1 hour before
            const windowEnd = entryUnix + 3600; // 1 hour after
            db.get(`SELECT call_price, call_timestamp
         FROM ca_calls
         WHERE mint = ? AND chain = ?
           AND call_timestamp >= ? AND call_timestamp <= ?
         ORDER BY ABS(call_timestamp - ?)
         LIMIT 1`, [mint, chain, windowStart, windowEnd, entryUnix], (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                if (!row || !row.call_price) {
                    // Fallback to time-based entry
                    logger_1.logger.warn('No alert found, falling back to time-based entry', {
                        mint: mint.substring(0, 20),
                    });
                    return getTimeEntryPrice(mint, chain, entryTime)
                        .then(resolve)
                        .catch(reject);
                }
                resolve({
                    entryPrice: row.call_price,
                    entryTimestamp: row.call_timestamp,
                    entryType: 'alert',
                    source: 'ca_calls',
                });
            });
        });
    });
}
/**
 * Get entry price at specific time from candles
 */
async function getTimeEntryPrice(mint, chain, entryTime) {
    try {
        // Fetch candles around the entry time (5 minutes window)
        const startTime = entryTime.minus({ minutes: 2 });
        const endTime = entryTime.plus({ minutes: 3 });
        const candles = await ohlcv_service_1.ohlcvService.getCandles(mint, chain, startTime, endTime, { interval: '1m', useCache: true });
        if (candles.length === 0) {
            throw new Error('No candle data available for entry time');
        }
        // Find the candle that contains the entry time
        const entryUnix = Math.floor(entryTime.toSeconds());
        let entryCandle = candles.find((c) => c.timestamp <= entryUnix && c.timestamp + 60 >= entryUnix);
        // If no exact match, use the closest candle
        if (!entryCandle) {
            entryCandle = candles.reduce((closest, candle) => {
                const closestDiff = Math.abs(closest.timestamp - entryUnix);
                const candleDiff = Math.abs(candle.timestamp - entryUnix);
                return candleDiff < closestDiff ? candle : closest;
            });
        }
        // Use the open price of the entry candle (or close if open is not available)
        const entryPrice = entryCandle.open || entryCandle.close;
        if (!entryPrice || isNaN(entryPrice)) {
            throw new Error('Invalid entry price from candles');
        }
        return {
            entryPrice,
            entryTimestamp: entryCandle.timestamp,
            entryType: 'time',
            source: 'ohlcv_candles',
        };
    }
    catch (error) {
        logger_1.logger.error('Failed to get time-based entry price', error, {
            mint: mint.substring(0, 20),
        });
        throw error;
    }
}
//# sourceMappingURL=entry-price-service.js.map