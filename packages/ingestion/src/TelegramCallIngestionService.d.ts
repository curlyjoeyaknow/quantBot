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
import type { Chain } from '@quantbot/core';
import { CallersRepository, TokensRepository, AlertsRepository, CallsRepository } from '@quantbot/storage';
export interface IngestExportParams {
    filePath: string;
    callerName?: string;
    chain?: Chain;
    chatId?: string;
    chunkSize?: number;
}
export interface IngestExportResult {
    alertsInserted: number;
    callsInserted: number;
    tokensUpserted: number;
    messagesFailed: number;
    botMessagesFound: number;
    botMessagesProcessed: number;
}
export declare class TelegramCallIngestionService {
    private callersRepo;
    private tokensRepo;
    private alertsRepo;
    private callsRepo;
    private botExtractor;
    private chunkValidator;
    constructor(callersRepo: CallersRepository, tokensRepo: TokensRepository, alertsRepo: AlertsRepository, callsRepo: CallsRepository);
    /**
     * Ingest a Telegram export file
     */
    ingestExport(params: IngestExportParams): Promise<IngestExportResult>;
    /**
     * Store a single call (alert + call record)
     */
    private storeCall;
    /**
     * Check if a sender is a bot (Rick or Phanes)
     */
    private isBot;
}
//# sourceMappingURL=TelegramCallIngestionService.d.ts.map