"use strict";
/**
 * Strategy Detail API
 *
 * GET, PUT, DELETE operations for individual strategies.
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
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const database_1 = require("../../../utils/database");
const config_1 = require("../../../simulation/config");
const zod_1 = require("zod");
const logger_1 = require("../../../utils/logger");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const DB_PATH = path.join(process.cwd(), 'simulations.db');
const UpdateStrategySchema = zod_1.z.object({
    userId: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(1).max(100).optional(),
    description: zod_1.z.string().optional(),
    strategy: zod_1.z.array(config_1.StrategyLegSchema).nonempty().optional(),
    stopLossConfig: config_1.StopLossConfigSchema.optional(),
    entryConfig: config_1.EntryConfigSchema.optional(),
    reEntryConfig: config_1.ReEntryConfigSchema.optional(),
    costConfig: config_1.CostConfigSchema.optional(),
    isDefault: zod_1.z.boolean().optional(),
});
/**
 * GET /api/strategies/:id - Get strategy details
 */
async function GET(request, { params }) {
    try {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
            return server_1.NextResponse.json({ error: 'Invalid strategy ID' }, { status: 400 });
        }
        // Get userId from query params
        const searchParams = request.nextUrl.searchParams;
        const userId = searchParams.get('userId');
        if (!userId) {
            return server_1.NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
        }
        const userIdNum = parseInt(userId, 10);
        if (isNaN(userIdNum)) {
            return server_1.NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
        }
        // Get strategy from database by ID
        const strategy = await getStrategyById(id, userIdNum);
        if (!strategy) {
            return server_1.NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
        }
        // Get stats
        const stats = await getStrategyStats(id);
        return server_1.NextResponse.json({
            ...strategy,
            stats,
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching strategy', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to fetch strategy' }, { status: 500 });
    }
}
/**
 * PUT /api/strategies/:id - Update strategy
 */
async function PUT(request, { params }) {
    try {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
            return server_1.NextResponse.json({ error: 'Invalid strategy ID' }, { status: 400 });
        }
        const body = await request.json();
        const validated = UpdateStrategySchema.parse(body);
        // Get existing strategy
        const existing = await getStrategyById(id, validated.userId);
        if (!existing) {
            return server_1.NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
        }
        // Merge with existing data
        const updated = {
            userId: validated.userId,
            name: validated.name || existing.name,
            description: validated.description !== undefined ? validated.description : existing.description,
            strategy: validated.strategy || existing.strategy,
            stopLossConfig: validated.stopLossConfig || existing.stopLossConfig,
            isDefault: validated.isDefault !== undefined ? validated.isDefault : existing.isDefault,
        };
        // Update strategy
        await (0, database_1.saveStrategy)(updated);
        return server_1.NextResponse.json({
            message: 'Strategy updated successfully',
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return server_1.NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
        }
        logger_1.logger.error('Error updating strategy', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to update strategy' }, { status: 500 });
    }
}
/**
 * DELETE /api/strategies/:id - Delete strategy
 */
async function DELETE(request, { params }) {
    try {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
            return server_1.NextResponse.json({ error: 'Invalid strategy ID' }, { status: 400 });
        }
        // Get userId from query params
        const searchParams = request.nextUrl.searchParams;
        const userId = searchParams.get('userId');
        if (!userId) {
            return server_1.NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
        }
        const userIdNum = parseInt(userId, 10);
        if (isNaN(userIdNum)) {
            return server_1.NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
        }
        // Get strategy name first
        const strategy = await getStrategyById(id, userIdNum);
        if (!strategy) {
            return server_1.NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
        }
        await (0, database_1.deleteStrategy)(userIdNum, strategy.name);
        return server_1.NextResponse.json({
            message: 'Strategy deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Error deleting strategy', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to delete strategy' }, { status: 500 });
    }
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
/**
 * Get strategy statistics
 */
async function getStrategyStats(strategyId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
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