/**
 * Tenkan/Kijun Cross Alert Service
 * ==================================
 * Real-time monitoring service that detects Tenkan/Kijun cross signals
 * and sends buy/sell alerts when triggers occur.
 *
 * Uses Yellowstone gRPC or WebSocket for live price data.
 */
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
export declare class TenkanKijunAlertService extends EventEmitter {
  private callerDb;
  private activeMonitors;
  private bondingCurveCache;
  private bondingCurveToMint;
  private ws;
  private grpcClient;
  private grpcStream;
  private reconnectAttempts;
  private maxReconnectAttempts;
  private updateInterval;
  private useGrpc;
  private isAuthenticated;
  private authPromise;
  private jupiterPriceLastRequest;
  private jupiterPriceRequestCount;
  private jupiterPriceRequestWindowStart;
  private jupiterTokensLastRequest;
  private jupiterTokensRequestCount;
  private jupiterTokensRequestWindowStart;
  private readonly JUPITER_MIN_REQUEST_INTERVAL;
  private readonly JUPITER_MAX_REQUESTS_PER_MINUTE;
  private readonly SHYFT_API_KEY;
  private readonly SHYFT_X_TOKEN;
  private readonly SHYFT_WS_URL;
  private readonly SHYFT_GRPC_URL;
  private readonly MONITOR_WINDOW_DAYS;
  private readonly CANDLE_INTERVAL_MS;
  private readonly PRICE_UPDATE_INTERVAL_MS;
  private readonly MIN_CANDLES_FOR_ENTRY;
  private readonly PUMP_FUN_PROGRAM_ID;
  private readonly RAYDIUM_AMM_PROGRAM_ID;
  private readonly ORCA_WHIRLPOOL_PROGRAM_ID;
  private readonly METEORA_DBC_PROGRAM_ID;
  private rpcConnection;
  private dexParser;
  constructor(
    shyftApiKey?: string,
    shyftWsUrl?: string,
    shyftXToken?: string,
    shyftGrpcUrl?: string,
    rpcUrl?: string
  );
  /**
   * Start the alert service
   */
  start(): Promise<void>;
  /**
   * Stop the alert service
   */
  stop(): void;
  /**
   * Load recent calls from the caller database
   */
  private loadRecentCalls;
  /**
   * Connect to price stream (gRPC or WebSocket)
   */
  private connect;
  /**
   * Connect via Yellowstone gRPC
   */
  private connectGrpc;
  /**
   * Authenticate with Shyft WebSocket
   */
  private authenticateShyft;
  /**
   * Connect via WebSocket (Shyft or fallback)
   */
  private connectWebSocket;
  /**
   * Handle gRPC update from Yellowstone
   * For Pump.fun tokens, we subscribe to bonding curve accounts and parse price from account data
   */
  private handleGrpcUpdate;
  /**
   * Handle transaction updates to capture mints and extract prices
   */
  private handleTransactionUpdate;
  /**
   * Fetch mint address from bonding curve account via RPC
   * Fallback method when mint isn't in our mapping
   */
  private fetchMintFromBondingCurve;
  /**
   * Derive Pump.fun bonding curve PDA address
   * PDA("bonding-curve", mint)
   * Pump.fun program ID: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
   * Uses caching to avoid recomputing PDAs
   * Also maintains reverse mapping (bonding curve -> mint)
   */
  private deriveBondingCurveAddress;
  /**
   * Get mint address from bonding curve address
   * Uses reverse mapping maintained when deriving bonding curves
   */
  private getMintFromBondingCurve;
  /**
   * Parse price from Pump.fun bonding curve account data using IDL decoder
   * Properly decodes the account structure according to the Pump.fun IDL
   */
  private parsePriceFromBondingCurve;
  /**
   * Subscribe to price updates for all monitored tokens
   * For Pump.fun tokens, subscribe to bonding curve accounts
   */
  private subscribeToAllTokens;
  /**
   * Subscribe to bonding curve accounts via Yellowstone gRPC
   */
  private subscribeToBondingCurvesGrpc;
  /**
   * Subscribe via WebSocket (fallback)
   */
  private subscribeToBondingCurvesWebSocket;
  /**
   * Handle price update from WebSocket
   */
  private handlePriceUpdate;
  /**
   * Update token price and check for signals
   * Called immediately when price updates come in via gRPC/WebSocket
   */
  private updateTokenPrice;
  /**
   * Update candle data with new price from live stream
   */
  private updateCandles;
  /**
   * Recalculate indicators for all candles
   */
  private recalculateIndicators;
  /**
   * Check for Tenkan/Kijun cross signals
   * Checks immediately on every price update - no delay
   */
  private checkSignals;
  /**
   * Start periodic updates (fallback if WebSocket fails)
   */
  private startPeriodicUpdates;
  /**
   * Fetch current price from Jupiter Swap API v1 (migrated from v6)
   * Jupiter provides price quotes for token pairs (works for both bonding curve and DEX tokens)
   * For graduated tokens on Pumpswap/DEX, Jupiter will route through available liquidity pools
   */
  private fetchJupiterPrice;
  /**
   * Get token decimals (cache results)
   * Uses Jupiter Tokens API v2 (rate limited: 1 rps, 60 rpm)
   */
  private tokenDecimalsCache;
  private getTokenDecimals;
  /**
   * Check if we can make a Jupiter Tokens API request based on rate limits
   * Limits: 1 request per second, 60 requests per minute
   */
  private canMakeJupiterTokensRequest;
  /**
   * Get SOL price in USD (cache for 1 minute)
   * Uses Jupiter Price API v3 (migrated from v2/v4)
   * Rate limits: 1 rps, 60 rpm (no API key required)
   */
  private solPriceCache;
  private getSolPriceUsd;
  /**
   * Check if we can make a Jupiter Price API request based on rate limits
   * Limits: 1 request per second, 60 requests per minute
   */
  private canMakeJupiterPriceRequest;
  /**
   * Fetch current price from API (fallback - uses Jupiter)
   */
  private fetchPrice;
  /**
   * Handle reconnection
   */
  private handleReconnect;
  /**
   * Get active monitors count
   */
  getActiveMonitorsCount(): number;
  /**
   * Get status of all monitors (for debugging/verification)
   */
  getMonitorStatus(): Array<{
    tokenSymbol: string;
    tokenAddress: string;
    candles: number;
    hasEnoughCandles: boolean;
    lastPrice?: number;
    lastUpdateTime?: number;
    indicatorsCalculated: boolean;
    tenkan?: number;
    kijun?: number;
  }>;
  /**
   * Log current status of all monitors (for debugging)
   */
  logStatus(): void;
  /**
   * Remove a monitor for a specific token
   */
  removeMonitor(tokenAddress: string, chain: string): Promise<void>;
  /**
   * Add a token to monitor manually (alias for addMonitor)
   */
  addMonitor(
    tokenAddress: string,
    tokenSymbol: string,
    chain: string,
    callerName: string,
    alertTime: Date,
    alertPrice: number
  ): Promise<void>;
  /**
   * Add a token to monitor manually
   */
  addToken(
    tokenAddress: string,
    tokenSymbol: string,
    chain: string,
    callerName: string,
    alertTime: DateTime,
    alertPrice: number
  ): Promise<void>;
}
export default TenkanKijunAlertService;
//# sourceMappingURL=tenkan-kijun-alert-service.d.ts.map
