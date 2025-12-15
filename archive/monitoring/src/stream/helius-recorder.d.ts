import { type TrackedToken } from '@quantbot/utils';
interface RecorderOptions {
  tickFlushIntervalMs?: number;
  watchlistRefreshMs?: number;
}
export declare class HeliusStreamRecorder {
  private ws;
  private readonly tickBuffer;
  private readonly tokenMeta;
  private readonly subscribedKeys;
  private tickFlushTimer;
  private watchlistTimer;
  private readonly tickFlushInterval;
  private readonly watchlistRefreshInterval;
  private reconnectAttempts;
  private readonly maxReconnectAttempts;
  constructor(options?: RecorderOptions);
  start(): Promise<void>;
  stop(): void;
  trackToken(token: TrackedToken): void;
  private connect;
  private handleReconnect;
  private subscribeToTokens;
  private subscribeToken;
  private handleMessage;
  private recordTick;
  private startTickFlushLoop;
  private flushTickBuffers;
  private startWatchlistRefreshLoop;
  private refreshTrackedTokens;
  private findTokenMeta;
  private getTokenKey;
}
export declare const heliusStreamRecorder: HeliusStreamRecorder;
export {};
//# sourceMappingURL=helius-recorder.d.ts.map
