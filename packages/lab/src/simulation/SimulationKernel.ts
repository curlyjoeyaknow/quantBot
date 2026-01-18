/**
 * SimulationKernel
 *
 * Deterministic, research-grade simulation kernel.
 *
 * Kernel loop:
 *   for ts in time:
 *     evaluate entry graph
 *     apply risk rules
 *     manage open positions
 *     record events
 *
 * Determinism:
 *   - Seeded randomness only (if any)
 *   - No wall clock
 *   - Same inputs → identical outputs
 */

import type { StrategyGraph } from '../strategy/types.js';
import { ConditionEvaluator } from '../strategy/ConditionEvaluator.js';
import type { RiskConfig, Position, MarketData } from '../risk/types.js';
import { RiskEngine } from '../risk/RiskEngine.js';
import type {
  SimulationEvent,
  FillEvent,
  PositionSnapshot,
  SimulationState,
  SimulationConfig,
} from './types.js';
import { logger } from '@quantbot/infra/utils';
import type { FeatureRow } from '../strategy/ConditionEvaluator.js';

/**
 * SimulationKernel
 */
export class SimulationKernel {
  private readonly evaluator: ConditionEvaluator;
  private readonly riskEngine: RiskEngine;
  private readonly config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.evaluator = new ConditionEvaluator();
    this.riskEngine = new RiskEngine();
    this.config = config;
  }

  /**
   * Run simulation
   *
   * DETERMINISM GUARANTEES:
   * - No wall clock (uses ts from features)
   * - No Math.random() (uses seeded RNG if randomness needed)
   * - Same inputs → identical outputs
   * - Processing order is deterministic (sorted by token_id, then ts)
   */
  async simulate(args: {
    features: FeatureRow[]; // Sorted by token_id, ts
    strategyGraph: StrategyGraph;
    riskConfig: RiskConfig;
    seed?: number; // For deterministic randomness (if needed in future)
  }): Promise<{
    state: SimulationState;
    events: SimulationEvent[];
    fills: FillEvent[];
    positions: PositionSnapshot[];
  }> {
    const { features, strategyGraph, riskConfig, seed } = args;

    // Initialize state
    const state: SimulationState = {
      capital: this.config.initialCapital,
      positions: new Map(),
      totalPnl: 0,
      events: [],
      fills: [],
    };

    // Track previous row for cross detection
    const previousRows = new Map<string, FeatureRow>();

    // Process features in time order (grouped by token)
    const featuresByToken = this.groupFeaturesByToken(features);

    for (const [tokenId, tokenFeatures] of featuresByToken.entries()) {
      const prevRow = previousRows.get(tokenId);

      for (let i = 0; i < tokenFeatures.length; i++) {
        const currentRow = tokenFeatures[i]!;
        const prev = i > 0 ? tokenFeatures[i - 1] : prevRow;

        // Build evaluation context
        const context = {
          currentRow,
          previousRow: prev
            ? Object.fromEntries(
                Object.entries(prev).filter(([k]) => k !== 'tokenId' && k !== 'ts')
              )
            : undefined,
        };

        // Evaluate entry conditions
        const shouldEnter = this.evaluator.evaluateEntries(strategyGraph.entryNodes, context);

        // Evaluate exit conditions
        const shouldExit = this.evaluator.evaluateExits(strategyGraph.exitNodes, context);

        // Get market data
        const marketData: MarketData = {
          currentPrice: currentRow.close as number,
          high: currentRow.high as number,
          low: currentRow.low as number,
          atr: currentRow.atr_14 as number | undefined,
          ts: currentRow.ts,
        };

        // Check existing position
        const existingPosition = state.positions.get(tokenId);

        if (existingPosition) {
          // Evaluate exit
          const position: Position = {
            tokenId,
            entryTs: existingPosition.entryTs,
            entryPrice: existingPosition.entryPrice,
            size: existingPosition.size,
            stopLossPrice: existingPosition.stopLossPrice,
            takeProfitPrice: existingPosition.takeProfitPrice,
            trailingStopPrice: existingPosition.trailingStopPrice,
            maxHoldTs: riskConfig.maxHoldMinutes
              ? existingPosition.entryTs + riskConfig.maxHoldMinutes * 60
              : undefined,
          };

          const riskEval = this.riskEngine.evaluateExit(riskConfig, position, marketData);

          if (riskEval.shouldExit || shouldExit) {
            // Exit position
            await this.exitPosition(
              state,
              existingPosition,
              marketData,
              riskEval.exitReason || 'strategy_exit',
              riskConfig
            );
            state.positions.delete(tokenId);
          } else {
            // Update position
            this.updatePosition(state, existingPosition, marketData, riskEval);
          }
        } else if (shouldEnter) {
          // Evaluate entry risk
          const entryRisk = this.riskEngine.evaluateEntry(riskConfig, marketData);

          if (entryRisk.shouldEnter && state.capital >= entryRisk.positionSize) {
            // Enter position
            await this.enterPosition(
              state,
              tokenId,
              marketData,
              entryRisk.positionSize,
              riskConfig
            );
          }
        }

        // Update previous row
        previousRows.set(tokenId, currentRow);
      }
    }

    // Close all remaining positions at final price
    for (const [tokenId, position] of state.positions.entries()) {
      const finalRow = featuresByToken.get(tokenId)?.[featuresByToken.get(tokenId)!.length - 1];
      if (finalRow) {
        const finalMarketData: MarketData = {
          currentPrice: finalRow.close as number,
          high: finalRow.high as number,
          low: finalRow.low as number,
          atr: finalRow.atr_14 as number | undefined,
          ts: finalRow.ts,
        };
        await this.exitPosition(state, position, finalMarketData, 'final_exit', riskConfig);
      }
    }

    // Build position snapshots
    const positions: PositionSnapshot[] = Array.from(state.positions.values());

    return {
      state,
      events: state.events,
      fills: state.fills,
      positions,
    };
  }

  /**
   * Group features by token
   */
  private groupFeaturesByToken(features: FeatureRow[]): Map<string, FeatureRow[]> {
    const grouped = new Map<string, FeatureRow[]>();
    for (const row of features) {
      const tokenId = row.tokenId;
      if (!grouped.has(tokenId)) {
        grouped.set(tokenId, []);
      }
      grouped.get(tokenId)!.push(row);
    }
    // Sort each token's features by ts
    for (const [tokenId, rows] of grouped.entries()) {
      rows.sort((a, b) => a.ts - b.ts);
    }
    return grouped;
  }

  /**
   * Enter position
   */
  private async enterPosition(
    state: SimulationState,
    tokenId: string,
    marketData: MarketData,
    positionSize: number,
    riskConfig: RiskConfig
  ): Promise<void> {
    const entryPrice = marketData.currentPrice;
    const slippage = (entryPrice * this.config.costConfig.entrySlippageBps) / 10000;
    const fillPrice = entryPrice + slippage;
    const fees = (positionSize * this.config.costConfig.takerFeeBps) / 10000;
    const totalCost = positionSize + fees;

    if (state.capital < totalCost) {
      logger.warn('Insufficient capital for entry', { tokenId, capital: state.capital, totalCost });
      return;
    }

    // Create fill
    const fill: FillEvent = {
      tokenId,
      ts: marketData.ts,
      side: 'buy',
      price: fillPrice,
      size: positionSize / fillPrice, // Token amount
      quoteAmount: positionSize,
      fees,
    };
    state.fills.push(fill);

    // Update capital
    state.capital -= totalCost;

    // Initialize position
    const position = this.riskEngine.initializePosition(
      riskConfig,
      tokenId,
      marketData.ts,
      fillPrice,
      positionSize,
      marketData
    );

    // Create position snapshot
    const snapshot: PositionSnapshot = {
      tokenId,
      ts: marketData.ts,
      entryTs: marketData.ts,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      size: positionSize,
      unrealizedPnl: 0,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      trailingStopPrice: position.trailingStopPrice,
    };
    state.positions.set(tokenId, snapshot);

    // Record event
    state.events.push({
      type: 'entry',
      tokenId,
      ts: marketData.ts,
      price: fillPrice,
      size: positionSize,
    });
  }

  /**
   * Exit position
   */
  private async exitPosition(
    state: SimulationState,
    position: PositionSnapshot,
    marketData: MarketData,
    reason: string,
    riskConfig: RiskConfig
  ): Promise<void> {
    const exitPrice = marketData.currentPrice;
    const slippage = (exitPrice * this.config.costConfig.exitSlippageBps) / 10000;
    const fillPrice = exitPrice - slippage;
    const quoteAmount = position.size;
    const fees = (quoteAmount * this.config.costConfig.takerFeeBps) / 10000;
    const proceeds = quoteAmount - fees;

    // Calculate PnL
    const pnl = proceeds - position.size;
    const pnlPercent = (pnl / position.size) * 100;

    // Create fill
    const fill: FillEvent = {
      tokenId: position.tokenId,
      ts: marketData.ts,
      side: 'sell',
      price: fillPrice,
      size: position.size / fillPrice,
      quoteAmount: proceeds,
      fees,
    };
    state.fills.push(fill);

    // Update capital
    state.capital += proceeds;
    state.totalPnl += pnl;

    // Determine event type
    let eventType: SimulationEvent['type'] = 'exit';
    if (reason === 'stop_loss') eventType = 'stop_loss';
    else if (reason === 'take_profit') eventType = 'take_profit';
    else if (reason === 'max_hold') eventType = 'max_hold';
    else if (reason === 'trailing_stop') eventType = 'trailing_stop';
    else if (reason === 'final_exit') eventType = 'final_exit';

    // Record event
    state.events.push({
      type: eventType,
      tokenId: position.tokenId,
      ts: marketData.ts,
      price: fillPrice,
      size: position.size,
      pnl,
      pnlSoFar: state.totalPnl,
      reason,
    });
  }

  /**
   * Update position (update unrealized PnL, trailing stops)
   */
  private updatePosition(
    state: SimulationState,
    position: PositionSnapshot,
    marketData: MarketData,
    riskEval: { newStopLossPrice?: number }
  ): void {
    // Update current price
    position.currentPrice = marketData.currentPrice;

    // Update unrealized PnL
    const priceChange = (marketData.currentPrice - position.entryPrice) / position.entryPrice;
    position.unrealizedPnl = position.size * priceChange;

    // Update trailing stop if provided
    if (riskEval.newStopLossPrice) {
      position.trailingStopPrice = riskEval.newStopLossPrice;
      position.stopLossPrice = riskEval.newStopLossPrice;
    }
  }
}
