"use strict";
/**
 * Backtest Runner
 *
 * Shared logic for running single backtests
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
exports.runSingleBacktest = runSingleBacktest;
const luxon_1 = require("luxon");
const ohlcv_service_1 = require("../../services/ohlcv-service");
const token_service_1 = require("../../services/token-service");
const entry_price_service_1 = require("./entry-price-service");
const database_1 = require("../../utils/database");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * Run a single backtest
 */
async function runSingleBacktest(params) {
    // Get strategy by ID
    const strategy = await getStrategyById(params.strategyId, params.userId);
    if (!strategy) {
        throw new Error('Strategy not found');
    }
    // Ensure token is in registry
    await token_service_1.tokenService.addToken(params.mint, params.chain, params.userId);
    // Determine time range
    const entryTime = params.entryTime || luxon_1.DateTime.utc();
    const endTime = params.endTime || entryTime.plus({ hours: params.durationHours || 24 });
    const startTime = params.startTime || entryTime.minus({ hours: 1 }); // 1 hour before entry for lookback
    // Determine entry price
    const entryPriceResult = await (0, entry_price_service_1.determineEntryPrice)(params.mint, params.chain, entryTime, params.entryType || 'alert');
    // Fetch candles
    const candles = await ohlcv_service_1.ohlcvService.getCandles(params.mint, params.chain, startTime, endTime, {
        interval: '5m',
        useCache: true,
        alertTime: entryTime,
    });
    if (candles.length === 0) {
        throw new Error('No candle data available for the specified time range');
    }
    // Run simulation
    const { simulateStrategy } = await Promise.resolve().then(() => __importStar(require('../../simulation/engine')));
    const result = simulateStrategy(candles, strategy.strategy, params.stopLossConfig, params.entryConfig, params.reEntryConfig, params.costConfig);
    // Get token metadata
    const token = await token_service_1.tokenService.getToken(params.mint, params.chain);
    // Save simulation run
    const runId = await (0, database_1.saveSimulationRun)({
        userId: params.userId,
        mint: params.mint,
        chain: params.chain,
        tokenName: token?.tokenName,
        tokenSymbol: token?.tokenSymbol,
        startTime,
        endTime,
        strategy: strategy.strategy,
        stopLossConfig: params.stopLossConfig || { initial: -0.5, trailing: 'none' },
        finalPnl: result.finalPnl,
        totalCandles: result.totalCandles,
        events: result.events,
        entryType: entryPriceResult.entryType,
        entryPrice: entryPriceResult.entryPrice,
        entryTimestamp: entryPriceResult.entryTimestamp,
        strategyName: strategy.name,
    });
    return {
        runId,
        result: {
            finalPnl: result.finalPnl,
            entryPrice: result.entryPrice,
            finalPrice: result.finalPrice,
            totalCandles: result.totalCandles,
            entryOptimization: result.entryOptimization,
            events: result.events,
        },
        entryPrice: {
            price: entryPriceResult.entryPrice,
            timestamp: entryPriceResult.entryTimestamp,
            type: entryPriceResult.entryType,
            source: entryPriceResult.source,
        },
        token: {
            mint: params.mint,
            chain: params.chain,
            name: token?.tokenName,
            symbol: token?.tokenSymbol,
        },
        timeRange: {
            start: startTime.toISO(),
            end: endTime.toISO(),
            entry: entryTime.toISO(),
        },
    };
}
/**
 * Get strategy by ID
 */
async function getStrategyById(id, userId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
            db.get('SELECT * FROM strategies WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                if (!row) {
                    return resolve(null);
                }
                resolve({
                    id: row.id,
                    userId: row.user_id,
                    name: row.name,
                    description: row.description,
                    strategy: JSON.parse(row.strategy),
                    stopLossConfig: JSON.parse(row.stop_loss_config),
                    isDefault: row.is_default === 1,
                    createdAt: row.created_at,
                });
            });
        });
    });
}
//# sourceMappingURL=backtest-runner.js.map