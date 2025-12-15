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
import WebSocket from 'ws';
import axios from 'axios';
import { PublicKey, Connection } from '@solana/web3.js';
import { CallerDatabase } from '@quantbot/storage';
import { calculateIndicators, IndicatorData } from '@quantbot/simulation';
import type { Candle } from '@quantbot/core';
import { decodeBondingCurveAccount, calculatePriceFromBondingCurve } from './pump-idl-decoder';
import { DexTransactionParser, SwapEvent } from './dex-transaction-parser';
import { logger } from '@quantbot/utils';

// Yellowstone gRPC client (optional - install with: npm install @triton-one/yellowstone-grpc)
let YellowstoneGrpcClient: any = null;
let CommitmentLevel: any = null;
try {
  const yellowstone = require('@triton-one/yellowstone-grpc');
  // Check if it's a default export or named export
  YellowstoneGrpcClient = yellowstone.default || yellowstone.YellowstoneGrpcClient || yellowstone;
  CommitmentLevel = yellowstone.CommitmentLevel;
} catch (error) {
  // gRPC client not installed - will use WebSocket fallback
  logger.warn(
    'Yellowstone gRPC package not installed. Install with: npm install @triton-one/yellowstone-grpc'
  );
}

interface TokenMonitor {
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  callerName: string;
  alertTime: DateTime;
  alertPrice: number;
  candles: Candle[];
  indicatorHistory: IndicatorData[];
  lastPrice?: number;
  lastUpdateTime?: number;
  // Removed sixHourMark - signals checked immediately
  entrySignalSent: boolean; // Whether we've sent an entry signal
  exitSignalSent: boolean; // Whether we've sent an exit signal
  inPosition: boolean; // Whether we're currently in a position
  entryPrice?: number;
  entryTime?: number;
}

interface AlertEvent {
  type: 'BUY' | 'SELL';
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  callerName: string;
  price: number;
  timestamp: number;
  signal: string;
  tenkan: number;
  kijun: number;
}

export class TenkanKijunAlertService extends EventEmitter {
  private callerDb: CallerDatabase;
  private activeMonitors: Map<string, TokenMonitor> = new Map();
  private bondingCurveCache: Map<string, string> = new Map(); // Cache mint -> bonding curve address
  private bondingCurveToMint: Map<string, string> = new Map(); // Reverse mapping: bonding curve address -> mint
  private ws: WebSocket | null = null;
  private grpcClient: any = null;
  private grpcStream: any = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private updateInterval: NodeJS.Timeout | null = null;
  private useGrpc: boolean = false;
  private isAuthenticated: boolean = false;
  private authPromise: { resolve: () => void; reject: (error: Error) => void } | null = null;

  // Jupiter API rate limiting (1 rps, 60 rpm for both Price and Tokens APIs)
  private jupiterPriceLastRequest: number = 0;
  private jupiterPriceRequestCount: number = 0;
  private jupiterPriceRequestWindowStart: number = Date.now();
  private jupiterTokensLastRequest: number = 0;
  private jupiterTokensRequestCount: number = 0;
  private jupiterTokensRequestWindowStart: number = Date.now();
  private readonly JUPITER_MIN_REQUEST_INTERVAL = 1000; // 1 second between requests
  private readonly JUPITER_MAX_REQUESTS_PER_MINUTE = 60;

  // Configuration
  private readonly SHYFT_API_KEY: string;
  private readonly SHYFT_X_TOKEN: string;
  private readonly SHYFT_WS_URL: string;
  private readonly SHYFT_GRPC_URL: string;
  private readonly MONITOR_WINDOW_DAYS: number = 7; // Monitor tokens from last 7 days
  private readonly CANDLE_INTERVAL_MS: number = 5 * 60 * 1000; // 5 minutes
  private readonly PRICE_UPDATE_INTERVAL_MS: number = 5 * 1000; // 5 seconds (fallback polling only - real-time gRPC/WebSocket updates are immediate)
  private readonly MIN_CANDLES_FOR_ENTRY: number = 52; // Need 52 candles for Ichimoku

  // DEX Program IDs
  private readonly PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  private readonly RAYDIUM_AMM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  private readonly ORCA_WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
  private readonly METEORA_DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

  // RPC connection for mint lookups
  private rpcConnection: Connection | null = null;

  // DEX transaction parser
  private dexParser: DexTransactionParser;

  constructor(
    shyftApiKey?: string,
    shyftWsUrl?: string,
    shyftXToken?: string,
    shyftGrpcUrl?: string,
    rpcUrl?: string
  ) {
    super();
    this.SHYFT_API_KEY = shyftApiKey || process.env.SHYFT_API_KEY || '';
    this.SHYFT_X_TOKEN = shyftXToken || process.env.SHYFT_X_TOKEN || '';
    this.SHYFT_WS_URL = shyftWsUrl || process.env.SHYFT_WS_URL || 'wss://api.shyft.to/v1/stream';
    this.SHYFT_GRPC_URL = shyftGrpcUrl || process.env.SHYFT_GRPC_URL || 'https://grpc.ams.shyft.to';
    this.callerDb = new CallerDatabase();

    // Initialize RPC connection for mint lookups
    const rpcEndpoint =
      rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.rpcConnection = new Connection(rpcEndpoint, 'confirmed');

    // Initialize DEX transaction parser
    this.dexParser = new DexTransactionParser();

    // Prefer gRPC if available
    this.useGrpc = !!YellowstoneGrpcClient && !!this.SHYFT_X_TOKEN;
  }

  /**
   * Start the alert service
   */
  public async start(): Promise<void> {
    logger.info('Starting Tenkan/Kijun Cross Alert Service');

    // Load recent calls from database
    await this.loadRecentCalls();

    // Connect to price stream
    await this.connect();

    // Start periodic updates
    this.startPeriodicUpdates();

    logger.info('Alert service started', { tokenCount: this.activeMonitors.size });
  }

  /**
   * Stop the alert service
   */
  public stop(): void {
    if (this.grpcStream) {
      this.grpcStream.end();
      this.grpcStream = null;
    }
    if (this.grpcClient) {
      this.grpcClient.close?.();
      this.grpcClient = null;
    }
    // Clean up WebSocket connection and all listeners
    this.cleanupWebSocket();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.activeMonitors.clear();
    logger.info('Alert service stopped');
  }

