/**
 * Resolve EVM Chain Workflow
 *
 * Identifies tokens with generic 'evm' chain and resolves them to specific chains
 * (ethereum, bsc, base) using Birdeye's multi-chain metadata API.
 *
 * Workflow:
 * 1. Query ClickHouse/DuckDB for tokens with chain='evm'
 * 2. For each token, try Birdeye metadata on: ethereum, bsc, base
 * 3. Update chain to the one that returns valid metadata
 * 4. Return results (resolved, failed, skipped)
 *
 * Trigger points:
 * - After OHLCV ingestion
 * - After Telegram ingestion
 * - Manual execution
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError, logger as utilsLogger } from '@quantbot/utils';
import type { BirdeyeClient } from '@quantbot/api-clients';

/**
 * Resolve EVM Chains Spec
 */
export const ResolveEvmChainsSpecSchema = z.object({
  duckdbPath: z.string().optional(),
  useClickHouse: z.boolean().default(true),
  useDuckDB: z.boolean().default(true),
  limit: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  errorMode: z.enum(['collect', 'failFast']).default('collect'),
});

export type ResolveEvmChainsSpec = z.infer<typeof ResolveEvmChainsSpecSchema>;

/**
 * Token to resolve
 */
export interface EvmToken {
  address: string;
  source: 'clickhouse' | 'duckdb';
}

/**
 * Resolution result for a single token
 */
export interface TokenResolutionResult {
  address: string;
  originalChain: string;
  resolvedChain: string | null;
  success: boolean;
  error?: string;
  metadata?: {
    name?: string;
    symbol?: string;
    decimals?: number;
  };
}

/**
 * Overall workflow result
 */
export interface ResolveEvmChainsResult {
  tokensFound: number;
  tokensResolved: number;
  tokensFailed: number;
  tokensSkipped: number;
  results: TokenResolutionResult[];
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
}

/**
 * Context for EVM chain resolution
 */
export interface ResolveEvmChainsContext {
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };

  birdeyeClient: BirdeyeClient;

  getEvmTokensFromClickHouse?: () => Promise<EvmToken[]>;
  getEvmTokensFromDuckDB?: (duckdbPath: string) => Promise<EvmToken[]>;

  updateChainInClickHouse?: (address: string, newChain: string) => Promise<void>;
  updateChainInDuckDB?: (duckdbPath: string, address: string, newChain: string) => Promise<void>;
}

/**
 * Get EVM tokens from ClickHouse
 */
