/**
 * Backtest Charts API
 *
 * GET /api/backtest/:runId/charts - Get chart data for visualization
 */
import { NextRequest } from 'next/server';
/**
 * GET /api/backtest/:runId/charts - Get chart data for visualization
 */
export declare function GET(request: NextRequest, { params }: {
    params: {
        runId: string;
    };
}): Promise<any>;
//# sourceMappingURL=route.d.ts.map