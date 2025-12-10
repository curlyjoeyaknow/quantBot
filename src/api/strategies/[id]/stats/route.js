"use strict";
/**
 * Strategy Statistics API
 *
 * GET /api/strategies/:id/stats - Get detailed performance statistics for a strategy
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
const server_1 = require("next/server");
const logger_1 = require("../../../utils/logger");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * GET /api/strategies/:id/stats - Get strategy performance statistics
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
        const stats = await getDetailedStrategyStats(id, userIdNum);
        return server_1.NextResponse.json(stats);
    }
    catch (error) {
        logger_1.logger.error('Error fetching strategy stats', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to fetch strategy stats' }, { status: 500 });
    }
}
/**
 * Get detailed strategy statistics
 */
async function getDetailedStrategyStats(strategyId, userId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
            // Get strategy name
            db.get('SELECT name FROM strategies WHERE id = ? AND user_id = ?', [strategyId, userId], (err, strategyRow) => {
                if (err) {
                    db.close();
                    return reject(err);
                }
                if (!strategyRow) {
                    db.close();
                    return reject(new Error('Strategy not found'));
                }
                const strategyName = strategyRow.name;
                // Get detailed stats
                db.get(`SELECT 
              COUNT(*) as total_runs,
              SUM(CASE WHEN final_pnl > 0 THEN 1 ELSE 0 END) as successful_runs,
              SUM(CASE WHEN final_pnl <= 0 THEN 1 ELSE 0 END) as failed_runs,
              AVG(final_pnl) as avg_pnl,
              SUM(final_pnl) as total_pnl,
              MAX(final_pnl) as max_pnl,
              MIN(final_pnl) as min_pnl,
              AVG(total_candles) as avg_candles,
              MAX(created_at) as last_run_at,
              MIN(created_at) as first_run_at,
              SUM(CASE WHEN final_pnl > 0 THEN 1 ELSE 0 END) as positive_pnl,
              SUM(CASE WHEN final_pnl < 0 THEN 1 ELSE 0 END) as negative_pnl,
              SUM(CASE WHEN final_pnl = 0 THEN 1 ELSE 0 END) as zero_pnl
            FROM simulation_runs
            WHERE strategy_name = ?`, [strategyName], (err, row) => {
                    db.close();
                    if (err) {
                        return reject(err);
                    }
                    const totalRuns = row?.total_runs || 0;
                    const successfulRuns = row?.successful_runs || 0;
                    const failedRuns = row?.failed_runs || 0;
                    const averagePnl = row?.avg_pnl || 0;
                    const totalPnl = row?.total_pnl || 0;
                    const winRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;
                    resolve({
                        totalRuns,
                        successfulRuns,
                        failedRuns,
                        averagePnl,
                        totalPnl,
                        winRate,
                        maxPnl: row?.max_pnl || 0,
                        minPnl: row?.min_pnl || 0,
                        averageCandles: row?.avg_candles || 0,
                        lastRunAt: row?.last_run_at || undefined,
                        firstRunAt: row?.first_run_at || undefined,
                        pnlDistribution: {
                            positive: row?.positive_pnl || 0,
                            negative: row?.negative_pnl || 0,
                            zero: row?.zero_pnl || 0,
                        },
                    });
                });
            });
        });
    });
}
//# sourceMappingURL=route.js.map