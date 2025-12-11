"use strict";
/**
 * Backtest History API
 *
 * GET /api/backtest/:runId/history - Get complete trade history
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const database_1 = require("../../../utils/database");
const logger_1 = require("../../../utils/logger");
/**
 * GET /api/backtest/:runId/history - Get complete trade history
 */
async function GET(request, { params }) {
    try {
        const runId = parseInt(params.runId, 10);
        if (isNaN(runId)) {
            return server_1.NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
        }
        const events = await (0, database_1.getSimulationEvents)(runId);
        // Group events by type for easier analysis
        const groupedEvents = {
            entries: events.filter((e) => e.event_type === 'entry' || e.event_type === 'trailing_entry_triggered'),
            exits: events.filter((e) => e.event_type === 'target_hit' || e.event_type === 'stop_loss' || e.event_type === 'final_exit'),
            stops: events.filter((e) => e.event_type === 'stop_moved'),
            reEntries: events.filter((e) => e.event_type === 're_entry'),
        };
        return server_1.NextResponse.json({
            runId,
            totalEvents: events.length,
            events,
            groupedEvents,
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching backtest history', error);
        return server_1.NextResponse.json({ error: error.message || 'Failed to fetch backtest history' }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map