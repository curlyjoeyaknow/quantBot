/**
 * Strategy Statistics API
 *
 * GET /api/strategies/:id/stats - Get detailed performance statistics for a strategy
 */
import { NextRequest } from 'next/server';
/**
 * GET /api/strategies/:id/stats - Get strategy performance statistics
 */
export declare function GET(request: NextRequest, { params }: {
    params: {
        id: string;
    };
}): Promise<any>;
//# sourceMappingURL=route.d.ts.map