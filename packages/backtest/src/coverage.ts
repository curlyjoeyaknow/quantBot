/**
 * Coverage Gate - Verify that all required candles exist for CALLS
 *
 * ClickHouse read-only. No writes, no side effects beyond logging.
 */

import type { DateTime } from 'luxon';
import type { BacktestPlan, CoverageResult, TokenAddress, Chain } from './types.js';
import { OhlcvRepository } from '@quantbot/infra/storage';
import { logger } from '@quantbot/infra/utils';
import { checkCandleIntegrity, type IntegrityCheckConfig } from './integrity/candle-integrity.js';

/**
 * Check coverage for a single call
 */
async function checkCallCoverage(
  callId: string,
  token: TokenAddress,
  chain: Chain,
  from: DateTime,
  to: DateTime,
  interval: string,
  minCandles: number,
  ohlcvRepo: OhlcvRepository
): Promise<{ eligible: boolean; reason?: 'too_new' | 'missing_range' | 'missing_interval' }> {
  try {
    // Check if candles exist in range
    const candles = await ohlcvRepo.getCandles(token, chain, interval, {
      from,
      to,
    } as { from: DateTime; to: DateTime });

    if (candles.length === 0) {
      return { eligible: false, reason: 'missing_range' };
    }

    if (candles.length < minCandles) {
      return { eligible: false, reason: 'missing_range' };
    }

    // Check if call is too new (all candles are after call timestamp)
    const firstCandle = candles[0];
    if (firstCandle && firstCandle.timestamp > from.toUnixInteger()) {
      return { eligible: false, reason: 'too_new' };
    }

    return { eligible: true };
  } catch (error) {
    logger.warn('Error checking coverage for call', {
      callId,
      token,
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
    return { eligible: false, reason: 'missing_range' };
  }
}

/**
 * Check coverage - verify all required candles exist for calls
 *
 * ClickHouse read-only. Returns eligible/excluded calls.
 *
 * @param plan - Backtest plan with call windows
 * @param integrityConfig - Optional integrity check configuration
 */
export async function checkCoverage(
  plan: BacktestPlan,
  integrityConfig?: IntegrityCheckConfig
): Promise<CoverageResult> {
  const ohlcvRepo = new OhlcvRepository();
  const eligible: CoverageResult['eligible'] = [];
  const excluded: CoverageResult['excluded'] = [];
  const issuesByCallId = new Map<
    string,
    Array<{ type: string; severity: string; description: string }>
  >();

  // Determine interval string from plan
  const intervalMap: Record<number, string> = {
    1: '1s',
    15: '15s',
    60: '1m',
    300: '5m',
    900: '15m',
    3600: '1h',
    14400: '4h',
    86400: '1d',
  };
  const interval = intervalMap[plan.intervalSeconds] || '1m';

  // Determine interval in milliseconds for integrity checks
  const intervalMs = plan.intervalSeconds * 1000;

  for (const window of plan.perCallWindow) {
    const result = await checkCallCoverage(
      window.callId,
      window.tokenAddress,
      window.chain,
      window.from,
      window.to,
      interval,
      plan.totalRequiredCandles,
      ohlcvRepo
    );

    if (result.eligible) {
      // If integrity checks enabled, check candle integrity
      if (integrityConfig) {
        try {
          const candles = await ohlcvRepo.getCandles(window.tokenAddress, window.chain, interval, {
            from: window.from,
            to: window.to,
          } as { from: DateTime; to: DateTime });

          const integrityResult = checkCandleIntegrity(candles, {
            ...integrityConfig,
            expectedIntervalMs: intervalMs,
          });

          if (integrityResult.issues.length > 0) {
            issuesByCallId.set(
              window.callId,
              integrityResult.issues.map((issue) => ({
                type: issue.type,
                severity: issue.severity,
                description: issue.description,
              }))
            );
          }
        } catch (error) {
          logger.warn('Failed to check integrity for call', {
            callId: window.callId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      eligible.push({
        callId: window.callId,
        tokenAddress: window.tokenAddress,
        chain: window.chain,
      });
    } else {
      excluded.push({
        callId: window.callId,
        tokenAddress: window.tokenAddress,
        chain: window.chain,
        reason: result.reason || 'missing_range',
      });
    }
  }

  // Calculate integrity summary
  let integrity: CoverageResult['integrity'] | undefined;
  if (integrityConfig && issuesByCallId.size > 0) {
    let totalIssues = 0;
    let criticalIssues = 0;
    let warningIssues = 0;

    for (const issues of issuesByCallId.values()) {
      totalIssues += issues.length;
      criticalIssues += issues.filter((i) => i.severity === 'critical').length;
      warningIssues += issues.filter((i) => i.severity === 'warning').length;
    }

    integrity = {
      passed: criticalIssues === 0,
      totalIssues,
      criticalIssues,
      warningIssues,
      issuesByCallId,
    };
  }

  logger.info('Coverage check complete', {
    eligible: eligible.length,
    excluded: excluded.length,
    integrityIssues: integrity?.totalIssues ?? 0,
    integrityPassed: integrity?.passed ?? true,
  });

  return {
    eligible,
    excluded,
    integrity,
  };
}
