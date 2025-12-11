import WebSocket from 'ws';
import { ohlcvAggregator } from '../aggregation/ohlcv-aggregator';
import { insertTicks, type TickEvent } from '@quantbot/data';
import { logger, getTrackedTokens, type TrackedToken } from '@quantbot/utils';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

interface RecorderOptions {
  tickFlushIntervalMs?: number;
  watchlistRefreshMs?: number;
}

export class HeliusStreamRecorder {
  private ws: WebSocket | null = null;
  private readonly tickBuffer: Map<string, TickEvent[]> = new Map();
  private readonly tokenMeta: Map<string, TrackedToken> = new Map();
  private readonly subscribedKeys: Set<string> = new Set();
  private tickFlushTimer: NodeJS.Timeout | null = null;
  private watchlistTimer: NodeJS.Timeout | null = null;
  private readonly tickFlushInterval: number;
  private readonly watchlistRefreshInterval: number;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;

  constructor(options: RecorderOptions = {}) {
    this.tickFlushInterval = options.tickFlushIntervalMs ?? 2_000;
    this.watchlistRefreshInterval = options.watchlistRefreshMs ?? 5 * 60_000;
  }

  async start(): Promise<void> {
    if (!HELIUS_API_KEY) {
      logger.warn('HELIUS_API_KEY not set; recorder disabled');
      return;
    }

    await this.refreshTrackedTokens();
    ohlcvAggregator.start();
    this.startTickFlushLoop();
    this.startWatchlistRefreshLoop();
    await this.connect();
  }

  stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.tickFlushTimer) {
      clearInterval(this.tickFlushTimer);
      this.tickFlushTimer = null;
    }
    if (this.watchlistTimer) {
      clearInterval(this.watchlistTimer);
      this.watchlistTimer = null;
    }
    ohlcvAggregator.stop();
  }

  public trackToken(token: TrackedToken): void {
    const key = this.getTokenKey(token.mint, token.chain);
    this.tokenMeta.set(key, token);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.subscribedKeys.has(key)) {
      this.subscribeToken(token, key);
    }
  }

  private async connect(): Promise<void> {
    logger.info('HeliusStreamRecorder connecting to WebSocket...');

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        this.ws = new WebSocket(HELIUS_WS_URL);
      } catch (error) {
        finishReject(error as Error);
        return;
      }

      this.ws.on('open', () => {
        logger.info('HeliusStreamRecorder connected');
        this.reconnectAttempts = 0;
        this.subscribeToTokens();
        finishResolve();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error('Failed to parse Helius WS message', error as Error);
        }
      });

      this.ws.on('close', () => {
        logger.warn('HeliusStreamRecorder WebSocket closed');
        this.handleReconnect();
      });

      this.ws.on('error', (error: Error) => {
        logger.error('HeliusStreamRecorder WebSocket error', error);
        if (!settled) {
          finishReject(error);
        } else {
          this.handleReconnect();
        }
      });
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Recorder max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    setTimeout(() => {
      void this.connect().catch((error) =>
        logger.error('Recorder reconnect attempt failed', error as Error)
      );
    }, delay);
  }

  private subscribeToTokens(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const tokens = Array.from(this.tokenMeta.entries());
    tokens.forEach(([key, token]) => this.subscribeToken(token, key));

    logger.info('Recorder subscribed to tokens', { tokenCount: tokens.length });
  }

  private subscribeToken(token: TrackedToken, key: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedKeys.has(key)) return;

    const subscription = {
      jsonrpc: '2.0',
      id: this.subscribedKeys.size + 1,
      method: 'subscribe',
      params: [`price-updates-${token.chain.toLowerCase()}`, { accounts: [token.mint] }],
    };
    this.ws.send(JSON.stringify(subscription));
    this.subscribedKeys.add(key);
  }

  private handleMessage(message: any): void {
    if (!message) return;
    const method = message.method || message.type;
    if (method === 'price-update' || method === 'priceUpdate') {
      const params = message.params ?? message;
      const account =
        params.account || params.token || params.mint || params.accounts?.[0];
      const price = parseFloat(params.price ?? params.value ?? '0');
      const timestamp = params.timestamp
        ? Math.floor(params.timestamp / 1000)
        : Math.floor(Date.now() / 1000);
      const volume = Number(params.volume ?? params.size ?? 0);

      if (!account || !price) return;

      const tokenEntry = this.findTokenMeta(account);
      if (!tokenEntry) return;

      this.recordTick(tokenEntry, {
        timestamp,
        price,
        size: volume,
        signature: params.signature,
        slot: params.slot,
        source: 'ws',
      });
    }
  }

  private recordTick(token: TrackedToken, tick: TickEvent): void {
    const key = this.getTokenKey(token.mint, token.chain);
    if (!this.tickBuffer.has(key)) {
      this.tickBuffer.set(key, []);
    }
    this.tickBuffer.get(key)!.push(tick);
    ohlcvAggregator.ingestTick(token.mint, token.chain, {
      timestamp: tick.timestamp,
      price: tick.price,
      volume: tick.size ?? 0,
    });
  }

  private startTickFlushLoop(): void {
    if (this.tickFlushTimer) return;
    this.tickFlushTimer = setInterval(() => {
      void this.flushTickBuffers();
    }, this.tickFlushInterval);
  }

  private async flushTickBuffers(): Promise<void> {
    const flushTasks: Array<Promise<void>> = [];

    for (const [key, ticks] of this.tickBuffer.entries()) {
      if (!ticks.length) continue;
      const [chain, mint] = key.split(':');
      this.tickBuffer.set(key, []);
      flushTasks.push(
        insertTicks(mint, chain, ticks).catch((error: unknown) => {
          logger.error('Failed to insert ticks', error as Error, {
            token: mint.substring(0, 20),
            count: ticks.length,
          });
        })
      );
    }

    await Promise.all(flushTasks);
    // Flush completed buckets shortly after writing ticks
    await ohlcvAggregator.flushCompletedBuckets(Date.now());
  }

  private startWatchlistRefreshLoop(): void {
    if (this.watchlistTimer) return;
    this.watchlistTimer = setInterval(() => {
      void this.refreshTrackedTokens();
    }, this.watchlistRefreshInterval);
  }

  private async refreshTrackedTokens(): Promise<void> {
    try {
      const tracked = await getTrackedTokens();
      tracked.forEach((token) => {
        const key = this.getTokenKey(token.mint, token.chain);
        this.tokenMeta.set(key, token);
      });
      logger.info('Recorder refreshed tracked tokens', { count: this.tokenMeta.size });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.subscribeToTokens();
      }
    } catch (error) {
      logger.error('Failed to refresh tracked tokens', error as Error);
    }
  }

  private findTokenMeta(account: string): TrackedToken | undefined {
    const lower = account.toLowerCase();
    for (const token of this.tokenMeta.values()) {
      if (token.mint.toLowerCase() === lower) {
        return token;
      }
    }
    return undefined;
  }

  private getTokenKey(mint: string, chain: string): string {
    return `${chain}:${mint}`;
  }
}

export const heliusStreamRecorder = new HeliusStreamRecorder();


