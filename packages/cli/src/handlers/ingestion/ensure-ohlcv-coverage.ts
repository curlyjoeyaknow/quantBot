/**
 * Ensure OHLCV Coverage Handler
 *
 * Checks and fetches OHLCV candles for all tokens in calls database <3 months old.
 * Ensures minimum coverage:
 * - 5000 15s candles
 * - 10,000 1m candles
 * - 10,000 5m candles
 */

import path from 'node:path';
import { DateTime } from 'luxon';
import { ConfigurationError, PythonEngine, isSolanaAddress, isEvmAddress } from '@quantbot/utils';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';
import { getCoverage } from '@quantbot/ohlcv';
import type { CommandContext } from '../../core/command-context.js';
import { ensureOhlcvCoverageSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';
import { logger } from '@quantbot/utils';
import { DuckDBStorageService } from '@quantbot/backtest';
import { fetchMultiChainMetadata, getBirdeyeClient, heliusRestClient } from '@quantbot/api-clients';

export type EnsureOhlcvCoverageArgs = z.infer<typeof ensureOhlcvCoverageSchema>;

interface TokenInfo {
  mint: string;
  chain: string;
  earliestCall: DateTime;
}

interface ValidatedTokenInfo {
  mint: string;
  chain: string;
  earliestCall: DateTime;
  validated: boolean;
  error?: string;
}

/**
 * Query all unique tokens from calls database <3 months old
 * Uses efficient DuckDB query via Python script
 */
async function queryRecentTokens(
  duckdbPath: string,
  maxAgeDays: number = 90
): Promise<TokenInfo[]> {
  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);

  const result = await duckdbStorage.queryTokensRecent(duckdbPath, maxAgeDays);

  if (!result.success || !result.tokens) {
    throw new Error(`Failed to query recent tokens: ${result.error || 'Unknown error'}`);
  }

  return result.tokens.map((token) => ({
    mint: token.mint,
    chain: token.chain,
    earliestCall: DateTime.fromISO(token.earliest_call_timestamp),
  }));
}

/**
 * Check if address looks like EVM (even if truncated)
 * This helps detect EVM addresses that are incorrectly marked as solana
 */
function looksLikeEvmAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  const trimmed = address.trim();
  // EVM addresses start with 0x and contain only hex characters
  // Even if truncated, we can detect the pattern
  return trimmed.startsWith('0x') && /^0x[a-fA-F0-9]+$/.test(trimmed);
}

/**
 * Check if address is truncated (incomplete)
 */
function isTruncatedAddress(address: string): { truncated: boolean; reason?: string } {
  if (!address || typeof address !== 'string') {
    return { truncated: false };
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return { truncated: false };
  }

  // Check for truncated EVM address (starts with 0x but less than 42 chars)
  if (trimmed.startsWith('0x') && /^0x[a-fA-F0-9]+$/.test(trimmed)) {
    if (trimmed.length < 42) {
      return {
        truncated: true,
        reason: `EVM address truncated: ${trimmed.length} chars (expected 42)`,
      };
    }
  }

  // Check for truncated Solana address (looks like base58 but too short)
  if (isSolanaAddress(trimmed)) {
    if (trimmed.length < 32) {
      return {
        truncated: true,
        reason: `Solana address truncated: ${trimmed.length} chars (expected 32-44)`,
      };
    }
  }

  return { truncated: false };
}

/**
 * Validate address format and length (prevent truncated addresses)
 */
function isValidAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Check for truncation first
  const truncationCheck = isTruncatedAddress(trimmed);
  if (truncationCheck.truncated) {
    return false; // Truncated addresses are invalid
  }

  // Solana addresses: 32-44 characters (Base58)
  if (isSolanaAddress(trimmed)) {
    return trimmed.length >= 32 && trimmed.length <= 44;
  }

  // EVM addresses: exactly 42 characters (0x + 40 hex chars)
  if (isEvmAddress(trimmed)) {
    return trimmed.length === 42;
  }

  // Unknown format - reject
  return false;
}

