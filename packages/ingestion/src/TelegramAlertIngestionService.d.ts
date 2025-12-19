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
import type { Chain } from '@quantbot/core';
import { CallersRepository, TokensRepository, AlertsRepository, CallsRepository } from '@quantbot/storage';
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
export declare class TelegramAlertIngestionService {
    private callersRepo;
    private tokensRepo;
    private alertsRepo;
    private callsRepo;
    constructor(callersRepo: CallersRepository, tokensRepo: TokensRepository, alertsRepo: AlertsRepository, callsRepo: CallsRepository);
    /**
     * Ingest a Telegram export file
     */
    ingestExport(params: IngestExportParams): Promise<IngestExportResult>;
}
//# sourceMappingURL=TelegramAlertIngestionService.d.ts.map