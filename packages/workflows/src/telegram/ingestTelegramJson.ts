/**
 * Ingest Telegram JSON exports workflow
 *
 * Pipeline: raw -> normalize -> validate -> store
 *
 * Orchestrates:
 * 1. Parse and normalize JSON export
 * 2. Convert normalized messages to ParsedMessage format
 * 3. Build message index
 * 4. Find bot messages
 * 5. Extract bot data, resolve callers, validate, store
 */

import { z } from 'zod';
import { ValidationError, AppError } from '@quantbot/utils';
import type { TokenAddress } from '@quantbot/core';
import type { WorkflowContextWithPorts } from '../context/workflowContextWithPorts.js';
import {
  parseJsonExport,
  type ParseJsonExportResult,
  normalizedToParsedBatch,
  BotMessageExtractor,
  ChunkValidator,
  type ExtractedBotData,
  type ResolvedCaller,
} from '@quantbot/data/ingestion';
import { isEvmAddress } from '@quantbot/utils';
import { CallersRepository } from '@quantbot/storage';
import { TokenDataRepository } from '@quantbot/storage';
import { createProductionContextWithPorts } from '../context/createProductionContext.js';
// PostgreSQL repositories removed - use TelegramPipelineService for DuckDB storage

const IngestSpecSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
  chatId: z.string().optional(),
  callerName: z.string().optional(),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).optional(),
  chunkSize: z.number().int().min(1).max(100).optional(),
  writeStreams: z.boolean().optional(), // Whether to write NDJSON streams
  outputDir: z.string().optional(), // Output directory for streams
});

export type TelegramJsonIngestSpec = z.infer<typeof IngestSpecSchema>;

export type TelegramJsonIngestResult = {
  totalProcessed: number;
  normalized: number;
  quarantined: number;
  botMessagesFound: number;
  botMessagesProcessed: number;
  alertsInserted: number;
  callsInserted: number;
  tokensUpserted: number;
  messagesFailed: number;
  streamResult?: {
    normalizedPath?: string;
    quarantinePath?: string;
  };
};

export type TelegramJsonIngestContext = WorkflowContextWithPorts & {
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };
  repos: {
    callers: CallersRepository; // DuckDB version
    tokenData: TokenDataRepository; // DuckDB version for token data
  };
  // Use TelegramPipelineService for storing calls/alerts in DuckDB
  telegramPipeline?: {
    runPipeline: (
      inputFile: string,
      outputDb: string,
      chatId: string,
      rebuild?: boolean
    ) => Promise<{ success: boolean; error?: string }>;
  };
};

/**
 * Check if a sender name is a bot
 */

/**
 * Create default context (for testing)
 */
export async function createDefaultTelegramJsonIngestContext(): Promise<TelegramJsonIngestContext> {
  const baseContext = await createProductionContextWithPorts();
  const dbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const { logger } = await import('@quantbot/utils');

  return {
    ...baseContext,
    logger: {
      info: (msg: string, ctx?: unknown) =>
        logger.info(msg, ctx as Record<string, unknown> | undefined),
      warn: (msg: string, ctx?: unknown) =>
        logger.warn(msg, ctx as Record<string, unknown> | undefined),
      error: (msg: string, ctx?: unknown) =>
        logger.error(msg, ctx as Record<string, unknown> | undefined),
      debug: (msg: string, ctx?: unknown) =>
        logger.debug(msg, ctx as Record<string, unknown> | undefined),
    },
    repos: {
      // NOTE: Direct instantiation is acceptable here - this is a context factory (composition root)
      callers: new CallersRepository(dbPath),
      tokenData: new TokenDataRepository(dbPath),
    },
  };
}

/**
 * Ingest Telegram JSON export with normalization
 */