/**
 * Validate token and resolve correct chain using multiple fallback methods:
 * 1. Metadata lookup (primary)
 * 2. Historical price lookup at alert time (fallback 1)
 * 3. Helius getTransactions call (fallback 2, Solana only)
 * This prevents fetching OHLCV for invalid/truncated addresses
 */
async function validateAndResolveToken(token: TokenInfo): Promise<ValidatedTokenInfo> {
  // Step 1: Check for truncated addresses first (these should be moved to invalid_tokens_d)
  const truncationCheck = isTruncatedAddress(token.mint);
  if (truncationCheck.truncated) {
    logger.warn(`Truncated address detected: ${token.mint}`, {
      reason: truncationCheck.reason,
      length: token.mint.length,
    });
    return {
      ...token,
      validated: false,
      error: truncationCheck.reason || `Truncated address: ${token.mint.length} chars`,
    };
  }

  // Step 2: Validate address format/length
  if (!isValidAddress(token.mint)) {
    return {
      ...token,
      validated: false,
      error: `Invalid address format or length: ${token.mint.length} chars`,
    };
  }

  // Step 1.5: Detect and correct EVM addresses incorrectly marked as "solana"
  // Check for EVM pattern (even if truncated) to prevent calling Helius
  let correctedChain = token.chain;
  if (looksLikeEvmAddress(token.mint) && token.chain === 'solana') {
    logger.warn(`EVM address incorrectly marked as solana, correcting chain: ${token.mint}`, {
      originalChain: token.chain,
      addressFormat: 'EVM',
      addressLength: token.mint.length,
    });
    // For EVM addresses, we'll determine the specific chain via metadata lookup
    // For now, mark as 'ethereum' placeholder - metadata lookup will resolve the actual chain
    correctedChain = 'ethereum'; // Default to ethereum, metadata will correct if needed
  }

  // Step 2: Try metadata lookup first (cheapest and most accurate)
  try {
    const metadataResult = await fetchMultiChainMetadata(
      token.mint,
      correctedChain as 'solana' | 'ethereum' | 'base' | 'bsc' | undefined
    );

    if (metadataResult.primaryMetadata && metadataResult.primaryMetadata.found) {
      // Use the resolved chain from metadata (more accurate than DB chain)
      const resolvedChain = metadataResult.primaryMetadata.chain;

      logger.debug(`Validated token ${token.mint} via metadata`, {
        originalChain: token.chain,
        resolvedChain,
        symbol: metadataResult.primaryMetadata.symbol,
      });

      return {
        mint: token.mint,
        chain: resolvedChain,
        earliestCall: token.earliestCall,
        validated: true,
      };
    }
  } catch (error) {
    logger.debug(`Metadata lookup failed for ${token.mint}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 3: Fallback 1 - Try historical price lookup at alert time
  try {
    const birdeyeClient = getBirdeyeClient();
    const alertUnixTime = Math.floor(token.earliestCall.toSeconds());
    // Use corrected chain, but if it's EVM and we don't know which chain yet, try ethereum first
    const chainForPrice = correctedChain || 'solana';

    logger.debug(`Trying historical price lookup for ${token.mint}`, {
      alertTime: token.earliestCall.toISO(),
      unixTime: alertUnixTime,
      chain: chainForPrice,
    });

    const historicalPrice = await birdeyeClient.fetchHistoricalPriceAtUnixTime(
      token.mint,
      alertUnixTime,
      chainForPrice
    );

    if (historicalPrice && historicalPrice.value > 0) {
      logger.debug(`Validated token ${token.mint} via historical price`, {
        chain: chainForPrice,
        price: historicalPrice.value,
        unixTime: historicalPrice.unixTime,
      });

      return {
        mint: token.mint,
        chain: chainForPrice,
        earliestCall: token.earliestCall,
        validated: true,
      };
    }
  } catch (error) {
    logger.debug(`Historical price lookup failed for ${token.mint}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 4: Fallback 2 - Try Helius getTransactions (Solana only)
  // Only call Helius for actual Solana addresses, not EVM addresses (even truncated ones)
  // Never call Helius for anything that looks like EVM (starts with 0x)
  if (
    isSolanaAddress(token.mint) &&
    !isEvmAddress(token.mint) &&
    !looksLikeEvmAddress(token.mint)
  ) {
    try {
      // Check if Helius API key is available
      if (!process.env.HELIUS_API_KEY) {
        logger.debug(`Skipping Helius validation - HELIUS_API_KEY not set`);
      } else {
        logger.debug(`Trying Helius transactions lookup for ${token.mint}`);

        const transactions = await heliusRestClient.getTransactionsForAddress(token.mint, {
          limit: 1, // Just check if any transactions exist
        });

        if (transactions && transactions.length > 0) {
          logger.debug(`Validated token ${token.mint} via Helius transactions`, {
            chain: 'solana',
            transactionCount: transactions.length,
          });

          return {
            mint: token.mint,
            chain: 'solana',
            earliestCall: token.earliestCall,
            validated: true,
          };
        }
      }
    } catch (error) {
      // Don't fail validation if Helius is unavailable - just log and continue
      logger.debug(`Helius transactions lookup failed for ${token.mint}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // All validation methods failed
  logger.warn(`All validation methods failed for ${token.mint}`, {
    chain: token.chain,
  });

  return {
    ...token,
    validated: false,
    error: 'All validation methods failed (metadata, historical price, transactions)',
  };
}

/**
 * Check coverage for a token and interval
 * Checks from alert time minus appropriate window to now
 */
async function checkTokenCoverage(
  mint: string,
  chain: string,
  alertTime: DateTime,
  interval: '15s' | '1m' | '5m',
  minCandles: number
): Promise<{ hasEnough: boolean; candleCount: number }> {
  // Calculate time range based on interval requirements
  // For 15s: 5000 candles = ~20.8 hours, check from 1 day before alert to now
  // For 1m: 10,000 candles = ~6.94 days, check from 1 week before alert to now
  // For 5m: 10,000 candles = ~34.7 days, check from 1 month before alert to now
  let daysBefore: number;
  if (interval === '15s') {
    daysBefore = 1; // 1 day
  } else if (interval === '1m') {
    daysBefore = 7; // 1 week
  } else {
    // 5m
    daysBefore = 30; // 1 month
  }

  const fromTime = alertTime.minus({ days: daysBefore });
  const toTime = DateTime.utc();

  try {
    const coverage = await getCoverage(
      mint,
      chain as 'solana' | 'ethereum' | 'base' | 'bsc',
      fromTime.toJSDate(),
      toTime.toJSDate(),
      interval
    );

    return {
      hasEnough: coverage.candleCount >= minCandles,
      candleCount: coverage.candleCount,
    };
  } catch (error) {
    logger.warn(`Failed to check coverage for ${mint}`, {
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return { hasEnough: false, candleCount: 0 };
  }
}

/**
 * Fetch candles for a token and interval
 */
async function fetchCandlesForToken(
  mint: string,
  chain: string,
  alertTime: DateTime,
  interval: '15s' | '1m' | '5m',
  duckdbPath: string
): Promise<{ success: boolean; candlesFetched: number; error?: string }> {
  const workflowCtx = await createOhlcvIngestionContext({ duckdbPath });

  // Calculate time range to ensure we get enough candles
  // For 15s: 5000 candles = ~20.8 hours, fetch 1 day before alert to 1 day after
  // For 1m: 10,000 candles = ~6.94 days, fetch 1 week before alert to 1 week after
  // For 5m: 10,000 candles = ~34.7 days, fetch 1 month before alert to 1 month after
  let preWindow: number;
  let postWindow: number;

  if (interval === '15s') {
    preWindow = 1440; // 1 day
    postWindow = 1440; // 1 day
  } else if (interval === '1m') {
    preWindow = 10080; // 1 week
    postWindow = 10080; // 1 week
  } else {
    // 5m
    preWindow = 43200; // 1 month
    postWindow = 43200; // 1 month
  }

  // Calculate from/to dates based on alert time and windows
  const fromTime = alertTime.minus({ minutes: preWindow });
  const toTime = alertTime.plus({ minutes: postWindow });

  const spec: IngestOhlcvSpec = {
    duckdbPath,
    chain: chain as 'solana' | 'ethereum' | 'base' | 'bsc',
    interval,
    from: fromTime.toISO()!,
    to: toTime.toISO()!,
    preWindowMinutes: preWindow,
    postWindowMinutes: postWindow,
    side: 'buy',
    errorMode: 'collect',
    checkCoverage: true,
    rateLimitMs: 330,
    maxRetries: 3,
    mints: [mint], // Only fetch for this specific mint
  };

  try {
    const result = await ingestOhlcv(spec, workflowCtx);
    return {
      success: result.workItemsFailed === 0,
      candlesFetched: result.totalCandlesFetched,
      error:
        result.errors && result.errors.length > 0
          ? result.errors.map((e) => e.error).join('; ')
          : undefined,
    };
  } catch (error) {
    return {
      success: false,
      candlesFetched: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * CLI handler for ensuring OHLCV coverage
 */
export async function ensureOhlcvCoverageHandler(
  args: EnsureOhlcvCoverageArgs,
  _ctx: CommandContext
) {
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdbPath',
      { args, env: { DUCKDB_PATH: process.env.DUCKDB_PATH } }
    );
  }
  const duckdbPath = path.resolve(duckdbPathRaw);

  const maxAgeDays = args.maxAgeDays || 90; // Default to 3 months

  logger.info('Querying tokens from calls database', {
    duckdbPath,
    maxAgeDays,
  });

  // Query all tokens <3 months old
  const allTokens = await queryRecentTokens(duckdbPath, maxAgeDays);

  // Limit to first N tokens for this run (default: 200)
  const limit = args.limit || 200;
  const tokens = allTokens.slice(0, limit);

  logger.info(`Found ${allTokens.length} total tokens, processing first ${tokens.length} tokens`);

  // Step 1: Validate addresses and resolve chains (cheap metadata lookup first)
  logger.info('Validating addresses and resolving chains...');
  const validatedTokens: ValidatedTokenInfo[] = [];
  const invalidTokens: ValidatedTokenInfo[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if ((i + 1) % 50 === 0) {
      logger.info(`Validating ${i + 1}/${tokens.length} tokens...`);
    }

    const validated = await validateAndResolveToken(token);
    if (validated.validated) {
      validatedTokens.push(validated);
    } else {
      invalidTokens.push(validated);
      logger.warn(`Skipping invalid token ${token.mint}`, {
        error: validated.error,
      });
    }

    // Rate limiting for metadata lookups (cheap but still need to be respectful)
    if (i < tokens.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms between metadata calls
    }
  }

  logger.info(
    `Validation complete: ${validatedTokens.length} valid, ${invalidTokens.length} invalid`
  );

  // Step 1.5: Move invalid tokens (including truncated addresses) to separate table
  let moveResult: {
    calls_moved: number;
    links_moved: number;
    callers_affected: number;
  } | null = null;

  if (invalidTokens.length > 0) {
    const invalidMints = invalidTokens.map((t) => t.mint);
    logger.info(
      `Moving ${invalidTokens.length} invalid tokens (including truncated addresses) to invalid_tokens_d table...`
    );

    const pythonEngine = new PythonEngine();
    const duckdbStorage = new DuckDBStorageService(pythonEngine);

    const moveResultData = await duckdbStorage.moveInvalidTokens(duckdbPath, invalidMints, false);

    if (moveResultData.success) {
      logger.info(`Moved invalid tokens to invalid_tokens_d table`, {
        calls_moved: moveResultData.total_calls_moved,
        links_moved: moveResultData.total_links_moved,
        callers_affected: moveResultData.total_callers_affected,
      });
      moveResult = {
        calls_moved: moveResultData.total_calls_moved,
        links_moved: moveResultData.total_links_moved,
        callers_affected: moveResultData.total_callers_affected,
      };
    } else {
      logger.error(`Failed to move invalid tokens`, {
        error: moveResultData.error,
      });
    }
  }

  const results = {
    totalTokens: tokens.length,
    validTokens: validatedTokens.length,
    invalidTokens: invalidTokens.length,
    tokensChecked: 0,
    tokensFetched: 0,
    intervalsFetched: {
      '15s': 0,
      '1m': 0,
      '5m': 0,
    },
    errors: [] as Array<{ mint: string; interval: string; error: string }>,
    invalidAddresses: invalidTokens.map((t) => ({
      mint: t.mint,
      error: t.error || 'Unknown validation error',
    })),
    invalidTokensMoved: moveResult,
  };

  // Step 2: Process validated tokens for OHLCV coverage
  for (let i = 0; i < validatedTokens.length; i++) {
    const token = validatedTokens[i]!;
    results.tokensChecked++;

    logger.info(`Processing token ${i + 1}/${tokens.length}: ${token.mint}`, {
      earliestCall: token.earliestCall.toISO(),
    });

    // Check and fetch for each interval
    const intervals: Array<{ interval: '15s' | '1m' | '5m'; minCandles: number }> = [
      { interval: '15s', minCandles: 5000 },
      { interval: '1m', minCandles: 10000 },
      { interval: '5m', minCandles: 10000 },
    ];

    for (const { interval, minCandles } of intervals) {
      // Check coverage
      const coverage = await checkTokenCoverage(
        token.mint,
        token.chain,
        token.earliestCall,
        interval,
        minCandles
      );

      if (!coverage.hasEnough) {
        logger.info(
          `Fetching ${interval} candles for ${token.mint} (has ${coverage.candleCount}, needs ${minCandles})`
        );

        const fetchResult = await fetchCandlesForToken(
          token.mint,
          token.chain,
          token.earliestCall,
          interval,
          duckdbPath
        );

        if (fetchResult.success) {
          results.intervalsFetched[interval]++;
          logger.info(
            `Fetched ${fetchResult.candlesFetched} ${interval} candles for ${token.mint}`
          );
        } else {
          results.errors.push({
            mint: token.mint,
            interval,
            error: fetchResult.error || 'Unknown error',
          });
          logger.error(`Failed to fetch ${interval} candles for ${token.mint}`, {
            error: fetchResult.error,
          });
        }

        // Rate limiting between fetches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        logger.debug(
          `Token ${token.mint} has sufficient ${interval} coverage (${coverage.candleCount} candles)`
        );
      }
    }

    // Progress update every 10 tokens
    if ((i + 1) % 10 === 0) {
      logger.info(`Progress: ${i + 1}/${tokens.length} tokens processed`);
    }
  }

  results.tokensFetched =
    results.intervalsFetched['15s'] +
    results.intervalsFetched['1m'] +
    results.intervalsFetched['5m'];

  if (args.format === 'json') {
    return results;
  }

  // Build summary format
  return [
    {
      type: 'SUMMARY',
      totalTokens: results.totalTokens,
      tokensChecked: results.tokensChecked,
      intervalsFetched: results.intervalsFetched,
      errors: results.errors.length,
    },
    ...(results.errors.length > 0
      ? results.errors.map((err) => ({
          type: 'ERROR',
          mint: err.mint,
          interval: err.interval,
          error: err.error,
        }))
      : []),
  ];
}
