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
import type { Chain } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';
import { ValidationError, AppError } from '@quantbot/utils';
import type { WorkflowContext } from '../types.js';
import {
  parseJsonExport,
  type ParseJsonExportResult,
  normalizedToParsedBatch,
  BotMessageExtractor,
  ChunkValidator,
  type ExtractedBotData,
  type ResolvedCaller,
} from '@quantbot/ingestion';
import { isEvmAddress } from '@quantbot/utils';
import { fetchMultiChainMetadata } from '@quantbot/api-clients';
import type {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import {} from '@quantbot/storage';

const IngestSpecSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
  chatId: z.string().optional(),
  callerName: z.string().optional(),
  chain: z.enum(['solana', 'ethereum', 'base', 'bsc']).optional(),
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

export type TelegramJsonIngestContext = WorkflowContext & {
  repos: WorkflowContext['repos'] & {
    callers: CallersRepository;
    tokens: TokensRepository;
    alerts: AlertsRepository;
    calls: CallsRepository;
  };
};

/**
 * Check if a sender name is a bot
 */

/**
 * Ingest Telegram JSON export with normalization
 */
export async function ingestTelegramJson(
  spec: TelegramJsonIngestSpec,
  ctx: TelegramJsonIngestContext
): Promise<TelegramJsonIngestResult> {
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

  ctx.logger.info('Starting Telegram JSON ingestion workflow', {
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
    ctx.logger.error('Failed to parse JSON export', error as Error);
    throw new AppError(
      `Failed to parse Telegram JSON export: ${error instanceof Error ? error.message : String(error)}`,
      'PARSE_ERROR',
      500,
      { filePath: validated.filePath, chatId: validated.chatId }
    );
  }

  ctx.logger.info('Normalization complete', {
    totalProcessed: parseResult.totalProcessed,
    normalized: parseResult.normalized.length,
    quarantined: parseResult.quarantined.length,
  });

  // 3. Write streams if requested (for debugging)
  let streamResult: { normalizedPath?: string; quarantinePath?: string } | undefined;
  if (validated.writeStreams) {
    const { ingestJsonExport } = await import('@quantbot/ingestion');
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
      ctx.logger.info('Streams written', streamResult);
    }
  }

  // 4. Convert normalized messages to ParsedMessage format
  const parsedMessages = normalizedToParsedBatch(parseResult.normalized);

  ctx.logger.info('Converted to ParsedMessage format', {
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
  ctx.logger.info('Found bot messages', { count: botNormalizedMessages.length });

  // 6. Process bot messages: extract, resolve caller, validate, store
  const botExtractor = new BotMessageExtractor();
  const chunkValidator = new ChunkValidator({
    chunkSize: validated.chunkSize || 10,
  });

  // Import TokenDataRepository dynamically
  const { TokenDataRepository } = await import('@quantbot/storage');
  const tokenDataRepo = new TokenDataRepository();

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
        ctx.logger.info('Skipping bot message - no contract address', {
          messageId: botMsg.messageId,
        });
        continue;
      }

      // Resolve caller message using replyToMessageId
      if (!botMsg.replyToMessageId) {
        ctx.logger.info('Skipping bot message - no reply_to', {
          messageId: botMsg.messageId,
        });
        continue;
      }

      const callerMsg = normalizedById.get(botMsg.replyToMessageId);
      if (!callerMsg) {
        ctx.logger.info('Skipping bot message - caller message not found', {
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
      if (isEvmAddress(botData.contractAddress)) {
        const metadataResult = await fetchMultiChainMetadata(
          botData.contractAddress,
          chain.toLowerCase() as Chain
        );
        if (metadataResult.primaryMetadata) {
          // Use actual chain from API response
          chain = metadataResult.primaryMetadata.chain;
          // Update botData with actual metadata if not already set
          if (!botData.tokenName && metadataResult.primaryMetadata.name) {
            botData.tokenName = metadataResult.primaryMetadata.name;
          }
          if (!botData.ticker && metadataResult.primaryMetadata.symbol) {
            botData.ticker = metadataResult.primaryMetadata.symbol;
          }
          ctx.logger.debug?.('Chain validated via multi-chain metadata', {
            address: botData.contractAddress.substring(0, 20),
            chainHint: botData.chain || validated.chain,
            actualChain: chain,
            symbol: metadataResult.primaryMetadata.symbol,
          });
        } else {
          ctx.logger.warn('No metadata found for EVM address on any chain', {
            address: botData.contractAddress.substring(0, 20),
            chainHint: chain,
          });
        }
      }

      // Resolve/create caller
      const caller = await ctx.repos.callers.getOrCreateCaller(
        chain.toLowerCase(),
        callerName,
        callerName
      );

      // Upsert token (fixed metadata) - store socials in metadata_json
      const tokenMetadata: Record<string, unknown> = {};
      if (botData.twitterLink) tokenMetadata.twitterLink = botData.twitterLink;
      if (botData.telegramLink) tokenMetadata.telegramLink = botData.telegramLink;
      if (botData.websiteLink) tokenMetadata.websiteLink = botData.websiteLink;

      const token = await ctx.repos.tokens.getOrCreateToken(
        chain.toLowerCase() as Chain,
        createTokenAddress(botData.contractAddress),
        {
          name: botData.tokenName,
          symbol: botData.ticker,
          ...tokenMetadata, // Store in metadata_json
        }
      );

      tokensUpsertedSet.add(botData.contractAddress);

      // Use caller timestamp for alert (when the user originally called the token)
      const alertTime = new Date(callerMsg.timestampMs);

      // The database will automatically determine first_caller by checking for earlier alerts
      // We pass undefined to let the database handle it

      // Create alert with all extracted data
      const alertId = await ctx.repos.alerts.insertAlert({
        callerId: caller.id,
        tokenId: token.id,
        side: 'buy',
        alertTimestamp: alertTime,
        chatId: botMsg.chatId || validated.chatId || 'unknown',
        messageId: String(callerMsg.messageId), // Use caller message ID, not bot message ID
        messageText: callerMsg.text, // Original caller message text
        initialMcap: botData.marketCap, // Market cap at alert time (from bot response)
        initialPrice: botData.price, // Price at alert time (from bot response)
        // firstCaller will be determined by database (checks for earlier alerts for this token)
        rawPayload: {
          price: botData.price,
          marketCap: botData.marketCap,
          liquidity: botData.liquidity,
          volume: botData.volume,
          ticker: botData.ticker,
          tokenName: botData.tokenName,
          originalMessageId: botData.originalMessageId,
          callerMessageText: callerMsg.text,
          botMessageId: String(botMsg.messageId), // Store bot message ID for reference
          botMessageTimestamp: botData.messageTimestamp,
        },
      });

      alertsInserted++;

      // Store dynamic token data
      await tokenDataRepo.upsertTokenData({
        tokenId: token.id,
        price: botData.price,
        marketCap: botData.marketCap,
        liquidity: botData.liquidity,
        liquidityMultiplier: botData.mcToLiquidityRatio,
        volume: botData.volume,
        volume1h: botData.volume1h,
        buyers1h: botData.buyers1h,
        sellers1h: botData.sellers1h,
        priceChange1h: botData.priceChange1h,
        topHoldersPercent: botData.thPercent,
        totalHolders: botData.totalHolders,
        supply: botData.supply,
        athMcap: botData.athMcap,
        tokenAge: botData.tokenAge,
        avgHolderAge: botData.avgHolderAge,
        freshWallets1d: botData.freshWallets1d,
        freshWallets7d: botData.freshWallets7d,
        exchange: botData.exchange,
        platform: botData.platform,
        twitterLink: botData.twitterLink,
        telegramLink: botData.telegramLink,
        websiteLink: botData.websiteLink,
        recordedAt: alertTime,
      });

      // Create call
      await ctx.repos.calls.insertCall({
        alertId,
        tokenId: token.id,
        callerId: caller.id,
        side: 'buy',
        signalType: 'entry',
        signalTimestamp: alertTime,
        metadata: {
          source: 'telegram',
          sourceMessageId: String(botMsg.messageId),
          originalMessageId: botData.originalMessageId,
        },
      });

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
          ctx.logger.warn('Chunk validation failed', { chunkIndex });
        }
        chunkResults.length = 0; // Clear chunk
      }
    } catch (error) {
      messagesFailed++;
      ctx.logger.error('Error processing bot message', {
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
      ctx.logger.warn('Final chunk validation failed', { chunkIndex: finalChunkIndex });
    }
  }

  ctx.logger.info('Telegram JSON ingestion complete', {
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
