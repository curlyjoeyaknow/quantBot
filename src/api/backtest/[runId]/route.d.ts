/**
 * Backtest Result API
 *
 * GET /api/backtest/:runId - Get backtest results
 */
import { NextRequest } from 'next/server';
/**
 * GET /api/backtest/:runId - Get backtest results
 */
export declare function GET(request: NextRequest, { params }: {
    params: {
        runId: string;
    };
}): Promise<any>;
//# sourceMappingURL=route.d.ts.map