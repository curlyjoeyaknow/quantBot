/**
 * Brook Call Ingestion Module
 * ===========================
 * Ingests forwarded calls from Brook's channel, extracts token addresses,
 * stores them in the database, and adds them to live monitoring services.
 *
 * This module listens for forwarded messages in your personal Telegram chat
 * and automatically processes them.
 */
import { LiveTradeAlertService } from './live-trade-alert-service';
import { TenkanKijunAlertService } from './tenkan-kijun-alert-service';
/**
 * Brook Call Ingestion Service
 *
 * Listens to your personal Telegram chat for manually forwarded messages from Brook's channel.
 * Since Brook's channel is invite-only, you must manually forward messages to your personal chat.
 */
export declare class BrookCallIngestion {
    private bot;
    private callerDb;
    private liveTradeService;
    private tenkanKijunService;
    private processedMessageIds;
    private personalChatId;
    constructor(botToken: string, personalChatId: string, liveTradeService?: LiveTradeAlertService, tenkanKijunService?: TenkanKijunAlertService);
    /**
     * Check if message is from personal chat
     */
    private isFromPersonalChat;
    /**
     * Check if message is forwarded from Brook's channel
     */
    private isForwardedFromBrook;
    /**
     * Setup Telegram message handlers
     */
    private setupHandlers;
    /**
     * Handle any message (forwarded or regular)
     */
    private handleMessage;
    /**
     * Process a single token address
     */
    private processTokenAddress;
    /**
     * Start the ingestion service
     */
    start(): Promise<void>;
    /**
     * Stop the ingestion service
     */
    stop(): void;
}
export default BrookCallIngestion;
//# sourceMappingURL=brook-call-ingestion.d.ts.map