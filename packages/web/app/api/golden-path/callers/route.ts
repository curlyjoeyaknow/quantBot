/**
 * API endpoint to fetch available callers
 * 
 * GET /api/golden-path/callers
 */

import { NextResponse } from 'next/server';
import { CallersRepository, getPostgresPool } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

export async function GET() {
  try {
    // Fetch all callers with call counts
    const result = await getPostgresPool().query(`
      SELECT 
        c.id,
        c.source,
        c.handle,
        c.display_name,
        COUNT(DISTINCT calls.id) as call_count
      FROM callers c
      LEFT JOIN calls ON c.id = calls.caller_id
      GROUP BY c.id, c.source, c.handle, c.display_name
      HAVING COUNT(DISTINCT calls.id) > 0
      ORDER BY call_count DESC, c.handle ASC
    `);

    return NextResponse.json({
      success: true,
      callers: result.rows.map(row => ({
        id: row.id,
        source: row.source,
        handle: row.handle,
        displayName: row.display_name,
        callCount: parseInt(row.call_count) || 0,
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch callers', error as Error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

