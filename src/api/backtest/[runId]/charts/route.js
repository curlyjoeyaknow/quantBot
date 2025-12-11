"use strict";
/**
 * Backtest Charts API
 *
 * GET /api/backtest/:runId/charts - Get chart data for visualization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const results_service_1 = require("../../../services/results-service");
const logger_1 = require("../../../utils/logger");
/**
 * GET /api/backtest/:runId/charts - Get chart data for visualization
 */
async function GET(request, { params }) {
    try {
        const runId = parseInt(params.runId, 10);
        if (isNaN(runId)) {
            return server_1.NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
        }
        const chartData = await results_service_1.resultsService.generateChartData(runId);
        return server_1.NextResponse.json({
            runId,
            charts: chartData,
        });
    }
    catch (error) {
        logger_1.logger.error('Error generating chart data', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to generate chart data' }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map