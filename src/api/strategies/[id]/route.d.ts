/**
 * Strategy Detail API
 *
 * GET, PUT, DELETE operations for individual strategies.
 */
import { NextRequest } from 'next/server';
/**
 * GET /api/strategies/:id - Get strategy details
 */
export declare function GET(request: NextRequest, { params }: {
    params: {
        id: string;
    };
}): Promise<any>;
/**
 * PUT /api/strategies/:id - Update strategy
 */
export declare function PUT(request: NextRequest, { params }: {
    params: {
        id: string;
    };
}): Promise<any>;
/**
 * DELETE /api/strategies/:id - Delete strategy
 */
export declare function DELETE(request: NextRequest, { params }: {
    params: {
        id: string;
    };
}): Promise<any>;
//# sourceMappingURL=route.d.ts.map