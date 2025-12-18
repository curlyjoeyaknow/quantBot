/**
 * TelegramAlertIngestionService - Ingest Telegram exports into Postgres
 *
 * SIMPLE APPROACH:
 * 1. Find bot responses (formatted token info)
 * 2. Find the message just prior (the caller who dropped the ticker/CA)
 * 3. Extract from bot response: CA address, ticker, name, market cap, price
 * 4. Use caller name from prior message, alert time from prior message
 *
 * Bot responses are already perfectly formatted with all the data we need.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { parseExport, type ParsedMessage } from './TelegramExportParser';
import { extractSolanaAddresses } from './extractSolanaAddresses';
import { PublicKey } from '@solana/web3.js';
import { getBirdeyeClient } from '@quantbot/api-clients';
import { extractAddresses, isEvmAddress, isSolanaAddress } from './addressValidation';
import { fetchMultiChainMetadata } from './MultiChainMetadataService';

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
  messagesFailed: number;
}

/**
 * Check if a sender is a bot (common bot name patterns)
 * Bot names are: Rick and Phanes
 */
function isBot(sender: string | undefined): boolean {
  if (!sender) return false;
  // Clean the sender name (remove extra whitespace, trim)
  const cleanSender = sender.trim();

  // Exact matches for known bots
  if (/^rick$/i.test(cleanSender)) return true;
  if (/^phanes$/i.test(cleanSender)) return true;

  // Also check if it contains bot names (in case of extra characters)
  if (/rick/i.test(cleanSender) && cleanSender.length < 20) return true;
  if (/phanes/i.test(cleanSender) && cleanSender.length < 20) return true;

  return false;
}

/**
 * Detect chain from bot response text or address format
 */
function detectChain(botText: string, address?: string): Chain {
  // Check for explicit chain mentions in bot text
  const chainText = botText.toLowerCase();
  if (chainText.includes('base') || chainText.includes('base chain')) {
    return 'base';
  }
  if (chainText.includes('ethereum') || chainText.includes('eth')) {
    return 'ethereum';
  }
  if (chainText.includes('bsc') || chainText.includes('binance')) {
    return 'bsc';
  }
  if (chainText.includes('solana') || chainText.includes('sol')) {
    return 'solana';
  }

  // Detect from address format
  if (address) {
    if (address.startsWith('0x') && address.length === 42) {
      // EVM address - try to determine which chain
      // Default to base for now, but could be enhanced with more context
      return 'base';
    }
    // Solana addresses are base58, 32-44 chars
    try {
      new PublicKey(address);
      return 'solana';
    } catch {
      // Not a valid Solana address
    }
  }

  // Default to solana
  return 'solana';
}

/**
 * Extract formatted data from bot response message
 * Bot responses contain: CA address, ticker, name, market cap, price, chain
 */
