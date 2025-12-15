/**
 * CurlyJoe Call Ingestion Module
 * ===============================
 * Automatically ingests calls from CurlyJoe channel and adds them to watchlist
 * with live monitoring enabled.
 */
import { LiveTradeAlertService } from './live-trade-alert-service';
/**
 * CurlyJoe Call Ingestion Service
 */
export declare class CurlyJoeCallIngestion {
  private bot;
  private callerDb;
  private liveTradeService;
  private processedMessageIds;
  private curlyjoeChannelId;
  constructor(
    botToken: string,
    curlyjoeChannelId: string,
    liveTradeService?: LiveTradeAlertService
  );
  /**
   * Check if message is from CurlyJoe channel
   */
  private isFromCurlyJoeChannel;
  /**
   * Setup message handlers
   */
  private setupHandlers;
  /**
   * Handle message from CurlyJoe channel
   */
  private handleMessage;
  /**
   * Process a single token address and add to watchlist
   */
  private processTokenAddress;
  /**
   * Start the ingestion service
   */
  start(): Promise<void>;
  /**
   * Stop the ingestion service
   */
  stop(): Promise<void>;
}
//# sourceMappingURL=curlyjoe-call-ingestion.d.ts.map
