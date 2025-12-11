/**
 * TelegramAlertIngestionService - Ingest Telegram exports into Postgres
 * 
 * Orchestrates the full pipeline:
 * 1. Parse Telegram export file
 * 2. Extract Solana addresses from messages
 * 3. Upsert tokens
 * 4. Insert alerts (idempotent on chatId+messageId)
 * 5. Insert calls linking alerts to tokens
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/data';
import { parseExport, type ParsedMessage } from './TelegramExportParser';
import { extractSolanaAddresses } from './extractSolanaAddresses';

export interface IngestExportParams {
  filePath: string;
  callerName: string;
  chain: Chain;
  chatId?: string;
}

export interface IngestExportResult {
  alertsInserted: number;
  callsInserted: number;
  tokensUpserted: number;
}

export class TelegramAlertIngestionService {
  constructor(
    private callersRepo: CallersRepository,
    private tokensRepo: TokensRepository,
    private alertsRepo: AlertsRepository,
    private callsRepo: CallsRepository
  ) {}

  /**
   * Ingest a Telegram export file
   */
  async ingestExport(params: IngestExportParams): Promise<IngestExportResult> {
    logger.info('Starting Telegram export ingestion', {
      filePath: params.filePath,
      callerName: params.callerName,
      chain: params.chain,
    });

    // 1. Parse export file
    const messages = parseExport(params.filePath);
    logger.info('Parsed messages', { count: messages.length });

    // 2. Resolve/create caller
    const caller = await this.callersRepo.getOrCreateCaller(
      params.chain.toLowerCase(), // source
      params.callerName, // handle
      params.callerName // displayName
    );
    logger.info('Resolved caller', { id: caller.id, name: params.callerName });

    let alertsInserted = 0;
    let callsInserted = 0;
    const tokensUpsertedSet = new Set<string>();

    // 3. Process each message
    for (const message of messages) {
      try {
        // Extract Solana addresses (full addresses, case-preserved)
        const addresses = extractSolanaAddresses(message.text);

        if (addresses.length === 0) {
          continue; // Skip messages without addresses
        }

        // 4. Upsert tokens
        const tokenIds: number[] = [];
        for (const address of addresses) {
          // CRITICAL: Pass full address, case-preserved
          const token = await this.tokensRepo.getOrCreateToken(params.chain, address, {
            // Metadata can be enriched later
          });
          tokenIds.push(token.id);
          tokensUpsertedSet.add(address); // Track unique tokens
        }

        // 5. Insert alert (idempotent on chatId+messageId)
        const chatIdToUse = params.chatId || message.chatId || undefined;
        const alertId = await this.alertsRepo.insertAlert({
          tokenId: tokenIds[0], // Use first token as primary
          callerId: caller.id,
          side: 'buy', // Default to buy for now
          alertTimestamp: message.timestamp,
          chatId: chatIdToUse,
          messageId: message.messageId,
          messageText: message.text,
          rawPayload: {
            from: message.from,
            replyTo: message.replyTo,
            text: message.text,
          },
        });
        alertsInserted++;

        // 6. Insert call(s) linking alert → token(s)
        for (const tokenId of tokenIds) {
          await this.callsRepo.insertCall({
            alertId,
            tokenId,
            callerId: caller.id,
            side: 'buy',
            signalType: 'entry',
            signalTimestamp: message.timestamp,
            metadata: {
              messageId: message.messageId,
              chatId: chatIdToUse,
            },
          });
          callsInserted++;
        }
      } catch (error) {
        logger.error('Error processing message', error as Error, {
          messageId: message.messageId,
          text: message.text.substring(0, 100),
        });
        // Continue processing other messages
      }
    }

    const result: IngestExportResult = {
      alertsInserted,
      callsInserted,
      tokensUpserted: tokensUpsertedSet.size,
    };

    logger.info('Completed Telegram export ingestion', result);
    return result;
  }
}

