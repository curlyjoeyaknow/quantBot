"use strict";
/**
 * Backtest API
 *
 * POST /api/backtest/run - Execute single backtest
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
exports.POST = POST;
const server_1 = require("next/server");
const luxon_1 = require("luxon");
const zod_1 = require("zod");
const config_1 = require("../../simulation/config");
const ohlcv_service_1 = require("../../services/ohlcv-service");
const token_service_1 = require("../../services/token-service");
const entry_price_service_1 = require("./entry-price-service");
const database_1 = require("../../utils/database");
const logger_1 = require("../../utils/logger");
const BacktestRequestSchema = zod_1.z.object({
    userId: zod_1.z.number().int().positive(),
    mint: zod_1.z.string().min(32),
    chain: zod_1.z.string().default('solana'),
    strategyId: zod_1.z.number().int().positive().optional(),
    strategy: zod_1.z.array(config_1.StrategyLegSchema).optional(),
    stopLossConfig: config_1.StopLossConfigSchema.optional(),
    entryConfig: config_1.EntryConfigSchema.optional(),
    reEntryConfig: config_1.ReEntryConfigSchema.optional(),
    costConfig: config_1.CostConfigSchema.optional(),
    entryType: zod_1.z.enum(['alert', 'time', 'manual']).default('alert'),
    entryTime: zod_1.z.string().datetime().optional(), // ISO datetime string
    manualEntryPrice: zod_1.z.number().positive().optional(),
    startTime: zod_1.z.string().datetime().optional(),
    endTime: zod_1.z.string().datetime().optional(),
    durationHours: zod_1.z.number().int().min(1).max(24 * 90).optional().default(24),
});
/**
 * POST /api/backtest/run - Execute single backtest
 */
async function POST(request) {
    try {
        const body = await request.json();
        const validated = BacktestRequestSchema.parse(body);
        // Use strategy ID or create temporary strategy
        if (validated.strategyId) {
            const result = await runSingleBacktest({
                userId: validated.userId,
                mint: validated.mint,
                chain: validated.chain,
                strategyId: validated.strategyId,
                stopLossConfig: validated.stopLossConfig,
                entryConfig: validated.entryConfig,
                reEntryConfig: validated.reEntryConfig,
                costConfig: validated.costConfig,
                entryType: validated.entryType,
                entryTime: validated.entryTime
                    ? luxon_1.DateTime.fromISO(validated.entryTime)
                    : undefined,
                startTime: validated.startTime
                    ? luxon_1.DateTime.fromISO(validated.startTime)
                    : undefined,
                endTime: validated.endTime
                    ? luxon_1.DateTime.fromISO(validated.endTime)
                    : undefined,
                durationHours: validated.durationHours,
            });
            return server_1.NextResponse.json(result);
        }
        else if (validated.strategy) {
            // For inline strategy, we need to run it directly
            // This is a simplified version - in production, you might want to save it first
            const entryTime = validated.entryTime
                ? luxon_1.DateTime.fromISO(validated.entryTime)
                : luxon_1.DateTime.utc();
            const endTime = validated.endTime
                ? luxon_1.DateTime.fromISO(validated.endTime)
                : entryTime.plus({ hours: validated.durationHours });
            const startTime = validated.startTime
                ? luxon_1.DateTime.fromISO(validated.startTime)
                : entryTime.minus({ hours: 1 });
            const entryPriceResult = await (0, entry_price_service_1.determineEntryPrice)(validated.mint, validated.chain, entryTime, validated.entryType, validated.manualEntryPrice);
            const candles = await ohlcv_service_1.ohlcvService.getCandles(validated.mint, validated.chain, startTime, endTime, {
                interval: '5m',
                useCache: true,
                alertTime: entryTime,
            });
            if (candles.length === 0) {
                return server_1.NextResponse.json({ error: 'No candle data available' }, { status: 404 });
            }
            const { simulateStrategy } = await Promise.resolve().then(() => __importStar(require('../../simulation/engine')));
            const result = simulateStrategy(candles, validated.strategy, validated.stopLossConfig, validated.entryConfig, validated.reEntryConfig, validated.costConfig);
            const token = await token_service_1.tokenService.getToken(validated.mint, validated.chain);
            const runId = await (0, database_1.saveSimulationRun)({
                userId: validated.userId,
                mint: validated.mint,
                chain: validated.chain,
                tokenName: token?.tokenName,
                tokenSymbol: token?.tokenSymbol,
                startTime,
                endTime,
                strategy: validated.strategy,
                stopLossConfig: validated.stopLossConfig || { initial: -0.5, trailing: 'none' },
                finalPnl: result.finalPnl,
                totalCandles: result.totalCandles,
                events: result.events,
                entryType: entryPriceResult.entryType,
                entryPrice: entryPriceResult.entryPrice,
                entryTimestamp: entryPriceResult.entryTimestamp,
            });
            return server_1.NextResponse.json({
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
                    mint: validated.mint,
                    chain: validated.chain,
                    name: token?.tokenName,
                    symbol: token?.tokenSymbol,
                },
                timeRange: {
                    start: startTime.toISO(),
                    end: endTime.toISO(),
                    entry: entryTime.toISO(),
                },
            });
        }
        else {
            return server_1.NextResponse.json({ error: 'Either strategyId or strategy is required' }, { status: 400 });
        }
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return server_1.NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
        }
        logger_1.logger.error('Error running backtest', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to run backtest' }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map