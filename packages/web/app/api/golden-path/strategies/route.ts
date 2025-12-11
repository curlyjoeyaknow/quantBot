/**
 * API endpoint to fetch available strategies
 * 
 * GET /api/golden-path/strategies
 */

import { NextResponse } from 'next/server';
import { StrategiesRepository } from '@quantbot/data';
import { logger } from '@quantbot/utils';

export async function GET() {
  try {
    const strategiesRepo = new StrategiesRepository();
    
    // Fetch all strategies and filter for active
    const allStrategies = await strategiesRepo.list();
    const activeStrategies = allStrategies.filter(s => s.isActive);
    
    return NextResponse.json({
      success: true,
      strategies: activeStrategies.map(s => ({
        id: s.id,
        name: s.name,
        version: s.version,
        category: s.category,
        description: s.description,
        isActive: s.isActive,
        displayName: `${s.name}${s.version ? `@${s.version}` : ''}${s.category ? ` (${s.category})` : ''}`,
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch strategies', error as Error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

