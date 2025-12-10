"use strict";
/**
 * Strategy Management API
 *
 * RESTful API for strategy CRUD operations with validation and stats.
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
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const database_1 = require("../../utils/database");
const config_1 = require("../../simulation/config");
const zod_1 = require("zod");
const logger_1 = require("../../utils/logger");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const DB_PATH = path.join(process.cwd(), 'simulations.db');
// Validation schemas
const CreateStrategySchema = zod_1.z.object({
    userId: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(1).max(100),
    description: zod_1.z.string().optional(),
    strategy: zod_1.z.array(config_1.StrategyLegSchema).nonempty(),
    stopLossConfig: config_1.StopLossConfigSchema,
    entryConfig: config_1.EntryConfigSchema.optional(),
    reEntryConfig: config_1.ReEntryConfigSchema.optional(),
    costConfig: config_1.CostConfigSchema.optional(),
    isDefault: zod_1.z.boolean().optional().default(false),
});
const UpdateStrategySchema = CreateStrategySchema.partial().extend({
    userId: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(1).max(100),
});
/**
 * GET /api/strategies - List user's strategies with stats
 */
async function GET(request) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const userId = searchParams.get('userId');
        if (!userId) {
            return server_1.NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
        }
        const userIdNum = parseInt(userId, 10);
        if (isNaN(userIdNum)) {
            return server_1.NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
        }
        const strategies = await (0, database_1.getUserStrategies)(userIdNum);
        // Get stats for each strategy
        const strategiesWithStats = await Promise.all(strategies.map(async (strategy) => {
            const stats = await getStrategyStats(strategy.id);
            return {
                ...strategy,
                stats,
            };
        }));
        return server_1.NextResponse.json({ strategies: strategiesWithStats });
    }
    catch (error) {
        logger_1.logger.error('Error fetching strategies', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to fetch strategies' }, { status: 500 });
    }
}
/**
 * POST /api/strategies - Create new strategy
 */
async function POST(request) {
    try {
        const body = await request.json();
        const validated = CreateStrategySchema.parse(body);
        // Check if strategy with same name already exists
        const existing = await (0, database_1.getStrategy)(validated.userId, validated.name);
        if (existing) {
            return server_1.NextResponse.json({ error: 'Strategy with this name already exists' }, { status: 409 });
        }
        const strategyId = await (0, database_1.saveStrategy)({
            userId: validated.userId,
            name: validated.name,
            description: validated.description,
            strategy: validated.strategy,
            stopLossConfig: validated.stopLossConfig,
            isDefault: validated.isDefault,
        });
        return server_1.NextResponse.json({
            id: strategyId,
            message: 'Strategy created successfully',
        }, { status: 201 });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return server_1.NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
        }
        logger_1.logger.error('Error creating strategy', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to create strategy' }, { status: 500 });
    }
}
/**
 * Get strategy statistics from simulation_runs
 */
async function getStrategyStats(strategyId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
            // Get strategy name first
            db.get('SELECT name FROM strategies WHERE id = ?', [strategyId], (err, strategyRow) => {
                if (err || !strategyRow) {
                    db.close();
                    return resolve({
                        totalRuns: 0,
                        successfulRuns: 0,
                        averagePnl: 0,
                        totalPnl: 0,
                        winRate: 0,
                    });
                }
                const strategyName = strategyRow.name;
                // Get stats from simulation_runs
                db.get(`SELECT 
              COUNT(*) as total_runs,
              SUM(CASE WHEN final_pnl > 0 THEN 1 ELSE 0 END) as successful_runs,
              AVG(final_pnl) as avg_pnl,
              SUM(final_pnl) as total_pnl,
              MAX(created_at) as last_run_at
            FROM simulation_runs
            WHERE strategy_name = ?`, [strategyName], (err, row) => {
                    db.close();
                    if (err) {
                        return reject(err);
                    }
                    const totalRuns = row?.total_runs || 0;
                    const successfulRuns = row?.successful_runs || 0;
                    const averagePnl = row?.avg_pnl || 0;
                    const totalPnl = row?.total_pnl || 0;
                    const winRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;
                    resolve({
                        totalRuns,
                        successfulRuns,
                        averagePnl,
                        totalPnl,
                        winRate,
                        lastRunAt: row?.last_run_at || undefined,
                    });
                });
            });
        });
    });
}
//# sourceMappingURL=route.js.map