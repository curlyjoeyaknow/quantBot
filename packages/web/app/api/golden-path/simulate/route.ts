/**
 * API endpoint for running simulations
 * 
 * POST /api/golden-path/simulate
 * 
 * Body:
 * {
 *   strategyName: string,
 *   callerName?: string,
 *   callerIds?: number[],
 *   tokenAddresses?: string[],
 *   from?: string (ISO date),
 *   to?: string (ISO date),
 *   side?: 'buy' | 'sell',
 *   signalTypes?: string[]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { SimulationService } from '@quantbot/services/simulation/SimulationService';
import { logger } from '@quantbot/utils';
import type { CallSelection } from '@quantbot/utils/types/core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      strategyName,
      callerName,
      callerIds,
      tokenAddresses,
      from,
      to,
      side,
      signalTypes,
    } = body;

    if (!strategyName) {
      return NextResponse.json(
        { error: 'strategyName is required' },
        { status: 400 }
      );
    }

    logger.info('Starting simulation via API', { strategyName, callerName, from, to });

    // Build selection criteria
    const selection: CallSelection = {};
    if (callerName) {
      selection.callerNames = [callerName];
    }
    if (callerIds && callerIds.length > 0) {
      selection.callerIds = callerIds;
    }
    if (tokenAddresses && tokenAddresses.length > 0) {
      selection.tokenAddresses = tokenAddresses;
    }
    if (from) {
      selection.from = new Date(from);
    }
    if (to) {
      selection.to = new Date(to);
    }
    if (side) {
      selection.side = side;
    }
    if (signalTypes && signalTypes.length > 0) {
      selection.signalTypes = signalTypes;
    }

    // Initialize service
    const simulationService = new SimulationService();

    // Run simulation
    const result = await simulationService.runOnCalls({
      strategyName,
      selection,
    });

    return NextResponse.json({
      success: true,
      result: {
        runId: result.runId,
        finalPnl: result.finalPnl,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        tradeCount: result.tradeCount,
        tokenCount: result.tokenCount,
      },
    });
  } catch (error) {
    logger.error('Simulation API error', error as Error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

