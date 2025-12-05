/**
 * Helius RPC Client
 * 
 * Provides optimized RPC connections to Helius endpoints with:
 * - Amsterdam/mainnet optimized endpoints
 * - Connection pooling
 * - Automatic failover
 * - Rate limiting and retry logic
 */

import {
  Connection,
  CommitmentLevel,
  Transaction,
  VersionedTransaction,
  BlockhashWithExpiryBlockHeight,
  SendOptions as SolanaSendOptions,
  SignatureStatus,
  RpcResponseAndContext,
} from '@solana/web3.js';
import { logger } from '@quantbot/utils';

export type HeliusRegion = 'amsterdam' | 'mainnet';

export interface HeliusRpcClientOptions {
  apiKey: string;
  region?: HeliusRegion;
  commitment?: CommitmentLevel;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface SendOptions {
  skipPreflight?: boolean;
  commitment?: CommitmentLevel;
  maxRetries?: number;
  preflightCommitment?: CommitmentLevel;
}

/**
 * Helius RPC Client with optimized endpoints and connection pooling
 */
export class HeliusRpcClient {
  private readonly apiKey: string;
  private readonly region: HeliusRegion;
  private readonly commitment: CommitmentLevel;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  
  private primaryConnection: Connection;
  private backupConnections: Connection[] = [];
  private currentConnectionIndex: number = 0;
  private readonly connections: Connection[] = [];

  // Rate limiting
  private readonly requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue: boolean = false;
  private readonly maxConcurrentRequests: number = 10;
  private activeRequests: number = 0;

  constructor(options: HeliusRpcClientOptions) {
    this.apiKey = options.apiKey;
    this.region = options.region || 'amsterdam';
    this.commitment = options.commitment || 'confirmed';
    this.timeout = options.timeout || 30_000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;

    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY is required');
    }

    // Initialize primary connection (Amsterdam optimized)
    const primaryUrl = this.getEndpointUrl(this.region);
    this.primaryConnection = new Connection(primaryUrl, {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: this.timeout,
    });

    // Initialize backup connections
    const backupUrl = this.getEndpointUrl('mainnet');
    this.backupConnections = [
      new Connection(backupUrl, {
        commitment: this.commitment,
        confirmTransactionInitialTimeout: this.timeout,
      }),
    ];

    this.connections = [this.primaryConnection, ...this.backupConnections];
  }

  /**
   * Get the endpoint URL for a given region
   */
  private getEndpointUrl(region: HeliusRegion): string {
    if (region === 'amsterdam') {
      // Amsterdam optimized endpoint
      return `https://rpc.helius.xyz/?api-key=${this.apiKey}`;
    } else {
      // Mainnet endpoint
      return `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    }
  }

  /**
   * Get the current active connection
   */
  getConnection(): Connection {
    return this.connections[this.currentConnectionIndex] || this.primaryConnection;
  }

  /**
   * Switch to backup connection on failure
   */
  private switchToBackup(): void {
    const nextIndex = (this.currentConnectionIndex + 1) % this.connections.length;
    this.currentConnectionIndex = nextIndex;
    logger.warn(`Switched to backup RPC connection (index: ${nextIndex})`);
  }

  /**
   * Execute a request with retry and failover logic
   */
  private async executeWithRetry<T>(
    operation: (connection: Connection) => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const connection = this.getConnection();
        const result = await Promise.race([
          operation(connection),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), this.timeout);
          }),
        ]);
        return result;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `${operationName} failed (attempt ${attempt + 1}/${this.maxRetries})`,
          error as Error
        );

        // Switch to backup connection
        this.switchToBackup();

        // Wait before retry
        if (attempt < this.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * (attempt + 1)));
        }
      }
    }

    throw new Error(
      `${operationName} failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Queue a request to respect rate limits
   */
  private async queueRequest<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  /**
   * Process the request queue with concurrency limits
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
      const operation = this.requestQueue.shift();
      if (!operation) break;

      this.activeRequests++;
      operation()
        .catch((error) => {
          logger.error('Queued request failed', error as Error);
        })
        .finally(() => {
          this.activeRequests--;
        });
    }

    this.isProcessingQueue = false;

    // Continue processing if there are more items
    if (this.requestQueue.length > 0) {
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Get the latest blockhash with expiry
   */
  async getLatestBlockhash(
    commitment?: CommitmentLevel
  ): Promise<BlockhashWithExpiryBlockHeight> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          return connection.getLatestBlockhash(commitment || this.commitment);
        },
        'getLatestBlockhash'
      )
    );
  }

  /**
   * Send a transaction
   */
  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    options?: SendOptions
  ): Promise<string> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          const sendOptions: SolanaSendOptions = {
            skipPreflight: options?.skipPreflight ?? false,
            preflightCommitment: options?.preflightCommitment || this.commitment,
            commitment: options?.commitment || this.commitment,
            maxRetries: options?.maxRetries || this.maxRetries,
          };

          const signature = await connection.sendTransaction(transaction, sendOptions);
          return signature;
        },
        'sendTransaction'
      )
    );
  }

  /**
   * Confirm a transaction
   */
  async confirmTransaction(
    signature: string,
    commitment?: CommitmentLevel
  ): Promise<RpcResponseAndContext<SignatureStatus>> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          return connection.confirmTransaction(signature, commitment || this.commitment);
        },
        'confirmTransaction'
      )
    );
  }

  /**
   * Get transaction status
   */
  async getSignatureStatus(
    signature: string
  ): Promise<RpcResponseAndContext<SignatureStatus | null>> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          return connection.getSignatureStatus(signature);
        },
        'getSignatureStatus'
      )
    );
  }

  /**
   * Get account balance
   */
  async getBalance(publicKey: string): Promise<number> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          const { PublicKey } = await import('@solana/web3.js');
          const pubkey = new PublicKey(publicKey);
          const balance = await connection.getBalance(pubkey);
          return balance;
        },
        'getBalance'
      )
    );
  }

  /**
   * Simulate a transaction
   */
  async simulateTransaction(
    transaction: Transaction | VersionedTransaction,
    commitment?: CommitmentLevel
  ): Promise<any> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          return connection.simulateTransaction(transaction, {
            commitment: commitment || this.commitment,
          });
        },
        'simulateTransaction'
      )
    );
  }

  /**
   * Get account info
   */
  async getAccountInfo(publicKey: string): Promise<any> {
    return this.queueRequest(() =>
      this.executeWithRetry(
        async (connection) => {
          const { PublicKey } = await import('@solana/web3.js');
          const pubkey = new PublicKey(publicKey);
          const accountInfo = await connection.getAccountInfo(pubkey);
          return accountInfo;
        },
        'getAccountInfo'
      )
    );
  }
}

/**
 * Create a HeliusRpcClient instance
 */
export function createHeliusRpcClient(
  apiKey?: string,
  region?: HeliusRegion
): HeliusRpcClient {
  const key = apiKey || process.env.HELIUS_API_KEY || '';
  if (!key) {
    throw new Error('HELIUS_API_KEY is required. Set it in environment variables or pass it as parameter.');
  }

  return new HeliusRpcClient({
    apiKey: key,
    region: region || (process.env.HELIUS_RPC_REGION as HeliusRegion) || 'amsterdam',
    commitment: 'confirmed',
    timeout: 30_000,
    maxRetries: 3,
    retryDelay: 1000,
  });
}