function extractFromBotResponse(botText: string): {
  caAddress?: string;
  chain?: Chain;
  ticker?: string;
  name?: string;
  marketCap?: number;
  price?: number;
} {
  const result: {
    caAddress?: string;
    chain?: Chain;
    ticker?: string;
    name?: string;
    marketCap?: number;
    price?: number;
  } = {};

  // Extract CA address using new validation module
  const extracted = extractAddresses(botText);

  // Prefer Solana addresses first (most common in our use case)
  if (extracted.solana.length > 0) {
    result.caAddress = extracted.solana[0]; // Use first valid address
    // Detect chain from address format or bot text
    result.chain = detectChain(botText, extracted.solana[0]);
  } else if (extracted.evm.length > 0) {
    // EVM address found
    result.caAddress = extracted.evm[0];
    result.chain = detectChain(botText, extracted.evm[0]);
  }

  // Extract ticker/symbol: $SYMBOL or (SYMBOL)
  const tickerMatch1 = botText.match(/\$([A-Z0-9]{2,15})\b/);
  const tickerMatch2 = botText.match(/\(([A-Z0-9]{2,15})\)/);
  if (tickerMatch1) {
    result.ticker = tickerMatch1[1];
  } else if (tickerMatch2) {
    result.ticker = tickerMatch2[1];
  }

  // Extract name: Token: NAME or 🟣 NAME or NAME ($SYMBOL)
  const nameMatch1 = botText.match(/Token:\s*([^($[]+?)(?:\s*\(|\s*\$|\s*⋅|$)/i);
  const nameMatch2 = botText.match(
    /(?:🟣|🐶|🟢|🔷|🪙|💊)\s*([A-Z][a-zA-Z0-9\s-.']+?)(?:\s*\(|\s*\[|\s*\$)/
  );
  const nameMatch3 = botText.match(/^([A-Z][a-zA-Z0-9\s-.']+?)\s*\(/);
  const nameMatch4 = botText.match(/^([A-Z][a-zA-Z0-9\s-.']+?)\s*-\s*\$[A-Z0-9]/);

  let candidateName: string | undefined;
  if (nameMatch1 && nameMatch1[1].trim().length > 2) {
    candidateName = nameMatch1[1].trim();
  } else if (nameMatch3 && nameMatch3[1].trim().length > 2) {
    candidateName = nameMatch3[1].trim();
  } else if (nameMatch4 && nameMatch4[1].trim().length > 2) {
    candidateName = nameMatch4[1].trim();
  } else if (nameMatch2 && nameMatch2[1].trim().length > 2) {
    candidateName = nameMatch2[1].trim();
  }

  if (candidateName) {
    candidateName = candidateName
      .replace(/^Token:\s*/i, '')
      .replace(/\s*\(.*$/, '')
      .replace(/\s*\[.*$/, '')
      .replace(/\s*\$.*$/, '')
      .replace(/\s*⋅.*$/, '')
      .trim();

    // Validate name (not too short, not all caps short, not status text)
    const invalidPatterns = [/DEX Paid/i, /🅳/, /└/, /🟢/, /status/i, /paid/i, /verified/i];
    const isInvalid =
      invalidPatterns.some((p) => p.test(candidateName!)) ||
      (candidateName.length <= 3 && candidateName === candidateName.toUpperCase()) ||
      candidateName.length < 2;

    if (!isInvalid) {
      result.name = candidateName;
    }
  }

  // Extract price: $PRICE or Price: PRICE
  const priceMatch1 = botText.match(/\$\s*([0-9,]+\.?[0-9]*)/);
  const priceMatch2 = botText.match(/Price[:\s]+([0-9,]+\.?[0-9]*)/i);
  if (priceMatch1) {
    const priceStr = priceMatch1[1].replace(/,/g, '');
    const price = parseFloat(priceStr);
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  } else if (priceMatch2) {
    const priceStr = priceMatch2[1].replace(/,/g, '');
    const price = parseFloat(priceStr);
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  }

  // Extract market cap: MC: VALUE or Market Cap: VALUE or $VALUE MC
  const mcapMatch1 = botText.match(/MC[:\s]+([0-9,]+\.?[0-9]*)\s*(K|M|B)?/i);
  const mcapMatch2 = botText.match(/Market Cap[:\s]+([0-9,]+\.?[0-9]*)\s*(K|M|B)?/i);
  const mcapMatch3 = botText.match(/\$([0-9,]+\.?[0-9]*)\s*(K|M|B)?\s*MC/i);

  let mcapValue: number | undefined;
  let mcapMultiplier = 1;

  if (mcapMatch1 || mcapMatch2 || mcapMatch3) {
    const match = mcapMatch1 || mcapMatch2 || mcapMatch3;
    const valueStr = match![1].replace(/,/g, '');
    const value = parseFloat(valueStr);
    const unit = match![2]?.toUpperCase();

    if (!isNaN(value) && value > 0) {
      if (unit === 'K') mcapMultiplier = 1000;
      else if (unit === 'M') mcapMultiplier = 1000000;
      else if (unit === 'B') mcapMultiplier = 1000000000;

      mcapValue = value * mcapMultiplier;
      result.marketCap = mcapValue;
    }
  }

  return result;
}

/**
 * Validate that an address is actually a valid token contract using Birdeye API
 * Returns true if valid, false if invalid, null if validation failed
 */
async function validateContractAddress(address: string, chain: Chain): Promise<boolean | null> {
  try {
    const birdeyeClient = getBirdeyeClient();
    const metadata = await birdeyeClient.getTokenMetadata(address, chain);

    // If we get metadata back, it's a valid token contract
    // If we get null, it might not exist or might not be a token
    return metadata !== null;
  } catch (error) {
    logger.warn('Failed to validate contract address', {
      error: error instanceof Error ? error.message : String(error),
      address: address.substring(0, 20),
      chain,
    });
    return null; // Validation failed, but don't reject the address
  }
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
    let messagesFailed = 0;
    const tokensUpsertedSet = new Set<string>();
    let validationCount = 0;
    const VALIDATION_SAMPLE_SIZE = 10; // Validate first 10 addresses as sanity check

    // 3. Process messages: Find bot responses, then get the prior caller message
    logger.info('Processing messages', { totalMessages: messages.length });
    let botMessageCount = 0;
    let processedBotMessages = 0;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      try {
        // Check if this is a bot message
        if (!isBot(message.from)) {
          continue; // Skip non-bot messages
        }

        botMessageCount++;
        if (botMessageCount <= 5 || processedBotMessages < 10) {
          logger.debug('Found bot message', {
            index: i,
            from: message.from,
            textPreview: message.text.substring(0, 150),
          });
        }

        // Find the message just prior (the caller)
        let callerMessage: ParsedMessage | null = null;
        for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
          // Look back up to 5 messages to find the caller
          if (!isBot(messages[j].from)) {
            callerMessage = messages[j];
            break;
          }
        }

        if (!callerMessage) {
          continue; // No caller message found before this bot response
        }

        // Extract formatted data from bot response
        const botData = extractFromBotResponse(message.text);

        if (processedBotMessages < 10) {
          logger.debug('Extracted bot data', {
            hasAddress: !!botData.caAddress,
            address: botData.caAddress?.substring(0, 20),
            chain: botData.chain,
            ticker: botData.ticker,
            name: botData.name,
            price: botData.price,
            marketCap: botData.marketCap,
          });
        }

        // Must have CA address to proceed
        if (!botData.caAddress) {
          if (processedBotMessages < 10) {
            logger.debug('Skipping bot message - no CA address found', {
              from: message.from,
              textPreview: message.text.substring(0, 200),
            });
          }
          continue; // Bot response doesn't contain a valid CA address
        }

        // Use chain from bot response, fallback to params.chain
        let detectedChain = botData.chain || params.chain;
        let actualMetadata: { name?: string; symbol?: string } | null = null;

        // Sanity check: Validate first N addresses with multi-chain metadata fetching
        let isValidContract = true;
        if (validationCount < VALIDATION_SAMPLE_SIZE) {
          validationCount++;
          logger.info(
            `Validating contract address with multi-chain fallback (${validationCount}/${VALIDATION_SAMPLE_SIZE})`,
            {
              address: botData.caAddress.substring(0, 20),
              chainHint: detectedChain,
            }
          );

          // Use multi-chain metadata fetching as definitive fallback
          const multiChainResult = await fetchMultiChainMetadata(botData.caAddress, detectedChain);

          if (multiChainResult.primaryMetadata) {
            // Found metadata on one of the chains
            detectedChain = multiChainResult.primaryMetadata.chain;
            actualMetadata = {
              name: multiChainResult.primaryMetadata.name,
              symbol: multiChainResult.primaryMetadata.symbol,
            };
            logger.info('Multi-chain validation successful', {
              address: botData.caAddress.substring(0, 20),
              chain: detectedChain,
              symbol: actualMetadata.symbol,
              name: actualMetadata.name,
              addressKind: multiChainResult.addressKind,
            });
          } else {
            // No metadata found on any chain
            logger.warn('Invalid contract address detected - not found on any chain', {
              address: botData.caAddress.substring(0, 20),
              chainHint: detectedChain,
              addressKind: multiChainResult.addressKind,
              chainsAttempted: multiChainResult.metadata.map((m) => m.chain),
              caller: callerMessage.from,
            });
            isValidContract = false;
          }
        }

        if (!isValidContract) {
          continue; // Skip invalid contracts
        }

        // Use caller name from prior message
        const callerName = callerMessage.from || params.callerName;

        // 4. Upsert token with metadata from bot response or multi-chain fetch
        // Prefer actual metadata from Birdeye over bot-extracted metadata
        const token = await this.tokensRepo.getOrCreateToken(
          detectedChain,
          createTokenAddress(botData.caAddress),
          {
            name: actualMetadata?.name || botData.name,
            symbol: actualMetadata?.symbol || botData.ticker,
          }
        );
        tokensUpsertedSet.add(botData.caAddress);

        // 5. Insert alert using caller message timestamp (alert time)
        const chatIdToUse = params.chatId || callerMessage.chatId || message.chatId || undefined;
        const alertId = await this.alertsRepo.insertAlert({
          tokenId: token.id,
          callerId: caller.id,
          side: 'buy',
          alertTimestamp: DateTime.fromJSDate(callerMessage.timestamp).toJSDate(),
          alertPrice: botData.price,
          chatId: chatIdToUse,
          messageId: callerMessage.messageId,
          messageText: callerMessage.text,
          rawPayload: {
            from: callerMessage.from,
            botResponse: message.text,
            extractedData: botData,
          },
        });
        alertsInserted++;

        // 6. Insert call linking alert → token
        await this.callsRepo.insertCall({
          alertId,
          tokenId: token.id,
          callerId: caller.id,
          side: 'buy',
          signalType: 'entry',
          signalTimestamp: DateTime.fromJSDate(callerMessage.timestamp).toJSDate(),
          metadata: {
            messageId: callerMessage.messageId,
            botMessageId: message.messageId,
            chatId: chatIdToUse,
            priceAtAlert: botData.price,
            marketCapAtAlert: botData.marketCap,
          },
        });
        callsInserted++;

        processedBotMessages++;

        if (processedBotMessages <= 10) {
          logger.info('✅ Extracted alert from bot response', {
            caller: callerName,
            token: botData.caAddress.substring(0, 20),
            chain: detectedChain,
            ticker: botData.ticker,
            name: botData.name,
            price: botData.price,
            marketCap: botData.marketCap,
            alertTime: callerMessage.timestamp.toISOString(),
          });
        } else {
          logger.debug('Extracted alert from bot response', {
            caller: callerName,
            token: botData.caAddress.substring(0, 20),
            ticker: botData.ticker,
            name: botData.name,
          });
        }
      } catch (error) {
        messagesFailed++;
        logger.error('Error processing bot message', error as Error, {
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
      messagesFailed,
    };

    logger.info('Completed Telegram export ingestion', {
      ...result,
      botMessagesFound: botMessageCount,
      botMessagesProcessed: processedBotMessages,
      validationSampleSize: Math.min(validationCount, VALIDATION_SAMPLE_SIZE),
    });
    return result;
  }
}
