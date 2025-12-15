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
 */
export declare class BrookCallIngestion {
  private bot;
  private callerDb;
  private liveTradeService;
  private tenkanKijunService;
  private processedMessageIds;
  private brookChannelId;
  private personalChatId;
  constructor(
    botToken: string,
    brookChannelId: string,
    personalChatId?: string,
    liveTradeService?: LiveTradeAlertService,
    tenkanKijunService?: TenkanKijunAlertService
  );
  /**
   * Check if message is from Brook's channel
   */
  private isFromBrookChannel;
  /**
   * Check if message is from personal chat (for manual forwarding)
   */
  private isFromPersonalChat;
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
