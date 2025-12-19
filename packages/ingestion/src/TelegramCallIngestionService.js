"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramCallIngestionService = void 0;
const luxon_1 = require("luxon");
const utils_1 = require("@quantbot/utils");
const core_1 = require("@quantbot/core");
const TelegramExportParser_1 = require("./TelegramExportParser");
const MessageIndex_1 = require("./MessageIndex");
const BotMessageExtractor_1 = require("./BotMessageExtractor");
const CallerResolver_1 = require("./CallerResolver");
const ChunkValidator_1 = require("./ChunkValidator");
const MultiChainMetadataService_1 = require("./MultiChainMetadataService");
const path = __importStar(require("path"));
class TelegramCallIngestionService {
    callersRepo;
    tokensRepo;
    alertsRepo;
    callsRepo;
    botExtractor;
    chunkValidator;
    constructor(callersRepo, tokensRepo, alertsRepo, callsRepo) {
        this.callersRepo = callersRepo;
        this.tokensRepo = tokensRepo;
        this.alertsRepo = alertsRepo;
        this.callsRepo = callsRepo;
        this.botExtractor = new BotMessageExtractor_1.BotMessageExtractor();
        this.chunkValidator = new ChunkValidator_1.ChunkValidator({ chunkSize: 10 });
    }
    /**
     * Ingest a Telegram export file
     */
    async ingestExport(params) {
        utils_1.logger.info('Starting Telegram call ingestion', {
            filePath: params.filePath,
            callerName: params.callerName,
            chain: params.chain,
        });
        // 1. Parse HTML export
        const messages = (0, TelegramExportParser_1.parseExport)(params.filePath);
        utils_1.logger.info('Parsed messages', { count: messages.length });
        // 2. Build message index
        const messageIndex = new MessageIndex_1.MessageIndex();
        const fileName = path.basename(params.filePath);
        messageIndex.addMessages(fileName, messages);
        utils_1.logger.info('Built message index', { messageCount: messageIndex.getMessageCount() });
        // 3. Find bot messages (Rick/Phanes)
        const botMessages = messages.filter((msg) => this.isBot(msg.from));
        utils_1.logger.info('Found bot messages', { count: botMessages.length });
        // 4-6. Process bot messages: extract, resolve, validate, store
        const callerResolver = new CallerResolver_1.CallerResolver(messageIndex);
        let alertsInserted = 0;
        let callsInserted = 0;
        let messagesFailed = 0;
        let botMessagesProcessed = 0;
        const tokensUpsertedSet = new Set();
        const chunkResults = [];
        for (let i = 0; i < botMessages.length; i++) {
            const botMessage = botMessages[i];
            try {
                // 4. Extract bot data
                const botData = this.botExtractor.extract(botMessage.text);
                if (!botData.contractAddress) {
                    utils_1.logger.debug('Skipping bot message - no contract address', {
                        messageId: botMessage.messageId,
                    });
                    continue;
                }
                // 5. Resolve caller message
                const resolvedCaller = callerResolver.resolveCaller(botMessage, fileName);
                if (!resolvedCaller) {
                    utils_1.logger.debug('Skipping bot message - caller not found', {
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
                    await this.chunkValidator.validateChunk(chunkResults, Math.floor(botMessagesProcessed / (params.chunkSize || 10)));
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
            }
            catch (error) {
                messagesFailed++;
                utils_1.logger.error('Error processing bot message', error, {
                    messageId: botMessage.messageId,
                });
            }
        }
        // Process remaining chunk
        if (chunkResults.length > 0) {
            await this.chunkValidator.validateChunk(chunkResults, Math.floor(botMessagesProcessed / (params.chunkSize || 10)));
            for (const result of chunkResults) {
                try {
                    await this.storeCall(result, params);
                    alertsInserted++;
                    callsInserted++;
                    tokensUpsertedSet.add(result.botData.contractAddress);
                    botMessagesProcessed++;
                }
                catch (error) {
                    messagesFailed++;
                    utils_1.logger.error('Error storing call', error);
                }
            }
        }
        const result = {
            alertsInserted,
            callsInserted,
            tokensUpserted: tokensUpsertedSet.size,
            messagesFailed,
            botMessagesFound: botMessages.length,
            botMessagesProcessed,
        };
        utils_1.logger.info('Completed Telegram call ingestion', result);
        return result;
    }
    /**
     * Store a single call (alert + call record)
     */
    async storeCall(result, params) {
        const { botData, caller } = result;
        // Get or create caller
        const callerName = caller.callerName || params.callerName || 'Unknown';
        let chain = botData.chain || params.chain || 'solana';
        // Fetch multi-chain metadata to validate address and get actual chain
        let actualMetadata = null;
        try {
            const multiChainResult = await (0, MultiChainMetadataService_1.fetchMultiChainMetadata)(botData.contractAddress, chain);
            if (multiChainResult.primaryMetadata) {
                // Found metadata on one of the chains - use the actual chain
                chain = multiChainResult.primaryMetadata.chain;
                actualMetadata = {
                    name: multiChainResult.primaryMetadata.name,
                    symbol: multiChainResult.primaryMetadata.symbol,
                };
                utils_1.logger.debug('Multi-chain metadata found', {
                    address: botData.contractAddress.substring(0, 20),
                    chain,
                    symbol: actualMetadata.symbol,
                });
            }
            else {
                utils_1.logger.warn('Address not found on any chain', {
                    address: botData.contractAddress.substring(0, 20),
                    chainHint: chain,
                    addressKind: multiChainResult.addressKind,
                });
                // Continue anyway - might be a new token or API issue
            }
        }
        catch (error) {
            utils_1.logger.warn('Failed to fetch multi-chain metadata', {
                error: error instanceof Error ? error.message : String(error),
                address: botData.contractAddress.substring(0, 20),
            });
            // Continue with original chain - don't fail the ingestion
        }
        const callerRecord = await this.callersRepo.getOrCreateCaller(chain.toLowerCase(), callerName, callerName);
        // Get or create token with metadata from multi-chain fetch or bot data
        const token = await this.tokensRepo.getOrCreateToken(chain, (0, core_1.createTokenAddress)(botData.contractAddress), {
            name: actualMetadata?.name || botData.tokenName,
            symbol: actualMetadata?.symbol || botData.ticker,
        });
        // Check for existing alert (idempotency)
        const existingAlert = params.chatId && caller.callerMessage.messageId
            ? await this.alertsRepo.findByChatAndMessage(params.chatId, caller.callerMessage.messageId)
            : null;
        let alertId;
        if (existingAlert) {
            // Idempotency: alert already exists, return existing ID
            utils_1.logger.debug('Alert already exists, skipping insert', {
                alertId: existingAlert.id,
                chatId: params.chatId,
                messageId: caller.callerMessage.messageId,
            });
            alertId = existingAlert.id;
        }
        else {
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
            signalTimestamp: luxon_1.DateTime.fromJSDate(caller.alertTimestamp).toJSDate(),
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
    isBot(sender) {
        if (!sender)
            return false;
        const cleanSender = sender.trim().toLowerCase();
        return cleanSender === 'rick' || cleanSender === 'phanes';
    }
}
exports.TelegramCallIngestionService = TelegramCallIngestionService;
//# sourceMappingURL=TelegramCallIngestionService.js.map