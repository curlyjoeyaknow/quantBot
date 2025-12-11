"use strict";
/**
 * Batch Backtest API
 *
 * POST /api/backtest/batch - Run backtest on multiple tokens
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
const config_1 = require("../../../simulation/config");
const token_filter_service_1 = require("../../../services/token-filter-service");
const logger_1 = require("../../../utils/logger");
const BatchBacktestRequestSchema = zod_1.z.object({
    userId: zod_1.z.number().int().positive(),
    strategyId: zod_1.z.number().int().positive(),
    filterCriteria: zod_1.z.object({
        chain: zod_1.z.string().optional(),
        dateRange: zod_1.z.object({
            start: zod_1.z.string().datetime(),
            end: zod_1.z.string().datetime(),
        }).optional(),
        caller: zod_1.z.string().optional(),
        hasCandleData: zod_1.z.boolean().optional().default(true),
        limit: zod_1.z.number().int().min(1).max(100).optional().default(50),
    }).optional(),
    stopLossConfig: config_1.StopLossConfigSchema.optional(),
    entryConfig: config_1.EntryConfigSchema.optional(),
    reEntryConfig: config_1.ReEntryConfigSchema.optional(),
    costConfig: config_1.CostConfigSchema.optional(),
    entryType: zod_1.z.enum(['alert', 'time', 'manual']).default('alert'),
    maxConcurrency: zod_1.z.number().int().min(1).max(10).optional().default(4),
});
/**
 * POST /api/backtest/batch - Run backtest on multiple tokens
 */
async function POST(request) {
    try {
        const body = await request.json();
        const validated = BatchBacktestRequestSchema.parse(body);
        // Import backtest runner
        const { runSingleBacktest } = await Promise.resolve().then(() => __importStar(require('../backtest-runner')));
        // Get filtered tokens
        const filters = validated.filterCriteria || {};
        const tokens = await token_filter_service_1.tokenFilterService.filterTokens({
            chain: filters.chain,
            dateRange: filters.dateRange
                ? {
                    start: luxon_1.DateTime.fromISO(filters.dateRange.start),
                    end: luxon_1.DateTime.fromISO(filters.dateRange.end),
                }
                : undefined,
            caller: filters.caller,
            hasCandleData: filters.hasCandleData,
            limit: filters.limit,
        });
        if (tokens.length === 0) {
            return server_1.NextResponse.json({ error: 'No tokens found matching filter criteria' }, { status: 404 });
        }
        // Run backtests in batches
        const concurrency = validated.maxConcurrency || 4;
        const results = [];
        for (let i = 0; i < tokens.length; i += concurrency) {
            const batch = tokens.slice(i, i + concurrency);
            const batchResults = await Promise.allSettled(batch.map(async (token) => {
                try {
                    const result = await runSingleBacktest({
                        userId: validated.userId,
                        mint: token.mint,
                        chain: token.chain,
                        strategyId: validated.strategyId,
                        stopLossConfig: validated.stopLossConfig,
                        entryConfig: validated.entryConfig,
                        reEntryConfig: validated.reEntryConfig,
                        costConfig: validated.costConfig,
                        entryType: validated.entryType,
                    });
                    return {
                        token: { mint: token.mint, chain: token.chain },
                        success: true,
                        runId: result.runId,
                        result: result.result,
                    };
                }
                catch (error) {
                    return {
                        token: { mint: token.mint, chain: token.chain },
                        success: false,
                        error: error.message,
                    };
                }
            }));
            for (const batchResult of batchResults) {
                if (batchResult.status === 'fulfilled') {
                    results.push(batchResult.value);
                }
                else {
                    results.push({
                        token: { mint: 'unknown', chain: 'unknown' },
                        success: false,
                        error: batchResult.reason?.message || 'Unknown error',
                    });
                }
            }
        }
        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        return server_1.NextResponse.json({
            total: results.length,
            successful,
            failed,
            results,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return server_1.NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
        }
        logger_1.logger.error('Error running batch backtest', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to run batch backtest' }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map