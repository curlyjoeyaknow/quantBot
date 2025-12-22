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
import { ValidationError } from '@quantbot/utils';
import type { WorkflowContextWithPorts } from '../context/workflowContextWithPorts.js';

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
 * Uses ports for all external dependencies
 */
export type ResolveEvmChainsContext = WorkflowContextWithPorts & {
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };

  getEvmTokensFromClickHouse?: () => Promise<EvmToken[]>;
  getEvmTokensFromDuckDB?: (duckdbPath: string) => Promise<EvmToken[]>;

  updateChainInClickHouse?: (address: string, newChain: string) => Promise<void>;
  updateChainInDuckDB?: (duckdbPath: string, address: string, newChain: string) => Promise<void>;
};

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
 * Try to resolve EVM token to specific chain using market data port
 */
async function resolveTokenChain(
  address: string,
  ctx: ResolveEvmChainsContext
): Promise<{
  chain: string | null;
  metadata?: { name?: string; symbol?: string; decimals?: number };
}> {
  // Try chains in order: ethereum (most common), base, bsc
  const chainsToTry: Array<'ethereum' | 'base' | 'bsc'> = ['ethereum', 'base', 'bsc'];

  for (const chain of chainsToTry) {
    try {
      workflowCtx.logger.debug?.(`Trying ${chain} for ${address.substring(0, 20)}...`);

      // Use market data port instead of direct client
      const metadata = await ctx.ports.marketData.fetchMetadata({
        tokenAddress: address,
        chain,
      });

      if (metadata && metadata.symbol) {
        workflowCtx.logger.info(`Resolved ${address.substring(0, 20)}... to ${chain}`, {
          symbol: metadata.symbol,
          name: metadata.name,
        });

        // Emit telemetry event
        workflowCtx.ports.telemetry.emitEvent({
          name: 'evm_chain_resolved',
          level: 'info',
          message: `Resolved EVM token to ${chain}`,
          context: {
            address: address.substring(0, 20),
            chain,
            symbol: metadata.symbol,
          },
          timestamp: ctx.ports.clock.nowMs(),
        });

        return {
          chain,
          metadata: {
            name: metadata.name,
            symbol: metadata.symbol,
            decimals: metadata.decimals,
          },
        };
      }
    } catch (error) {
      // Continue to next chain
      workflowCtx.logger.debug?.(`${chain} failed for ${address.substring(0, 20)}...`);
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
    const { logger: utilsLogger } = await import('@quantbot/utils');
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
  ctx?: ResolveEvmChainsContext
): Promise<ResolveEvmChainsResult> {
  // Use provided context or create default (for testing convenience)
  const workflowCtx = ctx || (await createDefaultResolveEvmChainsContext());
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

  // Emit workflow start event
  workflowCtx.ports.telemetry.emitEvent({
    name: 'evm_chain_resolution_started',
    level: 'info',
    message: 'Starting EVM chain resolution workflow',
    context: {
      useClickHouse: validated.useClickHouse,
      useDuckDB: validated.useDuckDB,
      limit: validated.limit,
      dryRun: validated.dryRun,
    },
    timestamp: ctx.ports.clock.nowMs(),
  });

  workflowCtx.logger.info('Starting EVM chain resolution workflow', {
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
      workflowCtx.logger.info(`Found ${tokens.length} EVM tokens in ClickHouse`);
    } catch (error) {
      workflowCtx.logger.error('Failed to get EVM tokens from ClickHouse', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (validated.useDuckDB && validated.duckdbPath) {
    try {
      const getTokensFn = ctx.getEvmTokensFromDuckDB || getEvmTokensFromDuckDB;
      const tokens = await getTokensFn(validated.duckdbPath);
      evmTokens.push(...tokens);
      workflowCtx.logger.info(`Found ${tokens.length} EVM tokens in DuckDB`);
    } catch (error) {
      workflowCtx.logger.error('Failed to get EVM tokens from DuckDB', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Deduplicate by address
  const uniqueTokens = Array.from(new Map(evmTokens.map((t) => [t.address, t])).values());

  workflowCtx.logger.info(`Total unique EVM tokens to resolve: ${uniqueTokens.length}`);

  // Apply limit if specified
  const tokensToResolve = validated.limit ? uniqueTokens.slice(0, validated.limit) : uniqueTokens;

  if (validated.limit && uniqueTokens.length > validated.limit) {
    workflowCtx.logger.info(`Limited to first ${validated.limit} tokens`);
  }

  // 3. Resolve each token
  const results: TokenResolutionResult[] = [];
  let resolved = 0;
  let failed = 0;
  const skipped = 0;

  for (const [index, token] of tokensToResolve.entries()) {
    workflowCtx.logger.info(
      `[${index + 1}/${tokensToResolve.length}] Resolving ${token.address.substring(0, 20)}...`
    );

    // Check idempotency: have we already resolved this token?
    const idempotencyKey = `evm_chain_resolution:${token.address}`;
    const cached = await ctx.ports.state.get<{ chain: string; resolvedAt: number }>({
      key: idempotencyKey,
      namespace: 'evm_chain_resolution',
    });

    if (cached.found && cached.value) {
      workflowCtx.logger.debug(
        `Skipping ${token.address.substring(0, 20)}... (already resolved to ${cached.value.chain})`
      );
      results.push({
        address: token.address,
        originalChain: 'evm',
        resolvedChain: cached.value.chain,
        success: true,
      });
      resolved++;
      continue;
    }

    try {
      const { chain, metadata } = await resolveTokenChain(token.address, workflowCtx);

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

        // Cache resolution result for idempotency
        await ctx.ports.state.set({
          key: idempotencyKey,
          namespace: 'evm_chain_resolution',
          value: {
            chain,
            resolvedAt: ctx.ports.clock.nowMs(),
          },
          ttlSeconds: 86400 * 30, // 30 days TTL
        });

        // Update in databases (unless dry run)
        if (!validated.dryRun) {
          // Update ClickHouse
          if (validated.useClickHouse) {
            try {
              const updateFn = ctx.updateChainInClickHouse || updateChainInClickHouse;
              await updateFn(token.address, chain);
            } catch (error) {
              workflowCtx.logger.warn('Failed to update chain in ClickHouse', {
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
              workflowCtx.logger.warn('Failed to update chain in DuckDB', {
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

  // Emit workflow completion event
  workflowCtx.ports.telemetry.emitEvent({
    name: 'evm_chain_resolution_completed',
    level: 'info',
    message: 'Completed EVM chain resolution workflow',
    context: {
      tokensFound: uniqueTokens.length,
      tokensProcessed: tokensToResolve.length,
      tokensResolved: resolved,
      tokensFailed: failed,
      tokensSkipped: skipped,
      durationMs,
    },
    timestamp: ctx.ports.clock.nowMs(),
  });

  // Emit summary metrics
  workflowCtx.ports.telemetry.emitMetric({
    name: 'evm_chain_resolution_tokens_found',
    type: 'counter',
    value: uniqueTokens.length,
    timestamp: ctx.ports.clock.nowMs(),
  });

  workflowCtx.ports.telemetry.emitMetric({
    name: 'evm_chain_resolution_tokens_resolved',
    type: 'counter',
    value: resolved,
    timestamp: ctx.ports.clock.nowMs(),
  });

  workflowCtx.ports.telemetry.emitMetric({
    name: 'evm_chain_resolution_tokens_failed',
    type: 'counter',
    value: failed,
    timestamp: ctx.ports.clock.nowMs(),
  });

  workflowCtx.ports.telemetry.emitMetric({
    name: 'evm_chain_resolution_duration_ms',
    type: 'histogram',
    value: durationMs,
    timestamp: ctx.ports.clock.nowMs(),
  });

  workflowCtx.logger.info('Completed EVM chain resolution workflow', {
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
 * Uses WorkflowContextWithPorts for all dependencies
 */
export async function createDefaultResolveEvmChainsContext(): Promise<ResolveEvmChainsContext> {
  const { createProductionContextWithPorts } =
    await import('../context/createProductionContext.js');
  const baseContext = await createProductionContextWithPorts();

  return {
    ...baseContext,
    getEvmTokensFromClickHouse,
    getEvmTokensFromDuckDB,
    updateChainInClickHouse,
    updateChainInDuckDB,
  };
}