async function getEvmTokensFromClickHouse(): Promise<EvmToken[]> {
  const { getClickHouseClient } = await import('@quantbot/storage');
  const ch = getClickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  const query = `
    SELECT DISTINCT token_address
    FROM ${database}.ohlcv_candles
    WHERE chain = 'evm'
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const data = (await result.json()) as Array<{ token_address: string }>;

  return data.map((row) => ({
    address: row.token_address,
    source: 'clickhouse' as const,
  }));
}

/**
 * Get EVM tokens from DuckDB
 */
async function getEvmTokensFromDuckDB(duckdbPath: string): Promise<EvmToken[]> {
  const { PythonEngine } = await import('@quantbot/utils');
  const engine = new PythonEngine();

  const result = await engine.runScript(
    'tools/storage/query_evm_tokens.py',
    { 'db-path': duckdbPath },
    z.object({
      tokens: z.array(z.string()),
    })
  );

  return result.tokens.map((address) => ({
    address,
    source: 'duckdb' as const,
  }));
}

/**
 * Try to resolve EVM token to specific chain
 */
async function resolveTokenChain(
  address: string,
  birdeyeClient: BirdeyeClient,
  logger: ResolveEvmChainsContext['logger']
): Promise<{ chain: string | null; metadata?: any }> {
  // Try chains in order: ethereum (most common), base, bsc
  const chainsToTry: Array<'ethereum' | 'base' | 'bsc'> = ['ethereum', 'base', 'bsc'];

  for (const chain of chainsToTry) {
    try {
      logger.debug?.(`Trying ${chain} for ${address.substring(0, 20)}...`);

      const metadata = await birdeyeClient.getTokenMetadata(address, chain);

      if (metadata && metadata.symbol) {
        logger.info(`Resolved ${address.substring(0, 20)}... to ${chain}`, {
          symbol: metadata.symbol,
          name: metadata.name,
        });

        return { chain, metadata };
      }
    } catch (error) {
      // Continue to next chain
      logger.debug?.(`${chain} failed for ${address.substring(0, 20)}...`);
    }
  }

  return { chain: null };
}

/**
 * Update chain in ClickHouse
 */
async function updateChainInClickHouse(address: string, newChain: string): Promise<void> {
  const { getClickHouseClient } = await import('@quantbot/storage');
  const ch = getClickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Note: This uses ALTER TABLE UPDATE which may not work in ClickHouse 18.16
  // If it fails, we'll just log and continue (new data will have correct chain)
  try {
    const query = `
      ALTER TABLE ${database}.ohlcv_candles
      UPDATE chain = '${newChain}'
      WHERE token_address = '${address}' AND chain = 'evm'
    `;

    await ch.exec({ query });
  } catch (error) {
    // ClickHouse 18.16 doesn't support UPDATE on partition key
    // Just log - new fetches will use correct chain
    utilsLogger.warn('Could not update chain in ClickHouse (expected for CH 18.16)', {
      address: address.substring(0, 20),
      newChain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update chain in DuckDB
 */
async function updateChainInDuckDB(
  duckdbPath: string,
  address: string,
  newChain: string
): Promise<void> {
  const { PythonEngine } = await import('@quantbot/utils');
  const engine = new PythonEngine();

  await engine.runScript(
    'tools/storage/update_chain_duckdb.py',
    {
      'db-path': duckdbPath,
      address,
      'new-chain': newChain,
    },
    z.object({ success: z.boolean() })
  );
}

/**
 * Resolve EVM Chains Workflow
 *
 * Identifies tokens with generic 'evm' chain and resolves them to specific chains.
 */
export async function resolveEvmChains(
  spec: ResolveEvmChainsSpec,
  ctx: ResolveEvmChainsContext
): Promise<ResolveEvmChainsResult> {
  const startedAt = DateTime.utc();
  const startedAtISO = startedAt.toISO()!;

  // 1. Validate spec
  const parsed = ResolveEvmChainsSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid resolve EVM chains spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;

  ctx.logger.info('Starting EVM chain resolution workflow', {
    useClickHouse: validated.useClickHouse,
    useDuckDB: validated.useDuckDB,
    duckdbPath: validated.duckdbPath,
    limit: validated.limit,
    dryRun: validated.dryRun,
  });

  // 2. Collect EVM tokens from sources
  const evmTokens: EvmToken[] = [];

  if (validated.useClickHouse) {
    try {
      const getTokensFn = ctx.getEvmTokensFromClickHouse || getEvmTokensFromClickHouse;
      const tokens = await getTokensFn();
      evmTokens.push(...tokens);
      ctx.logger.info(`Found ${tokens.length} EVM tokens in ClickHouse`);
    } catch (error) {
      ctx.logger.error('Failed to get EVM tokens from ClickHouse', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (validated.useDuckDB && validated.duckdbPath) {
    try {
      const getTokensFn = ctx.getEvmTokensFromDuckDB || getEvmTokensFromDuckDB;
      const tokens = await getTokensFn(validated.duckdbPath);
      evmTokens.push(...tokens);
      ctx.logger.info(`Found ${tokens.length} EVM tokens in DuckDB`);
    } catch (error) {
      ctx.logger.error('Failed to get EVM tokens from DuckDB', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Deduplicate by address
  const uniqueTokens = Array.from(new Map(evmTokens.map((t) => [t.address, t])).values());

  ctx.logger.info(`Total unique EVM tokens to resolve: ${uniqueTokens.length}`);

  // Apply limit if specified
  const tokensToResolve = validated.limit ? uniqueTokens.slice(0, validated.limit) : uniqueTokens;

  if (validated.limit && uniqueTokens.length > validated.limit) {
    ctx.logger.info(`Limited to first ${validated.limit} tokens`);
  }

  // 3. Resolve each token
  const results: TokenResolutionResult[] = [];
  let resolved = 0;
  let failed = 0;
  const skipped = 0;

  for (const [index, token] of tokensToResolve.entries()) {
    ctx.logger.info(
      `[${index + 1}/${tokensToResolve.length}] Resolving ${token.address.substring(0, 20)}...`
    );

    try {
      const { chain, metadata } = await resolveTokenChain(
        token.address,
        ctx.birdeyeClient,
        ctx.logger
      );

      if (chain) {
        results.push({
          address: token.address,
          originalChain: 'evm',
          resolvedChain: chain,
          success: true,
          metadata: metadata
            ? {
                name: metadata.name,
                symbol: metadata.symbol,
                decimals: metadata.decimals,
              }
            : undefined,
        });

        // Update in databases (unless dry run)
        if (!validated.dryRun) {
          // Update ClickHouse
          if (validated.useClickHouse) {
            try {
              const updateFn = ctx.updateChainInClickHouse || updateChainInClickHouse;
              await updateFn(token.address, chain);
            } catch (error) {
              ctx.logger.warn('Failed to update chain in ClickHouse', {
                address: token.address.substring(0, 20),
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // Update DuckDB
          if (validated.useDuckDB && validated.duckdbPath) {
            try {
              const updateFn = ctx.updateChainInDuckDB || updateChainInDuckDB;
              await updateFn(validated.duckdbPath, token.address, chain);
            } catch (error) {
              ctx.logger.warn('Failed to update chain in DuckDB', {
                address: token.address.substring(0, 20),
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        resolved++;
      } else {
        results.push({
          address: token.address,
          originalChain: 'evm',
          resolvedChain: null,
          success: false,
          error: 'No valid chain found (tried ethereum, base, bsc)',
        });
        failed++;
      }
    } catch (error) {
      results.push({
        address: token.address,
        originalChain: 'evm',
        resolvedChain: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }

    // Rate limiting (5 credits per call, ~200 calls/minute safe)
    if (index < tokensToResolve.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300)); // 300ms between calls
    }
  }

  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt, 'milliseconds').milliseconds;

  ctx.logger.info('Completed EVM chain resolution workflow', {
    tokensFound: uniqueTokens.length,
    tokensProcessed: tokensToResolve.length,
    tokensResolved: resolved,
    tokensFailed: failed,
    tokensSkipped: skipped,
    durationMs,
  });

  return {
    tokensFound: uniqueTokens.length,
    tokensResolved: resolved,
    tokensFailed: failed,
    tokensSkipped: skipped,
    results,
    startedAtISO,
    completedAtISO,
    durationMs,
  };
}

/**
 * Create default context for EVM chain resolution
 */
export function createDefaultResolveEvmChainsContext(): ResolveEvmChainsContext {
  // Dynamic imports to avoid circular dependencies
  const getBirdeyeClient = async () => {
    const { getBirdeyeClient: getClient } = await import('@quantbot/api-clients');
    return getClient();
  };

  return {
    logger: {
      info: (msg, ctx) => utilsLogger.info(msg, ctx as Record<string, unknown>),
      warn: (msg, ctx) => utilsLogger.warn(msg, ctx as Record<string, unknown>),
      error: (msg, ctx) => utilsLogger.error(msg, ctx as Record<string, unknown>),
      debug: (msg, ctx) => utilsLogger.debug(msg, ctx as Record<string, unknown>),
    },
    birdeyeClient: null as any, // Will be set lazily
    getEvmTokensFromClickHouse,
    getEvmTokensFromDuckDB,
    updateChainInClickHouse,
    updateChainInDuckDB,
  };
}
