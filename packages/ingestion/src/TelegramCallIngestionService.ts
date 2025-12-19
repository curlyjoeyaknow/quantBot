/**
 * TelegramCallIngestionService - Orchestrate full ingestion workflow
 *
 * Orchestrates:
 * 1. Parse HTML export(s)
 * 2. Build message index
 * 3. Find bot messages (Rick/Phanes)
 * 4. Extract bot data
 * 5. Resolve caller message
 * 6. Validate in chunks
 * 7. Store via repositories
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';
import {
  CallersRepository,
  TokenDataRepository,
} from '@quantbot/storage';
import { parseExport } from './TelegramExportParser';
import { MessageIndex } from './MessageIndex';
import { BotMessageExtractor } from './BotMessageExtractor';
import { CallerResolver } from './CallerResolver';
import { ChunkValidator, type ChunkValidationResult } from './ChunkValidator';
import * as path from 'path';

export interface IngestExportParams {
  filePath: string;
  callerName?: string; // Optional default caller name
  chain?: Chain; // Optional default chain
  chatId?: string;
  chunkSize?: number; // Default: 10
}

export interface IngestExportResult {
  alertsInserted: number;
  callsInserted: number;
  tokensUpserted: number;
  messagesFailed: number;
  botMessagesFound: number;
  botMessagesProcessed: number;
}

export class TelegramCallIngestionService {
  private botExtractor: BotMessageExtractor;
  private chunkValidator: ChunkValidator;

  constructor(
    private callersRepo: CallersRepository,
    private tokensRepo: TokensRepository,
    private alertsRepo: AlertsRepository,
    private callsRepo: CallsRepository
  ) {
    this.botExtractor = new BotMessageExtractor();
    this.chunkValidator = new ChunkValidator({ chunkSize: 10 });
  }

  /**
   * Ingest a Telegram export file
   */
  async ingestExport(params: IngestExportParams): Promise<IngestExportResult> {
    logger.info('Starting Telegram call ingestion', {
      filePath: params.filePath,
      callerName: params.callerName,
      chain: params.chain,
    });

    // 1. Parse HTML export
    const messages = parseExport(params.filePath);
    logger.info('Parsed messages', { count: messages.length });

    // 2. Build message index
    const messageIndex = new MessageIndex();
    const fileName = path.basename(params.filePath);
    messageIndex.addMessages(fileName, messages);
    logger.info('Built message index', { messageCount: messageIndex.getMessageCount() });

    // 3. Find bot messages (Rick/Phanes)
    const botMessages = messages.filter((msg) => this.isBot(msg.from));
    logger.info('Found bot messages', { count: botMessages.length });

    // 4-6. Process bot messages: extract, resolve, validate, store
    const callerResolver = new CallerResolver(messageIndex);
    let alertsInserted = 0;
    let callsInserted = 0;
    let messagesFailed = 0;
    let botMessagesProcessed = 0;
    const tokensUpsertedSet = new Set<string>();
    const chunkResults: ChunkValidationResult[] = [];

    for (let i = 0; i < botMessages.length; i++) {
      const botMessage = botMessages[i];

      try {
        // 4. Extract bot data
        const botData = this.botExtractor.extract(botMessage.text);

        if (!botData.contractAddress) {
          logger.debug('Skipping bot message - no contract address', {
            messageId: botMessage.messageId,
          });
          continue;
        }

        // 5. Resolve caller message
        const resolvedCaller = callerResolver.resolveCaller(botMessage, fileName);

        if (!resolvedCaller) {
          logger.debug('Skipping bot message - caller not found', {
            messageId: botMessage.messageId,
            replyTo: botMessage.replyToMessageId,
          });
          continue;
        }

        // Add to chunk for validation
        chunkResults.push({
          botData,
          caller: resolvedCaller,
        });

        // Process chunk when it reaches chunk size
        if (chunkResults.length >= (params.chunkSize || 10)) {
          await this.chunkValidator.validateChunk(
            chunkResults,
            Math.floor(botMessagesProcessed / (params.chunkSize || 10))
          );

          // Store chunk
          for (const result of chunkResults) {
            await this.storeCall(result, params);
            alertsInserted++;
            callsInserted++;
            tokensUpsertedSet.add(result.botData.contractAddress);
            botMessagesProcessed++;
          }

          chunkResults.length = 0; // Clear chunk
        }
      } catch (error) {
        messagesFailed++;
        logger.error('Error processing bot message', error as Error, {
          messageId: botMessage.messageId,
        });
      }
    }

    // Process remaining chunk
    if (chunkResults.length > 0) {
      await this.chunkValidator.validateChunk(
        chunkResults,
        Math.floor(botMessagesProcessed / (params.chunkSize || 10))
      );

      for (const result of chunkResults) {
        try {
          await this.storeCall(result, params);
          alertsInserted++;
          callsInserted++;
          tokensUpsertedSet.add(result.botData.contractAddress);
          botMessagesProcessed++;
        } catch (error) {
          messagesFailed++;
          logger.error('Error storing call', error as Error);
        }
      }
    }

    const result: IngestExportResult = {
      alertsInserted,
      callsInserted,
      tokensUpserted: tokensUpsertedSet.size,
      messagesFailed,
      botMessagesFound: botMessages.length,
      botMessagesProcessed,
    };

    logger.info('Completed Telegram call ingestion', result as unknown as Record<string, unknown>);
    return result;
  }

  /**
   * Store a single call (alert + call record)
   */
  private async storeCall(
    result: ChunkValidationResult,
    params: IngestExportParams
  ): Promise<void> {
    const { botData, caller } = result;

    // Get or create caller
    const callerName = caller.callerName || params.callerName || 'Unknown';
    const chain = botData.chain || params.chain || 'solana';

    // NOTE: Multi-chain metadata fetching removed - ingestion is offline-only.
    // Use metadata from bot data only.
    const actualMetadata: { name?: string; symbol?: string } | null = {
      name: botData.tokenName,
      symbol: botData.ticker,
    };

    const callerRecord = await this.callersRepo.getOrCreateCaller(
      chain.toLowerCase(),
      callerName,
      callerName
    );

    // Get or create token with metadata from multi-chain fetch or bot data
    const token = await this.tokensRepo.getOrCreateToken(
      chain,
      createTokenAddress(botData.contractAddress),
      {
        name: actualMetadata?.name || botData.tokenName,
        symbol: actualMetadata?.symbol || botData.ticker,
      }
    );

    // Check for existing alert (idempotency)
    const existingAlert =
      params.chatId && caller.callerMessage.messageId
        ? await this.alertsRepo.findByChatAndMessage(params.chatId, caller.callerMessage.messageId)
        : null;

    let alertId: number;
    if (existingAlert) {
      // Idempotency: alert already exists, return existing ID
      logger.debug('Alert already exists, skipping insert', {
        alertId: existingAlert.id,
        chatId: params.chatId,
        messageId: caller.callerMessage.messageId,
      });
      alertId = existingAlert.id;
    } else {
      // Insert new alert
      alertId = await this.alertsRepo.insertAlert({
        tokenId: token.id,
        callerId: callerRecord.id,
        side: 'buy',
        alertTimestamp: caller.alertTimestamp,
        alertPrice: botData.price,
        initialMcap: botData.marketCap,
        initialPrice: botData.price,
        chatId: params.chatId,
        messageId: caller.callerMessage.messageId,
        messageText: caller.callerMessageText,
        rawPayload: {
          botData,
          callerData: {
            name: caller.callerName,
            messageText: caller.callerMessageText,
            messageId: caller.callerMessage.messageId,
          },
        },
      });
    }

    // Insert call
    await this.callsRepo.insertCall({
      alertId,
      tokenId: token.id,
      callerId: callerRecord.id,
      side: 'buy',
      signalType: 'entry',
      signalTimestamp: DateTime.fromJSDate(caller.alertTimestamp).toJSDate(),
      metadata: {
        priceAtAlert: botData.price,
        marketCapAtAlert: botData.marketCap,
        liquidityAtAlert: botData.liquidity,
        volumeAtAlert: botData.volume,
        tokenAge: botData.tokenAge,
        priceChange1h: botData.priceChange1h,
        buyers1h: botData.buyers1h,
        sellers1h: botData.sellers1h,
        totalHolders: botData.totalHolders,
        freshWallets1d: botData.freshWallets1d,
        freshWallets7d: botData.freshWallets7d,
      },
    });
  }

  /**
   * Check if a sender is a bot (Rick or Phanes)
   */
  private isBot(sender: string | undefined): boolean {
    if (!sender) return false;
    const cleanSender = sender.trim().toLowerCase();
    return cleanSender === 'rick' || cleanSender === 'phanes';
  }
}
