/**
 * API endpoint to fetch tokens with filters
 * 
 * GET /api/golden-path/tokens?search=...&caller=...&from=...&to=...&minMcap=...&maxMcap=...
 */

import { NextRequest, NextResponse } from 'next/server';
import { TokensRepository, CallsRepository, getPostgresPool } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const caller = searchParams.get('caller') || '';
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const minMcap = searchParams.get('minMcap') || '';
    const maxMcap = searchParams.get('maxMcap') || '';
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query with filters
    let query = `
      SELECT DISTINCT
        t.id,
        t.address,
        t.symbol,
        t.name,
        t.chain,
        t.metadata_json,
        COUNT(DISTINCT c.id) as call_count,
        MIN(c.signal_timestamp) as first_call_date,
        MAX(c.signal_timestamp) as last_call_date,
        MAX(CAST(t.metadata_json->>'mcap' AS NUMERIC)) as mcap
      FROM tokens t
      LEFT JOIN calls c ON t.id = c.token_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Search filter (token address, symbol, or name)
    if (search) {
      query += ` AND (
        t.address ILIKE $${paramIndex} OR
        t.symbol ILIKE $${paramIndex} OR
        t.name ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Caller filter
    if (caller) {
      query += ` AND c.caller_id IN (
        SELECT id FROM callers WHERE handle ILIKE $${paramIndex}
      )`;
      params.push(`%${caller}%`);
      paramIndex++;
    }

    // Date range filter
    if (from) {
      query += ` AND c.signal_timestamp >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }
    if (to) {
      query += ` AND c.signal_timestamp <= $${paramIndex}`;
      params.push(to);
      paramIndex++;
    }

    query += ` GROUP BY t.id, t.address, t.symbol, t.name, t.chain, t.metadata_json`;

    // MCAP filter (after grouping)
    if (minMcap || maxMcap) {
      query += ` HAVING 1=1`;
      if (minMcap) {
        query += ` AND MAX(CAST(t.metadata_json->>'mcap' AS NUMERIC)) >= $${paramIndex}`;
        params.push(parseFloat(minMcap));
        paramIndex++;
      }
      if (maxMcap) {
        query += ` AND MAX(CAST(t.metadata_json->>'mcap' AS NUMERIC)) <= $${paramIndex}`;
        params.push(parseFloat(maxMcap));
        paramIndex++;
      }
    }

    query += ` ORDER BY last_call_date DESC NULLS LAST, call_count DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await getPostgresPool().query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT t.id)
      FROM tokens t
      LEFT JOIN calls c ON t.id = c.token_id
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (search) {
      countQuery += ` AND (t.address ILIKE $${countParamIndex} OR t.symbol ILIKE $${countParamIndex} OR t.name ILIKE $${countParamIndex})`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }
    if (caller) {
      countQuery += ` AND c.caller_id IN (SELECT id FROM callers WHERE handle ILIKE $${countParamIndex})`;
      countParams.push(`%${caller}%`);
      countParamIndex++;
    }
    if (from) {
      countQuery += ` AND c.signal_timestamp >= $${countParamIndex}`;
      countParams.push(from);
      countParamIndex++;
    }
    if (to) {
      countQuery += ` AND c.signal_timestamp <= $${countParamIndex}`;
      countParams.push(to);
      countParamIndex++;
    }

    const countResult = await getPostgresPool().query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return NextResponse.json({
      success: true,
      tokens: result.rows.map(row => ({
        id: row.id,
        address: row.address,
        symbol: row.symbol,
        name: row.name,
        chain: row.chain,
        callCount: parseInt(row.call_count) || 0,
        firstCallDate: row.first_call_date,
        lastCallDate: row.last_call_date,
        mcap: row.mcap ? parseFloat(row.mcap) : null,
        metadata: row.metadata_json,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch tokens', error as Error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

