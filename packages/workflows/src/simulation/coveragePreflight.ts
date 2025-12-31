/**
 * Coverage Preflight Service
 *
 * Validates candle availability before simulation.
 * Uses existing getCoverage() function from @quantbot/ohlcv.
 */

import { DateTime } from 'luxon';
import { getCoverage } from '@quantbot/ohlcv';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { RunPlan, TokenRequirement } from './planRun.js';
import type { WorkflowContext } from '../types.js';
import { getArtifactsDir, CoverageReportV1Schema, type CoverageReportV1 } from '@quantbot/core';

export type ExclusionReason = 'too_new' | 'insufficient' | 'missing_interval' | 'no_data';

export interface ExcludedToken {
  token: string;
  reason: ExclusionReason;
  details?: string;
}

export interface CoverageResult {
  eligibleTokens: string[];
  excludedTokens: ExcludedToken[];
  coverageSummary: {
    total: number;
    eligible: number;
    excluded: number;
    byReason: Record<ExclusionReason, number>;
  };
}

const MIN_COVERAGE_RATIO = 0.8; // 80% coverage required
const CHAIN = 'solana' as const;

/**
 * Coverage preflight check
 * 
 * Validates candle availability for all tokens in the run plan.
 * 
 * @param plan - Run plan with token requirements
 * @param ctx - Workflow context (for logging)
 * @param runId - Optional run ID for writing coverage artifact
 * @returns Coverage result with eligible and excluded tokens
 */
export async function coveragePreflight(
  plan: RunPlan,
  ctx: WorkflowContext,
  runId?: string
): Promise<CoverageResult> {
  const eligibleTokens: string[] = [];
  const excludedTokens: ExcludedToken[] = [];
  const byReason: Record<ExclusionReason, number> = {
    too_new: 0,
    insufficient: 0,
    missing_interval: 0,
    no_data: 0,
  };

  // Check coverage for each token requirement
  for (const req of plan.tokenRequirements) {
    try {
      const startTime = req.requiredFromTs.toJSDate();
      const endTime = req.requiredToTs.toJSDate();

      const coverage = await getCoverage(req.token, CHAIN, startTime, endTime, plan.interval);

      // Check eligibility criteria
      if (!coverage.hasData || coverage.candleCount === 0) {
        excludedTokens.push({
          token: req.token,
          reason: 'no_data',
          details: 'No candles found in ClickHouse',
        });
        byReason.no_data++;
        continue;
      }

      // Check if we have enough candles
      if (coverage.candleCount < req.requiredCandleCount) {
        excludedTokens.push({
          token: req.token,
          reason: 'insufficient',
          details: `Required ${req.requiredCandleCount} candles, got ${coverage.candleCount}`,
        });
        byReason.insufficient++;
        continue;
      }

      // Check coverage ratio (must be >= 80%)
      if (coverage.coverageRatio < MIN_COVERAGE_RATIO) {
        excludedTokens.push({
          token: req.token,
          reason: 'insufficient',
          details: `Coverage ratio ${(coverage.coverageRatio * 100).toFixed(1)}% below ${MIN_COVERAGE_RATIO * 100}% threshold`,
        });
        byReason.insufficient++;
        continue;
      }

      // Check if interval is available (coverage should have data for the requested interval)
      // This is implicit in getCoverage - if it returns data, the interval exists
      // But we can check gaps to see if there are significant missing periods
      if (coverage.gaps.length > 0) {
        // Check if gaps are significant (more than 10% of time range)
        const totalGapSeconds = coverage.gaps.reduce((sum, gap) => {
          return sum + (gap.end.getTime() - gap.start.getTime()) / 1000;
        }, 0);
        const totalRangeSeconds = (endTime.getTime() - startTime.getTime()) / 1000;
        const gapRatio = totalGapSeconds / totalRangeSeconds;

        if (gapRatio > 0.1) {
          excludedTokens.push({
            token: req.token,
            reason: 'insufficient',
            details: `Significant gaps in coverage: ${(gapRatio * 100).toFixed(1)}% of time range`,
          });
          byReason.insufficient++;
          continue;
        }
      }

      // Token is eligible
      eligibleTokens.push(req.token);
    } catch (error) {
      // If getCoverage throws, mark as excluded
      const errorMessage = error instanceof Error ? error.message : String(error);
      excludedTokens.push({
        token: req.token,
        reason: 'no_data',
        details: `Error checking coverage: ${errorMessage}`,
      });
      byReason.no_data++;

      ctx.logger.warn('Coverage check failed for token', {
        token: req.token,
        error: errorMessage,
      });
    }
  }

  const total = plan.tokenRequirements.length;
  const eligible = eligibleTokens.length;
  const excluded = excludedTokens.length;

  ctx.logger.info('Coverage preflight completed', {
    total,
    eligible,
    excluded,
    byReason,
  });

  // Write coverage artifact if runId is provided
  if (runId) {
    const intervalSeconds = (() => {
      const normalized = plan.interval.toLowerCase();
      if (normalized === '1s') return 1;
      if (normalized === '15s') return 15;
      if (normalized === '1m') return 60;
      if (normalized === '5m') return 300;
      if (normalized === '15m') return 900;
      if (normalized === '1h') return 3600;
      if (normalized === '4h') return 14400;
      if (normalized === '1d') return 86400;
      return 300; // default to 5m
    })();

    const coverageReport: CoverageReportV1 = {
      schema_version: 1,
      run_id: runId,
      interval_seconds: intervalSeconds,
      eligible: eligibleTokens,
      excluded: excludedTokens.map((t) => ({
        token: t.token,
        reason: t.reason === 'insufficient' ? 'insufficient_range' : t.reason === 'too_new' ? 'too_new' : t.reason === 'missing_interval' ? 'missing_interval' : 'no_data',
        details: t.details,
      })),
      stats: {
        requested: total,
        eligible,
        excluded,
        eligible_pct: total > 0 ? eligible / total : 0,
      },
    };

    // Validate report before writing
    const validatedReport = CoverageReportV1Schema.parse(coverageReport);

    // Write report to artifacts directory
    const artifactsDir = getArtifactsDir();
    const runArtifactsDir = join(artifactsDir, runId);
    await mkdir(runArtifactsDir, { recursive: true });
    const reportPath = join(runArtifactsDir, 'coverage.json');
    await writeFile(reportPath, JSON.stringify(validatedReport, null, 2), 'utf8');

    ctx.logger.info('Coverage report written', {
      runId,
      reportPath,
      eligible,
      excluded,
    });
  }

  return {
    eligibleTokens,
    excludedTokens,
    coverageSummary: {
      total,
      eligible,
      excluded,
      byReason,
    },
  };
}