  /**
   * Load recent calls from the caller database
   */
  private async loadRecentCalls(): Promise<void> {
    try {
      const endTime = new Date();
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - this.MONITOR_WINDOW_DAYS);

      // Get all callers
      const callers = await this.callerDb.getAllCallers();

      for (const callerName of callers) {
        try {
          const alerts = await this.callerDb.getCallerAlertsInRange(callerName, startTime, endTime);

          for (const alert of alerts) {
            // Only monitor Solana tokens for now
            if (alert.chain.toLowerCase() !== 'solana') continue;

            const key = `${alert.chain}:${alert.tokenAddress}`.toLowerCase();

            // Skip if already monitoring
            if (this.activeMonitors.has(key)) continue;

            const alertTime = DateTime.fromJSDate(alert.alertTimestamp);

            // Start with empty candles - we'll build them from real-time price stream
            // This avoids needing Birdeye API
            const candles: Candle[] = [];
            const indicatorHistory: IndicatorData[] = [];

            const monitor: TokenMonitor = {
              tokenAddress: alert.tokenAddress,
              tokenSymbol: alert.tokenSymbol || 'UNKNOWN',
              chain: alert.chain,
              callerName: alert.callerName,
              alertTime,
              alertPrice: alert.priceAtAlert || 0,
              candles,
              indicatorHistory,
              entrySignalSent: false,
              exitSignalSent: false,
              inPosition: false,
            };

            this.activeMonitors.set(key, monitor);
            logger.info('Monitoring token', {
              tokenSymbol: monitor.tokenSymbol,
              callerName: alert.callerName,
            });

            // Fetch initial price to start building candles
            logger.debug('Starting monitoring - fetching initial price', {
              tokenSymbol: monitor.tokenSymbol,
            });
            this.fetchJupiterPrice(monitor)
              .then(() => {
                logger.debug('Initial price fetched, building candles', {
                  tokenSymbol: monitor.tokenSymbol,
                });
              })
              .catch((error) => {
                logger.warn('Initial price fetch failed, will retry', {
                  tokenSymbol: monitor.tokenSymbol,
                  error: (error as Error).message,
                });
              });
          }
        } catch (error) {
          logger.error('Error loading calls for caller', error as Error, { callerName });
        }
      }

      logger.info('Loaded tokens for monitoring', { tokenCount: this.activeMonitors.size });
    } catch (error) {
      logger.error('Error loading recent calls', error as Error);
    }
  }

  /**
   * Connect to price stream (gRPC or WebSocket)
   */
  private async connect(): Promise<void> {
    if (this.useGrpc) {
      await this.connectGrpc();
    } else {
      await this.connectWebSocket();
    }
  }

  /**
   * Connect via Yellowstone gRPC
   */
  private async connectGrpc(): Promise<void> {
    if (!YellowstoneGrpcClient || !this.SHYFT_X_TOKEN) {
      logger.warn('Yellowstone gRPC not available. Falling back to WebSocket.');
      await this.connectWebSocket();
      return;
    }

    try {
      logger.info('Connecting to Yellowstone gRPC...');
      // Try different ways to instantiate the client
      if (typeof YellowstoneGrpcClient === 'function') {
        this.grpcClient = new YellowstoneGrpcClient(this.SHYFT_GRPC_URL, this.SHYFT_X_TOKEN);
      } else if (YellowstoneGrpcClient.YellowstoneGrpcClient) {
        this.grpcClient = new YellowstoneGrpcClient.YellowstoneGrpcClient(
          this.SHYFT_GRPC_URL,
          this.SHYFT_X_TOKEN
        );
      } else {
        throw new Error('Yellowstone client not properly initialized');
      }

      this.grpcStream = await this.grpcClient.subscribe();

      this.grpcStream.on('data', (data: any) => {
        // Log that we received data (but don't spam)
        if (Math.random() < 0.01) {
          // Log 1% of updates to avoid spam
          logger.debug('gRPC received update', { monitorCount: this.activeMonitors.size });
        }
        this.handleGrpcUpdate(data);
      });

      this.grpcStream.on('error', (error: any) => {
        logger.error('gRPC stream error', error as Error);
        this.handleReconnect();
      });

      logger.info('gRPC stream connected and listening for updates');

      // Subscribe to all monitored tokens
      // Note: Subscription happens when tokens are added via subscribeToBondingCurvesGrpc()
      // Don't subscribe here with empty accounts array
      logger.info('Connected to Yellowstone gRPC. Stream ready.');

      // Subscribe to existing monitors if any
      if (this.activeMonitors.size > 0) {
        this.subscribeToBondingCurvesGrpc();
      }
      this.reconnectAttempts = 0;
    } catch (error) {
      logger.error('Failed to connect to Yellowstone gRPC', error as Error);
      logger.info('Falling back to WebSocket...');
      await this.connectWebSocket();
    }
  }

  /**
   * Authenticate with Shyft WebSocket
   */
  private authenticateShyft(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const authToken = this.SHYFT_X_TOKEN || this.SHYFT_API_KEY;
      if (!authToken) {
        reject(new Error('No Shyft authentication token available'));
        return;
      }

      // Store promise resolvers for auth response handler
      this.authPromise = { resolve, reject };

      // Set timeout for auth response
      const authTimeout = setTimeout(() => {
        this.isAuthenticated = false;
        this.authPromise = null;
        reject(new Error('Authentication timeout'));
      }, 5000);

      // Override resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;
      this.authPromise.resolve = () => {
        clearTimeout(authTimeout);
        originalResolve();
      };
      this.authPromise.reject = (error: Error) => {
        clearTimeout(authTimeout);
        originalReject(error);
      };

      // Send auth message
      const authMsg = {
        jsonrpc: '2.0',
        id: 1,
        method: 'auth',
        params: [authToken],
      };

      logger.debug('Sending Shyft WebSocket auth message', { hasToken: !!authToken });
      this.ws.send(JSON.stringify(authMsg));
    });
  }

  /**
   * Clean up WebSocket connection and remove all event listeners
   * Prevents memory leaks from accumulating listeners on reconnection
   */
  private cleanupWebSocket(): void {
    if (this.ws) {
      // Remove all event listeners to prevent memory leaks
      this.ws.removeAllListeners();
      // Close the connection if it's still open
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  /**
   * Connect via WebSocket (Shyft or fallback)
   */
  private async connectWebSocket(): Promise<void> {
    // Prefer Shyft WebSocket, but can fallback to polling if needed
    if (!this.SHYFT_API_KEY && !this.SHYFT_X_TOKEN) {
      logger.warn('No Shyft API key configured. Using polling mode only.');
      return;
    }

    // Clean up any existing WebSocket connection before creating a new one
    this.cleanupWebSocket();

    try {
      // Use Shyft WebSocket if available
      const wsUrl = this.SHYFT_WS_URL || 'wss://api.shyft.to/v1/stream';

      logger.info('Connecting to Shyft WebSocket...');

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        logger.info('Connected to Shyft WebSocket');
        this.reconnectAttempts = 0;

        // Authenticate if using Shyft
        if (this.SHYFT_API_KEY || this.SHYFT_X_TOKEN) {
          try {
            await this.authenticateShyft();
            // Subscribe after successful authentication
            this.subscribeToAllTokens();
          } catch (error) {
            logger.error('Shyft WebSocket authentication failed', error as Error);
            if (this.ws) {
              this.ws.close();
            }
            this.handleReconnect();
          }
        } else {
          // No auth needed, subscribe directly
          this.subscribeToAllTokens();
        }
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle auth response first
          if (message.id === 1 && (message.method === 'auth' || message.result !== undefined)) {
            if (message.error) {
              logger.error('Shyft WebSocket auth error', { error: message.error });
              this.isAuthenticated = false;
              if (this.authPromise) {
                this.authPromise.reject(
                  new Error(message.error.message || message.error.code || 'Authentication failed')
                );
                this.authPromise = null;
              }
              return;
            }

            if (
              message.result === true ||
              message.result === 'success' ||
              (!message.error && message.id === 1)
            ) {
              logger.info('Shyft WebSocket authenticated successfully');
              this.isAuthenticated = true;
              if (this.authPromise) {
                this.authPromise.resolve();
                this.authPromise = null;
              }
              return;
            }
          }

          // Only process messages if authenticated
          if (this.isAuthenticated) {
            // Log that we received data (but don't spam)
            if (Math.random() < 0.01) {
              // Log 1% of updates to avoid spam
              logger.debug('WebSocket received update', { monitorCount: this.activeMonitors.size });
            }
            this.handlePriceUpdate(message);
          } else {
            logger.debug('Received message before authentication, ignoring', {
              messageId: message.id,
            });
          }
        } catch (error) {
          logger.error('Error parsing price update', error as Error);
        }
      });

      logger.info('WebSocket connected and listening for updates');

      this.ws.on('close', () => {
        logger.warn('WebSocket connection closed');
        this.handleReconnect();
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket error', error as Error);
      });
    } catch (error) {
      logger.error('Failed to connect to WebSocket', error as Error);
      logger.info('Falling back to polling mode');
    }
  }

  /**
   * Handle gRPC update from Yellowstone
   * For Pump.fun tokens, we subscribe to bonding curve accounts and parse price from account data
   */
  private handleGrpcUpdate(data: any): void {
    if (data.account) {
      const account = data.account.account;
      const accountData = data.account.data;
      const slot = data.account.slot;

      // Convert account pubkey to base58 string for comparison
      let accountAddress: string | null = null;
      try {
        if (account?.pubkey) {
          accountAddress = new PublicKey(account.pubkey).toBase58();
        } else if (Buffer.isBuffer(account) || account instanceof Uint8Array) {
          accountAddress = new PublicKey(account).toBase58();
        } else if (typeof account === 'string') {
          accountAddress = account;
        }
      } catch (e) {
        // Invalid pubkey, skip
        return;
      }

      if (!accountAddress) return;

      // Check if this is a bonding curve account update
      // Pump.fun bonding curve PDA: PDA("bonding-curve", mint)
      // We need to match against our monitored tokens' bonding curve addresses
      for (const [key, monitor] of this.activeMonitors.entries()) {
        const bondingCurveAddress = this.deriveBondingCurveAddress(monitor.tokenAddress);

        if (accountAddress === bondingCurveAddress) {
          // Check if bonding curve account still exists (token hasn't graduated)
          if (accountData && accountData.length > 0) {
            // Convert accountData to Buffer if needed
            let dataBuffer: Buffer;
            if (Buffer.isBuffer(accountData)) {
              dataBuffer = accountData;
            } else if (typeof accountData === 'string') {
              dataBuffer = Buffer.from(accountData, 'base64');
            } else if (accountData instanceof Uint8Array) {
              dataBuffer = Buffer.from(accountData);
            } else {
              return;
            }

            // Decode and parse price from bonding curve account data using IDL
            const decoded = decodeBondingCurveAccount(dataBuffer);
            if (decoded) {
              const solPriceUsd = this.solPriceCache?.price || 150;
              const price = calculatePriceFromBondingCurve(decoded, solPriceUsd);

              // Get mint address for logging
              const mintAddress = this.getMintFromBondingCurve(accountAddress);
              const mintDisplay = mintAddress
                ? `${mintAddress.substring(0, 8)}...`
                : monitor.tokenAddress.substring(0, 8) + '...';

              if (price > 0) {
                logger.debug('gRPC price update', {
                  tokenSymbol: monitor.tokenSymbol,
                  mint: mintDisplay,
                  price,
                });
                const solReserves =
                  decoded.real_sol_reserves || decoded.virtual_sol_reserves || decoded.sol_reserves;
                const tokenReserves =
                  decoded.real_token_reserves ||
                  decoded.virtual_token_reserves ||
                  decoded.token_reserves;
                const solStr =
                  typeof solReserves === 'string'
                    ? solReserves
                    : (solReserves as any)?.toString?.() || String(solReserves || 'N/A');
                const tokenStr =
                  typeof tokenReserves === 'string'
                    ? tokenReserves
                    : (tokenReserves as any)?.toString?.() || String(tokenReserves || 'N/A');
                logger.debug('Bonding curve reserves', {
                  tokenSymbol: monitor.tokenSymbol,
                  solReserve: solStr,
                  tokenReserve: tokenStr,
                });
                const creatorDisplay =
                  typeof decoded.creator === 'string'
                    ? decoded.creator.substring(0, 8) + '...'
                    : decoded.creator?.toBase58()?.substring(0, 8) + '...' || 'N/A';
                logger.debug('Bonding curve status', {
                  tokenSymbol: monitor.tokenSymbol,
                  complete: decoded.complete,
                  creator: creatorDisplay,
                });
                this.updateTokenPrice(monitor, price, Date.now());
              }
            } else {
              logger.warn('Failed to decode bonding curve', { tokenSymbol: monitor.tokenSymbol });
            }
          } else {
            // Bonding curve account is empty/closed - token has graduated to Pumpswap/DEX
            // Use Jupiter v6 for DEX price (will route through Pumpswap if available)
            logger.info('Token graduated, fetching DEX price', {
              tokenSymbol: monitor.tokenSymbol,
            });
            this.fetchJupiterPrice(monitor).catch((error) => {
              logger.error('Error fetching Jupiter price', error as Error, {
                tokenSymbol: monitor.tokenSymbol,
              });
            });
          }
          return;
        }
      }

      // Fallback: if account matches token mint directly, fetch price via Jupiter
      const key = `solana:${account}`.toLowerCase();
      const monitor = this.activeMonitors.get(key);
      if (monitor) {
        // Use Jupiter v6 for price quote
        this.fetchJupiterPrice(monitor).catch((error) => {
          logger.error('Error fetching Jupiter price', error as Error, {
            tokenSymbol: monitor.tokenSymbol,
          });
        });
      }
    }

    // Handle transaction updates - capture mints from creation events and prices from swaps
    if (data.transaction) {
      this.handleTransactionUpdate(data.transaction);
    }
  }

  /**
   * Handle transaction updates to capture mints and extract prices
   */
  private handleTransactionUpdate(transaction: any): void {
    try {
      // Extract mint from Pump.fun token creation
      const mint = this.dexParser.extractMintFromPumpFunCreation(transaction);
      if (mint) {
        // Derive bonding curve and store mapping
        const bondingCurveAddress = this.deriveBondingCurveAddress(mint);
        if (bondingCurveAddress) {
          logger.info('Pump.fun new token created', {
            mint: mint.substring(0, 8),
            bondingCurve: bondingCurveAddress.substring(0, 8),
          });
        }
      }

      // Parse DEX swap transactions (Raydium, Orca, Meteora) to extract prices
      const swapEvent = this.dexParser.parseTransaction(transaction);
      if (swapEvent && swapEvent.mint) {
        // Find monitor for this mint
        const key = `solana:${swapEvent.mint}`.toLowerCase();
        const monitor = this.activeMonitors.get(key);

        if (monitor) {
          // Calculate price from swap amounts
          // amountIn is SOL, amountOut is tokens (for Buy)
          // amountIn is tokens, amountOut is SOL (for Sell)
          const solAmount =
            swapEvent.type === 'Buy'
              ? parseFloat(swapEvent.amountIn.toString())
              : parseFloat(swapEvent.amountOut.toString());
          const tokenAmount =
            swapEvent.type === 'Buy'
              ? parseFloat(swapEvent.amountOut.toString())
              : parseFloat(swapEvent.amountIn.toString());

          if (tokenAmount > 0) {
            const priceInSol = solAmount / tokenAmount;
            const solPriceUsd = this.solPriceCache?.price || 150;
            const price = priceInSol * solPriceUsd;

            logger.debug('DEX swap price update', {
              tokenSymbol: monitor.tokenSymbol,
              price,
              swapType: swapEvent.type,
            });
            this.updateTokenPrice(monitor, price, Date.now());
          }
        }
      }
    } catch (error) {
      // Silently handle errors - transaction parsing is best-effort
    }
  }

  /**
   * Fetch mint address from bonding curve account via RPC
   * Fallback method when mint isn't in our mapping
   */
  private async fetchMintFromBondingCurve(bondingCurveAddress: string): Promise<string | null> {
    if (!this.rpcConnection) return null;

    try {
      // Unfortunately, we can't reverse PDAs directly
      // But we can check if this bonding curve account exists and try to find associated token accounts
      // For now, return null - the mapping approach is more reliable
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Derive Pump.fun bonding curve PDA address
   * PDA("bonding-curve", mint)
   * Pump.fun program ID: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
   * Uses caching to avoid recomputing PDAs
   * Also maintains reverse mapping (bonding curve -> mint)
   */
  private deriveBondingCurveAddress(mint: string): string {
    // Check cache first
    if (this.bondingCurveCache.has(mint)) {
      return this.bondingCurveCache.get(mint)!;
    }

    try {
      const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
      const mintPubkey = new PublicKey(mint);

      // Derive PDA: findProgramAddressSync(["bonding-curve", mint], PUMP_PROGRAM_ID)
      const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
        PUMP_PROGRAM_ID
      );

      const address = bondingCurve.toBase58();

      // Cache the result (mint -> bonding curve)
      this.bondingCurveCache.set(mint, address);

      // Store reverse mapping (bonding curve -> mint)
      this.bondingCurveToMint.set(address, mint);

      return address;
    } catch (error) {
      logger.error('Failed to derive bonding curve address', error as Error, { mint });
      return '';
    }
  }

  /**
   * Get mint address from bonding curve address
   * Uses reverse mapping maintained when deriving bonding curves
   */
  private getMintFromBondingCurve(bondingCurveAddress: string): string | null {
    return this.bondingCurveToMint.get(bondingCurveAddress) || null;
  }

  /**
   * Parse price from Pump.fun bonding curve account data using IDL decoder
   * Properly decodes the account structure according to the Pump.fun IDL
   */
  private parsePriceFromBondingCurve(accountData: Buffer | Uint8Array | string): number {
    try {
      if (!accountData) return 0;

      // Decode using IDL structure
      const decoded = decodeBondingCurveAccount(accountData);

      if (!decoded) {
        return 0; // Not a valid bonding curve account
      }

      // Get SOL price in USD
      const solPriceUsd = this.solPriceCache?.price || 150;

      // Calculate price using decoded reserves
      const price = calculatePriceFromBondingCurve(decoded, solPriceUsd);

      return price;
    } catch (error) {
      console.debug(`Failed to parse bonding curve price: ${error}`);
      return 0;
    }
  }

  /**
   * Subscribe to price updates for all monitored tokens
   * For Pump.fun tokens, subscribe to bonding curve accounts
   */
  private subscribeToAllTokens(): void {
    if (this.useGrpc && this.grpcClient) {
      // Subscribe via gRPC to bonding curve accounts
      this.subscribeToBondingCurvesGrpc();
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Check authentication for Shyft WebSocket
      if ((this.SHYFT_API_KEY || this.SHYFT_X_TOKEN) && !this.isAuthenticated) {
        logger.warn('Cannot subscribe: Not authenticated with Shyft');
        return;
      }
      // Subscribe via WebSocket
      this.subscribeToBondingCurvesWebSocket();
    }
  }

  /**
   * Subscribe to bonding curve accounts via Yellowstone gRPC
   */
  private subscribeToBondingCurvesGrpc(): void {
    if (!this.grpcClient || !this.grpcStream) return;

    const accounts: string[] = [];

    for (const [key, monitor] of this.activeMonitors.entries()) {
      // Derive bonding curve PDA for each token
      const bondingCurveAddress = this.deriveBondingCurveAddress(monitor.tokenAddress);
      if (bondingCurveAddress) {
        accounts.push(bondingCurveAddress);
      }
    }

    if (accounts.length === 0) {
      logger.warn('No bonding curve addresses to subscribe to');
      return;
    }

    // Subscribe to account updates via Yellowstone gRPC
    // Yellowstone expects: { accounts: { [subscriptionId]: { account: string[] } } }
    try {
      // Build accounts object with subscription IDs as keys
      const accountsObject: { [key: string]: any } = {};

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const subscriptionId = `bonding-curve-${i}`;
        // Yellowstone expects account addresses as base58 strings in an array
        // SubscribeRequestFilterAccounts requires: account, owner, filters
        accountsObject[subscriptionId] = {
          account: [account], // Array of account addresses (base58 strings)
          owner: [], // Empty array = no owner filter
          filters: [], // Empty array = no filters
        };
      }

      // Build the subscription request in the correct format
      // Note: commitment should be a number (enum value), not a string
      const commitmentValue = CommitmentLevel?.CONFIRMED ?? 1; // 1 = CONFIRMED

      // Subscribe to Pump.fun transactions to capture new mints
      const pumpFunTransactions: any = {
        pumpfun_new_tokens: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.PUMP_FUN_PROGRAM_ID],
          accountExclude: [],
          accountRequired: [],
        },
      };

      // Subscribe to DEX transactions for graduated tokens
      const dexTransactions: any = {
        raydium: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.RAYDIUM_AMM_PROGRAM_ID],
          accountExclude: [],
          accountRequired: [],
        },
        orca: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.ORCA_WHIRLPOOL_PROGRAM_ID],
          accountExclude: [],
          accountRequired: [],
        },
        meteora: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.METEORA_DBC_PROGRAM_ID],
          accountExclude: [],
          accountRequired: [],
        },
      };

      // Yellowstone requires all top-level fields, even if empty
      const subscribeRequest: any = {
        accounts: accountsObject,
        slots: {},
        transactions: { ...pumpFunTransactions, ...dexTransactions },
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        commitment: commitmentValue,
        accountsDataSlice: [], // Required field - empty array means return all data
      };

      // Only subscribe if we have accounts and stream is ready
      if (accounts.length > 0 && this.grpcStream) {
        this.grpcStream.write(subscribeRequest);
        logger.info('gRPC subscribed', {
          bondingCurveAccounts: accounts.length,
          pumpFunTransactions: true,
          raydiumSwaps: true,
          orcaSwaps: true,
          meteoraSwaps: true,
        });
      }
    } catch (error: any) {
      logger.error('Failed to subscribe via gRPC', error as Error);
      // Fallback to polling if subscription fails
      if (!this.updateInterval) {
        logger.info('Falling back to polling mode (Jupiter API)');
        this.startPeriodicUpdates();
      }
    }
  }

  /**
   * Subscribe via WebSocket (fallback)
   */
  private subscribeToBondingCurvesWebSocket(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Check authentication for Shyft WebSocket
    if ((this.SHYFT_API_KEY || this.SHYFT_X_TOKEN) && !this.isAuthenticated) {
      logger.warn('Cannot subscribe to bonding curves: Not authenticated with Shyft');
      return;
    }

    const subscriptions: any[] = [];

    for (const [key, monitor] of this.activeMonitors.entries()) {
      // Subscribe to bonding curve account updates
      const bondingCurveAddress = this.deriveBondingCurveAddress(monitor.tokenAddress);
      if (bondingCurveAddress) {
        subscriptions.push({
          jsonrpc: '2.0',
          id: `${monitor.chain}:${monitor.tokenAddress}`,
          method: 'accountSubscribe',
          params: [
            bondingCurveAddress,
            {
              encoding: 'base64',
              commitment: 'confirmed',
            },
          ],
        });
      } else {
        // Fallback: subscribe to token mint account (less efficient)
        subscriptions.push({
          jsonrpc: '2.0',
          id: `${monitor.chain}:${monitor.tokenAddress}`,
          method: 'accountSubscribe',
          params: [
            monitor.tokenAddress,
            {
              encoding: 'base64',
              commitment: 'confirmed',
            },
          ],
        });
      }
    }

    // Send all subscriptions
    subscriptions.forEach((sub, index) => {
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(sub));
        }
      }, index * 100); // Stagger subscriptions
    });

    logger.info('Subscribed to accounts via WebSocket', { count: subscriptions.length });
  }

  /**
   * Handle price update from WebSocket
   */
  private handlePriceUpdate(message: any): void {
    // Parse message format (varies by provider)
    const account = message.params?.result?.account || message.account;
    const price = message.params?.result?.price || message.price;
    const timestamp = message.params?.result?.timestamp || message.timestamp || Date.now();

    if (!account || !price) return;

    const key = `solana:${account}`.toLowerCase();
    const monitor = this.activeMonitors.get(key);

    if (!monitor) return;

    logger.debug('WebSocket price update', { tokenSymbol: monitor.tokenSymbol, price });
    this.updateTokenPrice(monitor, price, timestamp);
  }

  /**
   * Update token price and check for signals
   * Called immediately when price updates come in via gRPC/WebSocket
   */
  private updateTokenPrice(monitor: TokenMonitor, price: number, timestamp: number): void {
    monitor.lastPrice = price;
    monitor.lastUpdateTime = timestamp;

    const candlesBefore = monitor.candles.length;

    // Update candles first (always, to build candle history)
    this.updateCandles(monitor, price, timestamp);

    const candlesAfter = monitor.candles.length;
    const newCandleCreated = candlesAfter > candlesBefore;

    if (newCandleCreated) {
      logger.debug('New 5m candle created', {
        tokenSymbol: monitor.tokenSymbol,
        totalCandles: candlesAfter,
      });
    }

    // Check for signals IMMEDIATELY on every price update
    // No delay - signals are detected as soon as crosses occur
    if (monitor.candles.length >= this.MIN_CANDLES_FOR_ENTRY) {
      this.checkSignals(monitor);
    } else {
      logger.debug('Building candles', {
        tokenSymbol: monitor.tokenSymbol,
        current: monitor.candles.length,
        required: this.MIN_CANDLES_FOR_ENTRY,
      });
    }
  }

  /**
   * Update candle data with new price from live stream
   */
  private updateCandles(monitor: TokenMonitor, price: number, timestamp: number): void {
    const now = DateTime.fromMillis(timestamp);
    const lastCandle = monitor.candles[monitor.candles.length - 1];

    // If no candles yet, create first one
    if (!lastCandle) {
      const firstCandle: Candle = {
        timestamp: timestamp / 1000, // Convert to seconds
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
      };
      monitor.candles.push(firstCandle);
      this.recalculateIndicators(monitor);
      return;
    }

    const lastCandleTime = DateTime.fromMillis(lastCandle.timestamp * 1000);
    const timeDiff = now.diff(lastCandleTime).as('minutes');

    // Create new 5-minute candle if needed
    if (timeDiff >= 5) {
      const newCandle: Candle = {
        timestamp: timestamp / 1000, // Convert to seconds
        open: lastCandle.close,
        high: price,
        low: price,
        close: price,
        volume: 0,
      };

      monitor.candles.push(newCandle);

      // Keep only last 200 candles for performance
      if (monitor.candles.length > 200) {
        monitor.candles.shift();
        monitor.indicatorHistory.shift();
      }

      // Recalculate indicators
      this.recalculateIndicators(monitor);
    } else {
      // Update current candle
      const currentCandle = monitor.candles[monitor.candles.length - 1];
      if (currentCandle) {
        currentCandle.high = Math.max(currentCandle.high, price);
        currentCandle.low = Math.min(currentCandle.low, price);
        currentCandle.close = price;

        // Recalculate indicators when candle updates (for real-time signal detection)
        if (monitor.candles.length >= this.MIN_CANDLES_FOR_ENTRY) {
          this.recalculateIndicators(monitor);
          // Note: checkSignals() is called after updateCandles() in updateTokenPrice()
          // This ensures signals are checked immediately after indicator recalculation
        }
      }
    }
  }

  /**
   * Recalculate indicators for all candles
   */
  private recalculateIndicators(monitor: TokenMonitor): void {
    monitor.indicatorHistory = [];
    let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};

    for (let i = 0; i < monitor.candles.length; i++) {
      const indicators = calculateIndicators(monitor.candles, i, previousEMAs);
      monitor.indicatorHistory.push(indicators);

      previousEMAs = {
        ema9: indicators.movingAverages.ema9,
        ema20: indicators.movingAverages.ema20,
        ema50: indicators.movingAverages.ema50,
      };
    }

    // Log indicator values for the latest candle
    if (monitor.indicatorHistory.length > 0) {
      const latest = monitor.indicatorHistory[monitor.indicatorHistory.length - 1];
      if (latest?.ichimoku) {
        const { tenkan, kijun } = latest.ichimoku;
        logger.debug('Indicators calculated', { tokenSymbol: monitor.tokenSymbol, tenkan, kijun });
      }
    }
  }

  /**
   * Check for Tenkan/Kijun cross signals
   * Checks immediately on every price update - no delay
   */
  private checkSignals(monitor: TokenMonitor): void {
    // Need at least 52 candles for Ichimoku calculation
    if (monitor.candles.length < this.MIN_CANDLES_FOR_ENTRY) {
      // Silently wait for more candles
      return;
    }

    const currentIndex = monitor.candles.length - 1;
    const previousIndex = currentIndex - 1;

    if (previousIndex < 0) return;

    const current = monitor.indicatorHistory[currentIndex];
    const previous = monitor.indicatorHistory[previousIndex];

    if (!current?.ichimoku || !previous?.ichimoku) return;

    const { tenkan, kijun } = current.ichimoku;
    const { tenkan: prevTenkan, kijun: prevKijun } = previous.ichimoku;

    // BUY SIGNAL: Tenkan crosses above Kijun
    if (!monitor.inPosition && !monitor.entrySignalSent) {
      const crossedUp = prevTenkan <= prevKijun && tenkan > kijun;

      if (crossedUp) {
        monitor.inPosition = true;
        monitor.entrySignalSent = true;
        monitor.entryPrice = monitor.lastPrice || current.candle.close;
        monitor.entryTime = Date.now();

        const alert: AlertEvent = {
          type: 'BUY',
          tokenAddress: monitor.tokenAddress,
          tokenSymbol: monitor.tokenSymbol,
          chain: monitor.chain,
          callerName: monitor.callerName,
          price: monitor.entryPrice,
          timestamp: monitor.entryTime,
          signal: 'Tenkan/Kijun Cross Up',
          tenkan,
          kijun,
        };

        this.emit('alert', alert);
        logger.info('BUY SIGNAL', {
          tokenSymbol: monitor.tokenSymbol,
          entryPrice: monitor.entryPrice,
          callerName: monitor.callerName,
        });
      }
    }

    // SELL SIGNAL: Tenkan crosses below Kijun (or price hits Kijun stop)
    if (monitor.inPosition && !monitor.exitSignalSent) {
      const crossedDown = prevTenkan >= prevKijun && tenkan < kijun;
      const priceHitStop = monitor.lastPrice && monitor.lastPrice <= kijun;

      if (crossedDown || priceHitStop) {
        monitor.inPosition = false;
        monitor.exitSignalSent = true;

        const exitPrice = monitor.lastPrice || current.candle.close;
        const pnl = monitor.entryPrice ? exitPrice / monitor.entryPrice : 1.0;

        const alert: AlertEvent = {
          type: 'SELL',
          tokenAddress: monitor.tokenAddress,
          tokenSymbol: monitor.tokenSymbol,
          chain: monitor.chain,
          callerName: monitor.callerName,
          price: exitPrice,
          timestamp: Date.now(),
          signal: crossedDown ? 'Tenkan/Kijun Cross Down' : 'Kijun Stop Loss',
          tenkan,
          kijun,
        };

        this.emit('alert', alert);
        logger.info('SELL SIGNAL', {
          tokenSymbol: monitor.tokenSymbol,
          exitPrice,
          pnl: ((pnl - 1) * 100).toFixed(2),
        });
      }
    }
  }

  /**
   * Start periodic updates (fallback if WebSocket fails)
   */
  private startPeriodicUpdates(): void {
    this.updateInterval = setInterval(async () => {
      // Poll prices for all monitored tokens
      for (const monitor of this.activeMonitors.values()) {
        try {
          await this.fetchPrice(monitor);
        } catch (error) {
          logger.error('Error fetching price', error as Error, {
            tokenSymbol: monitor.tokenSymbol,
          });
        }
      }
    }, this.PRICE_UPDATE_INTERVAL_MS);
  }

  /**
   * Fetch current price from Jupiter Swap API v1 (migrated from v6)
   * Jupiter provides price quotes for token pairs (works for both bonding curve and DEX tokens)
   * For graduated tokens on Pumpswap/DEX, Jupiter will route through available liquidity pools
   */
  private async fetchJupiterPrice(monitor: TokenMonitor): Promise<void> {
    try {
      // Jupiter Swap API v1 (new endpoint - migrated from v6)
      // https://lite-api.jup.ag/swap/v1/quote
      const jupiterUrl = `https://lite-api.jup.ag/swap/v1/quote`;

      // Get token decimals first (or use default 6 for Pump.fun tokens)
      const tokenDecimals = (await this.getTokenDecimals(monitor.tokenAddress)) || 6;

      // Quote 1 SOL -> Token to get token price
      const solAmount = 1_000_000_000; // 1 SOL (9 decimals)

      const response = await axios.get(jupiterUrl, {
        params: {
          inputMint: 'So11111111111111111111111111111111111111112', // SOL
          outputMint: monitor.tokenAddress,
          amount: solAmount.toString(),
          slippageBps: 50, // 0.5% slippage
          onlyDirectRoutes: false, // Allow routing through multiple DEXs
          asLegacyTransaction: false,
        },
        timeout: 5000,
      });

      if (response.data?.outAmount && response.data?.inAmount) {
        // Jupiter returns amounts in native token decimals
        const inAmount = Number(response.data.inAmount); // SOL amount (9 decimals)
        const outAmount = Number(response.data.outAmount); // Token amount (token decimals)

        if (outAmount > 0) {
          // Price per token in SOL = SOL amount / Token amount
          // Adjust for decimals: SOL has 9 decimals, token has tokenDecimals
          const solAmountNormalized = inAmount / 1e9; // Convert to SOL
          const tokenAmountNormalized = outAmount / Math.pow(10, tokenDecimals); // Convert to tokens
          const priceInSol = solAmountNormalized / tokenAmountNormalized;

          // Convert SOL price to USD
          const solPriceUsd = await this.getSolPriceUsd();
          const priceUsd = priceInSol * solPriceUsd;

          if (priceUsd > 0 && isFinite(priceUsd)) {
            logger.debug('Jupiter price fetched', {
              tokenSymbol: monitor.tokenSymbol,
              price: priceUsd,
            });
            this.updateTokenPrice(monitor, priceUsd, Date.now());
          }
        }
      }
    } catch (error: any) {
      // Silently fail - will retry on next interval
      if (error.response?.status !== 429) {
        // Token might not have liquidity yet, or Jupiter can't route
        // console.debug(`Jupiter price fetch failed for ${monitor.tokenSymbol}: ${error.message}`);
      }
    }
  }

  /**
   * Get token decimals (cache results)
   * Uses Jupiter Tokens API v2 (rate limited: 1 rps, 60 rpm)
   */
  private tokenDecimalsCache: Map<string, number> = new Map();
  private async getTokenDecimals(mint: string): Promise<number | null> {
    // Check cache first
    if (this.tokenDecimalsCache.has(mint)) {
      return this.tokenDecimalsCache.get(mint)!;
    }

    // Check rate limits before making request
    if (!this.canMakeJupiterTokensRequest()) {
      // Return default if rate limited (most Pump.fun tokens use 6 decimals)
      return 6;
    }

    try {
      // Fetch token info from Jupiter Tokens API v2
      // https://lite-api.jup.ag/tokens/v2/token/:mint
      // Rate limits: 1 rps, 60 rpm (no API key required)
      const response = await axios.get(`https://lite-api.jup.ag/tokens/v2/token/${mint}`, {
        timeout: 3000,
      });

      // Record request time for rate limiting
      const now = Date.now();
      this.jupiterTokensLastRequest = now;
      this.jupiterTokensRequestCount++;

      // Tokens API v2 response format: { "decimals": ... } or { "data": { "decimals": ... } }
      const decimals = response.data?.decimals || response.data?.data?.decimals || 6; // Default to 6 for Pump.fun tokens

      // Cache the result
      this.tokenDecimalsCache.set(mint, decimals);
      return decimals;
    } catch (error: any) {
      // If rate limited or error, use default and cache it
      const defaultDecimals = 6;
      this.tokenDecimalsCache.set(mint, defaultDecimals);

      if (error.response?.status === 429) {
        console.debug(`⚠️  Jupiter Tokens API rate limited for ${mint}, using default decimals`);
      }

      return defaultDecimals;
    }
  }

  /**
   * Check if we can make a Jupiter Tokens API request based on rate limits
   * Limits: 1 request per second, 60 requests per minute
   */
  private canMakeJupiterTokensRequest(): boolean {
    const now = Date.now();

    // Check 1 rps limit
    const timeSinceLastRequest = now - this.jupiterTokensLastRequest;
    if (timeSinceLastRequest < this.JUPITER_MIN_REQUEST_INTERVAL) {
      return false;
    }

    // Check 60 rpm limit
    const timeSinceWindowStart = now - this.jupiterTokensRequestWindowStart;
    if (timeSinceWindowStart >= 60 * 1000) {
      // Reset window if a minute has passed
      this.jupiterTokensRequestWindowStart = now;
      this.jupiterTokensRequestCount = 0;
    }

    if (this.jupiterTokensRequestCount >= this.JUPITER_MAX_REQUESTS_PER_MINUTE) {
      return false;
    }

    return true;
  }

  /**
   * Get SOL price in USD (cache for 1 minute)
   * Uses Jupiter Price API v3 (migrated from v2/v4)
   * Rate limits: 1 rps, 60 rpm (no API key required)
   */
  private solPriceCache: { price: number; timestamp: number } = { price: 150, timestamp: 0 };
  private async getSolPriceUsd(): Promise<number> {
    const now = Date.now();
    const cacheAge = 60 * 1000; // 1 minute cache

    // Return cached price if still valid
    if (this.solPriceCache.timestamp > now - cacheAge) {
      return this.solPriceCache.price;
    }

    // Check rate limits before making request
    if (!this.canMakeJupiterPriceRequest()) {
      // Return cached price if rate limited
      return this.solPriceCache.price || 150;
    }

    try {
      // Fetch SOL price from Jupiter Price API v3
      // https://lite-api.jup.ag/price/v3?ids=SOL
      // Rate limits: 1 rps, 60 rpm (no API key required)
      const response = await axios.get('https://lite-api.jup.ag/price/v3', {
        params: {
          ids: 'So11111111111111111111111111111111111111112', // SOL mint address
        },
        timeout: 3000,
      });

      // Record request time for rate limiting
      this.jupiterPriceLastRequest = now;
      this.jupiterPriceRequestCount++;

      // Price API v3 response format: { "SOL_MINT": { "price": ... } } (direct, not nested in data)
      const solMint = 'So11111111111111111111111111111111111111112';
      const price =
        response.data?.[solMint]?.price ||
        response.data?.data?.[solMint]?.price ||
        response.data?.data?.SOL?.price ||
        response.data?.SOL?.price ||
        response.data?.price ||
        150;

      this.solPriceCache = { price, timestamp: now };
      return price;
    } catch (error: any) {
      // If rate limited (429), extend cache time
      if (error.response?.status === 429) {
        // Note: mint is not available in this scope, use generic message
        logger.warn('Jupiter Price API rate limited, using cached price');
        // Extend cache by another minute
        this.solPriceCache.timestamp = now;
      }
      // Return cached price or default
      return this.solPriceCache.price || 150;
    }
  }

  /**
   * Check if we can make a Jupiter Price API request based on rate limits
   * Limits: 1 request per second, 60 requests per minute
   */
  private canMakeJupiterPriceRequest(): boolean {
    const now = Date.now();

    // Check 1 rps limit
    const timeSinceLastRequest = now - this.jupiterPriceLastRequest;
    if (timeSinceLastRequest < this.JUPITER_MIN_REQUEST_INTERVAL) {
      return false;
    }

    // Check 60 rpm limit
    const timeSinceWindowStart = now - this.jupiterPriceRequestWindowStart;
    if (timeSinceWindowStart >= 60 * 1000) {
      // Reset window if a minute has passed
      this.jupiterPriceRequestWindowStart = now;
      this.jupiterPriceRequestCount = 0;
    }

    if (this.jupiterPriceRequestCount >= this.JUPITER_MAX_REQUESTS_PER_MINUTE) {
      return false;
    }

    return true;
  }

  /**
   * Fetch current price from API (fallback - uses Jupiter)
   */
  private async fetchPrice(monitor: TokenMonitor): Promise<void> {
    await this.fetchJupiterPrice(monitor);
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached. Using polling mode.');
      return;
    }

    // Clean up existing connection before reconnecting
    this.cleanupWebSocket();

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info('Reconnecting', {
      delayMs: delay,
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
    });

    setTimeout(async () => {
      await this.connect();
    }, delay);
  }

  /**
   * Get active monitors count
   */
  public getActiveMonitorsCount(): number {
    return this.activeMonitors.size;
  }

  /**
   * Get status of all monitors (for debugging/verification)
   */
  public getMonitorStatus(): Array<{
    tokenSymbol: string;
    tokenAddress: string;
    candles: number;
    hasEnoughCandles: boolean;
    lastPrice?: number;
    lastUpdateTime?: number;
    indicatorsCalculated: boolean;
    tenkan?: number;
    kijun?: number;
  }> {
    const status: Array<{
      tokenSymbol: string;
      tokenAddress: string;
      candles: number;
      hasEnoughCandles: boolean;
      lastPrice?: number;
      lastUpdateTime?: number;
      indicatorsCalculated: boolean;
      tenkan?: number;
      kijun?: number;
    }> = [];

    for (const monitor of this.activeMonitors.values()) {
      const latestIndicator = monitor.indicatorHistory[monitor.indicatorHistory.length - 1];
      status.push({
        tokenSymbol: monitor.tokenSymbol,
        tokenAddress: monitor.tokenAddress,
        candles: monitor.candles.length,
        hasEnoughCandles: monitor.candles.length >= this.MIN_CANDLES_FOR_ENTRY,
        lastPrice: monitor.lastPrice,
        lastUpdateTime: monitor.lastUpdateTime,
        indicatorsCalculated: !!latestIndicator?.ichimoku,
        tenkan: latestIndicator?.ichimoku?.tenkan,
        kijun: latestIndicator?.ichimoku?.kijun,
      });
    }

    return status;
  }

  /**
   * Log current status of all monitors (for debugging)
   */
  public logStatus(): void {
    const status = this.getMonitorStatus();
    logger.info('Monitor Status', {
      activeCount: this.activeMonitors.size,
      monitors: status.map((s) => ({
        tokenSymbol: s.tokenSymbol,
        tokenAddress: s.tokenAddress.substring(0, 8),
        candles: s.candles,
        required: this.MIN_CANDLES_FOR_ENTRY,
        hasEnoughCandles: s.hasEnoughCandles,
        lastPrice: s.lastPrice,
        lastUpdateTime: s.lastUpdateTime,
        indicatorsCalculated: s.indicatorsCalculated,
        tenkan: s.tenkan,
        kijun: s.kijun,
      })),
    });
  }

  /**
   * Remove a monitor for a specific token
   */
  public async removeMonitor(tokenAddress: string, chain: string): Promise<void> {
    const key = `${chain}:${tokenAddress}`.toLowerCase();
    if (this.activeMonitors.has(key)) {
      this.activeMonitors.delete(key);
      logger.info('Removed monitor', { tokenAddress });
    }
  }

  /**
   * Add a token to monitor manually (alias for addMonitor)
   */
  public async addMonitor(
    tokenAddress: string,
    tokenSymbol: string,
    chain: string,
    callerName: string,
    alertTime: Date,
    alertPrice: number
  ): Promise<void> {
    await this.addToken(
      tokenAddress,
      tokenSymbol,
      chain,
      callerName,
      DateTime.fromJSDate(alertTime),
      alertPrice
    );
  }

  /**
   * Add a token to monitor manually
   */
  public async addToken(
    tokenAddress: string,
    tokenSymbol: string,
    chain: string,
    callerName: string,
    alertTime: DateTime,
    alertPrice: number
  ): Promise<void> {
    const key = `${chain}:${tokenAddress}`.toLowerCase();

    if (this.activeMonitors.has(key)) {
      logger.warn('Already monitoring token', { tokenSymbol });
      return;
    }

    // Start with empty candles - build from live stream
    const candles: Candle[] = [];
    const indicatorHistory: IndicatorData[] = [];
    const monitor: TokenMonitor = {
      tokenAddress,
      tokenSymbol,
      chain,
      callerName,
      alertTime,
      alertPrice,
      candles,
      indicatorHistory,
      entrySignalSent: false,
      exitSignalSent: false,
      inPosition: false,
    };

    this.activeMonitors.set(key, monitor);

    // Subscribe if connected
    if (this.useGrpc && this.grpcStream) {
      // Use the proper subscription method
      this.subscribeToBondingCurvesGrpc();
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.subscribeToAllTokens();
    }

    logger.info('Added token to monitoring', { tokenSymbol, tokenAddress, chain });
  }
}

export default TenkanKijunAlertService;
