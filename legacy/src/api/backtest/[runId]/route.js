"use strict";
/**
 * Backtest Result API
 *
 * GET /api/backtest/:runId - Get backtest results
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const database_1 = require("../../../utils/database");
const logger_1 = require("../../../utils/logger");
/**
 * GET /api/backtest/:runId - Get backtest results
 */
async function GET(request, { params }) {
    try {
        const runId = parseInt(params.runId, 10);
        if (isNaN(runId)) {
            return server_1.NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
        }
        const run = await (0, database_1.getSimulationRun)(runId);
        if (!run) {
            return server_1.NextResponse.json({ error: 'Backtest run not found' }, { status: 404 });
        }
        const events = await (0, database_1.getSimulationEvents)(runId);
        return server_1.NextResponse.json({
            run: {
                id: run.id,
                userId: run.userId,
                mint: run.mint,
                chain: run.chain,
                tokenName: run.tokenName,
                tokenSymbol: run.tokenSymbol,
                startTime: run.startTime,
                endTime: run.endTime,
                strategy: run.strategy,
                stopLossConfig: run.stopLossConfig,
                strategyName: run.strategyName,
                finalPnl: run.finalPnl,
                totalCandles: run.totalCandles,
                entryType: run.entryType,
                entryPrice: run.entryPrice,
                entryTimestamp: run.entryTimestamp,
                filterCriteria: run.filterCriteria,
                createdAt: run.createdAt,
            },
            events,
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching backtest result', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to fetch backtest result' }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map