export async function ingestTelegramJson(
  spec: TelegramJsonIngestSpec,
  ctx?: TelegramJsonIngestContext
): Promise<TelegramJsonIngestResult> {
  // Create default context if not provided
  const workflowCtx = ctx ?? (await createDefaultTelegramJsonIngestContext());
  // 1. Validate spec
  const parsed = IngestSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid ingestion spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;

  workflowCtx.logger.info('Starting Telegram JSON ingestion workflow', {
    filePath: validated.filePath,
    chatId: validated.chatId,
    callerName: validated.callerName,
    chain: validated.chain,
  });

  // 2. Parse and normalize JSON export: raw -> normalize
  let parseResult: ParseJsonExportResult;
  try {
    parseResult = parseJsonExport(validated.filePath, validated.chatId);
  } catch (error) {
    workflowCtx.logger.error('Failed to parse JSON export', error as Error);
    throw new AppError(
      `Failed to parse Telegram JSON export: ${error instanceof Error ? error.message : String(error)}`,
      'PARSE_ERROR',
      500,
      { filePath: validated.filePath, chatId: validated.chatId }
    );
  }

  workflowCtx.logger.info('Normalization complete', {
    totalProcessed: parseResult.totalProcessed,
    normalized: parseResult.normalized.length,
    quarantined: parseResult.quarantined.length,
  });

  // 3. Write streams if requested (for debugging)
  let streamResult: { normalizedPath?: string; quarantinePath?: string } | undefined;
  if (validated.writeStreams) {
    const { ingestJsonExport } = await import('@quantbot/data/ingestion');
    const ingestResult = await ingestJsonExport({
      filePath: validated.filePath,
      chatId: validated.chatId,
      outputDir: validated.outputDir,
      writeStreams: true,
    });

    if (ingestResult.streamResult) {
      streamResult = {
        normalizedPath: ingestResult.streamResult.normalizedPath,
        quarantinePath: ingestResult.streamResult.quarantinePath,
      };
      workflowCtx.logger.info('Streams written', streamResult);
    }
  }

  // 4. Convert normalized messages to ParsedMessage format
  const parsedMessages = normalizedToParsedBatch(parseResult.normalized);

  workflowCtx.logger.info('Converted to ParsedMessage format', {
    count: parsedMessages.length,
  });

  // 5. Filter bot messages by fromId (Rick and Phanes bot IDs)
  // Rick: user6126376117, Phanes: user7774196337
  const BOT_IDS = ['user6126376117', 'user7774196337'];

  // Create lookup map for normalized messages by messageId
  const normalizedById = new Map<number, (typeof parseResult.normalized)[0]>();
  for (const msg of parseResult.normalized) {
    normalizedById.set(msg.messageId, msg);
  }

  // Filter for bot messages by fromId
  const botNormalizedMessages = parseResult.normalized.filter(
    (msg: (typeof parseResult.normalized)[0]) =>
      msg.fromId !== null && BOT_IDS.includes(String(msg.fromId))
  );
  workflowCtx.logger.info('Found bot messages', { count: botNormalizedMessages.length });

  // 6. Process bot messages: extract, resolve caller, validate, store
  const botExtractor = new BotMessageExtractor();
  const chunkValidator = new ChunkValidator({
    chunkSize: validated.chunkSize || 10,
  });

  // TokenDataRepository removed - TelegramPipelineService Python script handles all storage

  let alertsInserted = 0;
  let callsInserted = 0;
  let messagesFailed = 0;
  let botMessagesProcessed = 0;
  const tokensUpsertedSet = new Set<string>();
  const chunkResults: Array<{ botData: ExtractedBotData; caller: ResolvedCaller }> = [];

  for (let i = 0; i < botNormalizedMessages.length; i++) {
    const botMsg = botNormalizedMessages[i];
    if (!botMsg) continue;

    try {
      // Extract bot data from text
      const botData = botExtractor.extract(botMsg.text);

      // Extract contract address from links if not found in text
      if (!botData.contractAddress && botMsg.links) {
        for (const link of botMsg.links) {
          // pump.fun links: https://pump.fun/ADDRESS
          const pumpMatch = link.href.match(/pump\.fun\/([A-Za-z0-9]{32,44})/);
          if (pumpMatch && pumpMatch[1]) {
            botData.contractAddress = pumpMatch[1];
            break;
          }
          // dexscreener links: https://dexscreener.com/solana/ADDRESS
          const dexMatch = link.href.match(/dexscreener\.com\/[^/]+\/([A-Za-z0-9]{32,44})/);
          if (dexMatch && dexMatch[1]) {
            botData.contractAddress = dexMatch[1];
            break;
          }
          // solscan links: https://solscan.io/token/ADDRESS
          const solscanMatch = link.href.match(/solscan\.io\/token\/([A-Za-z0-9]{32,44})/);
          if (solscanMatch && solscanMatch[1]) {
            botData.contractAddress = solscanMatch[1];
            break;
          }
        }
      }

      // Set message timestamp
      botData.messageTimestamp = new Date(botMsg.timestampMs);

      if (!botData.contractAddress) {
        workflowCtx.logger.info('Skipping bot message - no contract address', {
          messageId: botMsg.messageId,
        });
        continue;
      }

      // Resolve caller message using replyToMessageId
      if (!botMsg.replyToMessageId) {
        workflowCtx.logger.info('Skipping bot message - no reply_to', {
          messageId: botMsg.messageId,
        });
        continue;
      }

      const callerMsg = normalizedById.get(botMsg.replyToMessageId);
      if (!callerMsg) {
        workflowCtx.logger.info('Skipping bot message - caller message not found', {
          messageId: botMsg.messageId,
          replyToMessageId: botMsg.replyToMessageId,
        });
        continue;
      }

      // Extract caller name from caller message
      const callerName: string = callerMsg.fromName || validated.callerName || 'Unknown';
      let chain: string = botData.chain || validated.chain || 'solana';

      // Set original message ID from caller
      botData.originalMessageId = String(callerMsg.messageId);

      // For EVM addresses, validate and get correct chain using multi-chain metadata
      // Multi-chain try logic: try chains in order until we find metadata
      if (isEvmAddress(botData.contractAddress)) {
        const chainsToTry: Array<'ethereum' | 'base' | 'bsc'> = ['ethereum', 'base', 'bsc'];
        let resolvedMetadata: { chain: string; name?: string; symbol?: string } | null = null;

        for (const tryChain of chainsToTry) {
          try {
            const metadata = await workflowCtx.ports.marketData.fetchMetadata({
              tokenAddress: botData.contractAddress as TokenAddress, // Type assertion for address string
              chain: tryChain,
            });

            if (metadata && metadata.symbol) {
              resolvedMetadata = {
                chain: tryChain,
                name: metadata.name,
                symbol: metadata.symbol,
              };
              break;
            }
          } catch {
            // Continue to next chain
            continue;
          }
        }

        if (resolvedMetadata) {
          // Use actual chain from API response
          chain = resolvedMetadata.chain;
          // Update botData with actual metadata if not already set
          if (!botData.tokenName && resolvedMetadata.name) {
            botData.tokenName = resolvedMetadata.name;
          }
          if (!botData.ticker && resolvedMetadata.symbol) {
            botData.ticker = resolvedMetadata.symbol;
          }
          workflowCtx.ports.telemetry.emitEvent({
            name: 'telegram.ingest.chain_validated',
            level: 'debug',
            message: 'Chain validated via multi-chain metadata',
            context: {
              address: botData.contractAddress,
              chainHint: botData.chain || validated.chain,
              actualChain: chain,
              symbol: resolvedMetadata.symbol,
            },
          });
        } else {
          workflowCtx.ports.telemetry.emitEvent({
            name: 'telegram.ingest.no_metadata',
            level: 'warn',
            message: 'No metadata found for EVM address on any chain',
            context: {
              address: botData.contractAddress,
              chainHint: chain,
            },
          });
        }
      }

      // Resolve/create caller (DuckDB version)
      // Note: Caller is resolved but not used for storage - TelegramPipelineService handles all storage
      await workflowCtx.repos.callers.getOrCreateCaller(
        chain.toLowerCase(),
        callerName,
        callerName
      );

      // Use caller timestamp for alert (when the user originally called the token)
      const alertTime = new Date(callerMsg.timestampMs);

      // Note: All data storage (calls, alerts, tokens) is handled by TelegramPipelineService
      // The Python script (duckdb_punch_pipeline.py) processes the entire JSON file and stores:
      // - user_calls_d (calls)
      // - caller_links_d (alerts/bot responses)
      // - tg_norm_d (normalized messages)
      // We track counts here for reporting, but actual storage happens via the pipeline
      tokensUpsertedSet.add(botData.contractAddress);
      alertsInserted++;
      callsInserted++;
      botMessagesProcessed++;

      // Validate in chunks
      chunkResults.push({
        botData,
        caller: {
          callerName,
          callerMessageText: callerMsg.text,
          alertTimestamp: alertTime,
          callerMessage: {
            messageId: String(callerMsg.messageId),
            text: callerMsg.text,
            timestamp: alertTime,
            from: callerName,
          },
        },
      });

      if (chunkResults.length >= (validated.chunkSize || 10)) {
        const chunkIndex = Math.floor((i + 1) / (validated.chunkSize || 10)) - 1;
        const isValid = await chunkValidator.validateChunk(chunkResults, chunkIndex);
        if (!isValid) {
          workflowCtx.logger.warn('Chunk validation failed', { chunkIndex });
        }
        chunkResults.length = 0; // Clear chunk
      }
    } catch (error) {
      messagesFailed++;
      workflowCtx.logger.error('Error processing bot message', {
        messageId: botMsg.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Validate final chunk if any remain
  if (chunkResults.length > 0) {
    const finalChunkIndex = Math.floor(botNormalizedMessages.length / (validated.chunkSize || 10));
    const isValid = await chunkValidator.validateChunk(chunkResults, finalChunkIndex);
    if (!isValid) {
      workflowCtx.logger.warn('Final chunk validation failed', { chunkIndex: finalChunkIndex });
    }
  }

  workflowCtx.logger.info('Telegram JSON ingestion complete', {
    totalProcessed: parseResult.totalProcessed,
    normalized: parseResult.normalized.length,
    quarantined: parseResult.quarantined.length,
    botMessagesFound: botNormalizedMessages.length,
    botMessagesProcessed,
    alertsInserted,
    callsInserted,
    tokensUpserted: tokensUpsertedSet.size,
    messagesFailed,
  });

  return {
    totalProcessed: parseResult.totalProcessed,
    normalized: parseResult.normalized.length,
    quarantined: parseResult.quarantined.length,
    botMessagesFound: botNormalizedMessages.length,
    botMessagesProcessed,
    alertsInserted,
    callsInserted,
    tokensUpserted: tokensUpsertedSet.size,
    messagesFailed,
  };
}
