/**
 * Research OS - Leaderboard
 * =========================
 *
 * Ranks and compares simulation runs by various metrics.
 * Supports multiple ranking criteria and filtering.
 */

import type { RunArtifact, RunMetrics } from './artifacts.js';
import type { ExperimentContext } from './experiment-runner.js';

/**
 * Ranking criteria
 */
export type RankingCriteria =
  | 'return'
  | 'winRate'
  | 'profitFactor'
  | 'sharpeRatio'
  | 'maxDrawdown'
  | 'totalTrades'
  | 'avgReturnPerTrade';

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  /**
   * Run ID
   */
  runId: string;

  /**
   * Strategy name
   */
  strategyName: string;

  /**
   * Snapshot ID
   */
  snapshotId: string;

  /**
   * Metrics
   */
  metrics: RunMetrics;

  /**
   * Rank (1-based)
   */
  rank: number;

  /**
   * Score used for ranking
   */
  score: number;
}

/**
 * Leaderboard options
 */
export interface LeaderboardOptions {
  /**
   * Ranking criteria
   */
  criteria: RankingCriteria;

  /**
   * Sort order
   */
  order: 'asc' | 'desc';

  /**
   * Maximum number of results
   */
  limit?: number;

  /**
   * Filter by strategy name
   */
  strategyName?: string;

  /**
   * Filter by snapshot ID
   */
  snapshotId?: string;

  /**
   * Minimum return threshold
   */
  minReturn?: number;

  /**
   * Minimum win rate threshold
   */
  minWinRate?: number;
}

/**
 * Calculate score for ranking
 */
function calculateScore(metrics: RunMetrics, criteria: RankingCriteria): number {
  switch (criteria) {
    case 'return':
      return metrics.return.total;

    case 'winRate':
      return metrics.hitRate.overall;

    case 'profitFactor':
      // Profit factor = gross profit / gross loss
      // Approximate from return and win rate
      if (metrics.return.total <= 0) return 0;
      // Calculate from hit rate and return
      // Simplified calculation: if win rate > 0.5, assume positive profit factor
      const winRate = metrics.hitRate.overall;
      if (winRate <= 0) return 0;
      // Estimate profit factor from return and win rate
      // This is a simplified approximation - real profit factor needs entry/exit pairs
      const totalTrades = metrics.trades.total;
      if (totalTrades === 0) return 0;
      const winners = Math.round(totalTrades * winRate);
      const losers = totalTrades - winners;
      if (losers === 0) return winners > 0 ? Infinity : 0;
      // Simplified: assume average win/loss ratio from return
      const avgWin = metrics.return.total / Math.max(winners, 1);
      const avgLoss = Math.abs(metrics.return.total - avgWin * winners) / Math.max(losers, 1);
      return avgLoss > 0 ? (avgWin * winners) / (avgLoss * losers) : 0;

    case 'sharpeRatio':
      // Simplified Sharpe ratio calculation
      // In a real implementation, we'd need return series and risk-free rate
      if (metrics.return.total <= 0) return 0;
      const volatility = metrics.drawdown.max; // Use max drawdown as proxy for volatility
      return volatility > 0 ? metrics.return.total / volatility : 0;

    case 'maxDrawdown':
      // Lower is better, so we negate for consistent sorting
      return -metrics.drawdown.max;

    case 'totalTrades':
      return metrics.trades.total;

    case 'avgReturnPerTrade':
      return metrics.return.perTrade ?? 0;

    default:
      return 0;
  }
}

/**
 * Filter artifacts based on options
 */
function filterArtifacts(artifacts: RunArtifact[], options: LeaderboardOptions): RunArtifact[] {
  return artifacts.filter((artifact) => {
    // Filter by strategy name
    if (options.strategyName) {
      if (artifact.request.strategy.name !== options.strategyName) {
        return false;
      }
    }

    // Filter by snapshot ID
    if (options.snapshotId) {
      if (artifact.request.dataSnapshot.snapshotId !== options.snapshotId) {
        return false;
      }
    }

    // Filter by minimum return
    if (options.minReturn !== undefined) {
      if (artifact.metrics.return.total < options.minReturn) {
        return false;
      }
    }

    // Filter by minimum win rate
    if (options.minWinRate !== undefined) {
      if (artifact.metrics.hitRate.overall < options.minWinRate) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Get leaderboard
 */
export async function getLeaderboard(
  ctx: ExperimentContext,
  options: LeaderboardOptions
): Promise<LeaderboardEntry[]> {
  // Load all run IDs
  const runIds = await ctx.artifacts.list();

  // Load all artifacts
  const artifacts: RunArtifact[] = [];
  for (const runId of runIds) {
    const artifact = await ctx.artifacts.load(runId);
    if (artifact) {
      artifacts.push(artifact);
    }
  }

  // Filter artifacts
  const filtered = filterArtifacts(artifacts, options);

  // Calculate scores and sort
  const entries: LeaderboardEntry[] = filtered.map((artifact) => ({
    runId: artifact.metadata.runId,
    strategyName: artifact.request.strategy.name,
    snapshotId: artifact.request.dataSnapshot.snapshotId,
    metrics: artifact.metrics,
    rank: 0, // Will be set after sorting
    score: calculateScore(artifact.metrics, options.criteria),
  }));

  // Sort by score
  entries.sort((a, b) => {
    if (options.order === 'desc') {
      return b.score - a.score;
    }
    return a.score - b.score;
  });

  // Assign ranks
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  // Apply limit
  if (options.limit !== undefined) {
    return entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Get top N runs by criteria
 */
export async function getTopRuns(
  ctx: ExperimentContext,
  criteria: RankingCriteria,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  return getLeaderboard(ctx, {
    criteria,
    order: 'desc',
    limit,
  });
}

/**
 * Compare two runs
 */
export function compareRuns(
  artifact1: RunArtifact,
  artifact2: RunArtifact,
  criteria: RankingCriteria
): {
  winner: RunArtifact;
  loser: RunArtifact;
  scoreDiff: number;
} {
  const score1 = calculateScore(artifact1.metrics, criteria);
  const score2 = calculateScore(artifact2.metrics, criteria);

  if (score1 >= score2) {
    return {
      winner: artifact1,
      loser: artifact2,
      scoreDiff: score1 - score2,
    };
  }

  return {
    winner: artifact2,
    loser: artifact1,
    scoreDiff: score2 - score1,
  };
}
