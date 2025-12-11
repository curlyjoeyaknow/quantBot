/**
 * Backtest History API
 *
 * GET /api/backtest/:runId/history - Get complete trade history
 */
import { NextRequest } from 'next/server';
/**
 * GET /api/backtest/:runId/history - Get complete trade history
 */
export declare function GET(request: NextRequest, { params }: {
    params: {
        runId: string;
    };
}): Promise<any>;
//# sourceMappingURL=route.d.ts.map