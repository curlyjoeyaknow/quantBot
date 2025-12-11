import WebSocket from 'ws';
import { DateTime } from 'luxon';
import { logger, derivePumpfunBondingCurve, PUMP_FUN_PROGRAM_ID, upsertPumpfunToken, markPumpfunGraduated, type PumpfunTokenRecord, type TrackedToken } from '@quantbot/utils';
import { heliusStreamRecorder } from '../stream/helius-recorder';
import { heliusBackfillService, type BackfillJob } from '../backfill/helius-backfill-service';
import { heliusRestClient } from '@quantbot/data';

const PUMP_PROGRAM = PUMP_FUN_PROGRAM_ID.toBase58();

let YellowstoneGrpcClient: any = null;
let CommitmentLevel: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
  const yellowstone = require('@triton-one/yellowstone-grpc');
  YellowstoneGrpcClient =
    yellowstone.default || yellowstone.YellowstoneGrpcClient || yellowstone;
  CommitmentLevel = yellowstone.CommitmentLevel;
} catch (error) {
  logger.warn(
    'Yellowstone gRPC package not available. Install with `npm install @triton-one/yellowstone-grpc` to enable deterministic streaming.'
  );
}

export class PumpfunLifecycleTracker {
  private ws: WebSocket | null = null;
  private readonly processedSignatures: Set<string> = new Set();
  private grpcClient: any = null;
  private grpcStream: any = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly yellowstoneUrl?: string;
  private readonly yellowstoneToken?: string;
  private readonly useGrpc: boolean;

  constructor() {
    this.yellowstoneUrl = process.env.YELLOWSTONE_GRPC_URL;
    this.yellowstoneToken =
      process.env.YELLOWSTONE_X_TOKEN ||
      process.env.YELLOWSTONE_API_TOKEN ||
      process.env.YELLOWSTONE_AUTH_TOKEN;
    this.useGrpc = Boolean(YellowstoneGrpcClient && this.yellowstoneUrl);
  }

  async start(): Promise<void> {
    if (this.useGrpc) {
      await this.connectGrpc();
      return;
    }

    if (!process.env.HELIUS_API_KEY) {
      logger.info('Pumpfun tracker disabled - set HELIUS_API_KEY or YELLOWSTONE_GRPC_URL');
      return;
    }

    await this.connectWebSocket();
  }

  stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.grpcStream) {
      this.grpcStream.end();
      this.grpcStream = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async connectGrpc(): Promise<void> {
    if (!this.yellowstoneUrl || !YellowstoneGrpcClient) {
      await this.connectWebSocket();
      return;
    }

    try {
      logger.info('PumpfunLifecycleTracker connecting to Yellowstone gRPC stream...');
      let ClientCtor = YellowstoneGrpcClient;
      if (YellowstoneGrpcClient.YellowstoneGrpcClient) {
        ClientCtor = YellowstoneGrpcClient.YellowstoneGrpcClient;
      }

      this.grpcClient = new ClientCtor(this.yellowstoneUrl, this.yellowstoneToken);
      this.grpcStream = await this.grpcClient.subscribe();

      this.grpcStream.on('data', (data: any) => {
        this.handleGrpcMessage(data);
      });

      this.grpcStream.on('error', (error: any) => {
        logger.error('Pumpfun Yellowstone stream error', error as Error);
        this.scheduleReconnect();
      });

      this.grpcStream.on('end', () => {
        logger.warn('Pumpfun Yellowstone stream closed');
        this.scheduleReconnect();
      });

      this.grpcStream.write(this.buildGrpcSubscription());
      logger.info('PumpfunLifecycleTracker subscribed via Yellowstone gRPC');
    } catch (error) {
      logger.error('Failed to connect to Yellowstone gRPC. Falling back to Helius WebSocket.', error as Error);
      await this.connectWebSocket();
    }
  }

  private buildGrpcSubscription(): any {
    const commitment =
      (CommitmentLevel && CommitmentLevel.PROCESSED) !== undefined
        ? CommitmentLevel.PROCESSED
        : 0;

    return {
      accounts: {},
      slots: {},
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment,
      accountsDataSlice: [],
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      void this.connectGrpc();
    }, 2000);
  }

  private async connectWebSocket(): Promise<void> {
    logger.info('PumpfunLifecycleTracker connecting to Helius logs stream...');
    this.ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);

    this.ws.on('open', () => {
      logger.info('PumpfunLifecycleTracker connected');
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          {
            mentions: [PUMP_PROGRAM],
          },
          {
            commitment: 'confirmed',
          },
        ],
      };
      this.ws?.send(JSON.stringify(request));
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.method === 'logsNotification') {
          this.handleLogsNotification(payload.params?.result?.value);
        }
      } catch (error) {
        logger.error('Pumpfun tracker failed to parse message', error as Error);
      }
    });

    this.ws.on('close', () => {
      logger.warn('Pumpfun tracker WebSocket closed, reconnecting...');
      setTimeout(() => {
        void this.connectWebSocket();
      }, 2000);
    });

    this.ws.on('error', (error) => {
      logger.error('Pumpfun tracker WebSocket error', error as Error);
    });
  }

  private handleLogsNotification(value: any): void {
    if (!value) return;
    const signature: string | undefined = value.signature;
    if (!signature || this.processedSignatures.has(signature)) {
      return;
    }

    const logs: string[] = value.logs || [];
    const timestamp = value.timestamp ? Number(value.timestamp) : Math.floor(Date.now() / 1000);

    if (this.isLaunchLog(logs)) {
      this.processedSignatures.add(signature);
      void this.processLaunch(signature, timestamp);
      return;
    }

    if (this.isGraduationLog(logs)) {
      this.processedSignatures.add(signature);
      void this.processGraduation(signature, timestamp);
    }
  }

  private handleGrpcMessage(message: any): void {
    if (!message?.transaction) return;

    const txWrapper = message.transaction;
    const signature: string | undefined =
      txWrapper.signature ||
      txWrapper.transaction?.signatures?.[0];

    if (!signature || this.processedSignatures.has(signature)) {
      return;
    }

    const logs: string[] = txWrapper.meta?.logMessages || [];
    const timestamp =
      txWrapper.blockTime || txWrapper.timestamp || Math.floor(Date.now() / 1000);

    if (this.isLaunchLog(logs)) {
      this.processedSignatures.add(signature);
      void this.processLaunch(signature, timestamp, txWrapper);
      return;
    }

    if (this.isGraduationLog(logs)) {
      this.processedSignatures.add(signature);
      void this.processGraduation(signature, timestamp, txWrapper);
    }
  }

  private async processLaunch(signature: string, timestamp: number, tx?: any): Promise<void> {
    try {
      const txData = tx ?? (await this.fetchTransaction(signature));
      if (!txData) return;
      const mint = this.extractPrimaryMint(txData);
      if (!mint) return;

      const bondingCurve = derivePumpfunBondingCurve(mint);
      const metadata = this.extractMetadata(txData);
      const creator =
        txData.feePayer ||
        txData.accountData?.feePayer ||
        txData.transaction?.message?.accountKeys?.[0] ||
        metadata?.creator;

      const tokenName = metadata && typeof metadata.name === 'string' ? metadata.name : undefined;
      const tokenSymbol = metadata && typeof metadata.symbol === 'string' ? metadata.symbol : undefined;

      const record: PumpfunTokenRecord = {
        mint,
        creator: creator ?? undefined,
        bondingCurve: bondingCurve ?? undefined,
        launchSignature: signature,
        launchTimestamp: timestamp,
        isGraduated: false,
        metadata,
      };

      await upsertPumpfunToken(record);

      const trackedToken: TrackedToken = {
        mint,
        chain: 'solana',
        tokenName,
        tokenSymbol,
        firstSeen: timestamp,
        source: 'pumpfun_launch',
      };

      heliusStreamRecorder.trackToken(trackedToken);
      const job: BackfillJob = {
        mint,
        chain: 'solana',
        startTime: DateTime.fromSeconds(Math.max(0, timestamp - 600)),
        endTime: DateTime.fromSeconds(timestamp),
        priority: 3,
      };
      heliusBackfillService.enqueue(job);

      logger.info('Pump.fun launch detected', { mint: mint.substring(0, 8), signature });
    } catch (error) {
      logger.error('Failed to process pumpfun launch', error as Error, { signature });
    }
  }

  private async processGraduation(signature: string, timestamp: number, tx?: any): Promise<void> {
    try {
      const txData = tx ?? (await this.fetchTransaction(signature));
      if (!txData) return;
      const mint = this.extractPrimaryMint(txData);
      if (!mint) return;

      await markPumpfunGraduated(mint, {
        graduationSignature: signature,
        graduationTimestamp: timestamp,
      });

      heliusStreamRecorder.trackToken({
        mint,
        chain: 'solana',
        firstSeen: timestamp,
        source: 'pumpfun_graduated',
      });

      logger.info('Pump.fun graduation detected', { mint: mint.substring(0, 8), signature });
    } catch (error) {
      logger.error('Failed to process pumpfun graduation', error as Error, { signature });
    }
  }

  private async fetchTransaction(signature: string): Promise<any | null> {
    try {
      const txs = await heliusRestClient.getTransactions([signature]);
      return txs[0] || null;
    } catch {
      return null;
    }
  }

  private extractPrimaryMint(tx: any): string | null {
    const transfers = tx?.tokenTransfers || [];
    for (const transfer of transfers) {
      if (transfer.mint && transfer.mint !== 'So11111111111111111111111111111111111111112') {
        return transfer.mint;
      }
    }

    if (tx?.events?.mint?.mint) {
      return tx.events.mint.mint;
    }

    const postBalances = tx?.meta?.postTokenBalances;
    if (Array.isArray(postBalances)) {
      for (const balance of postBalances) {
        if (
          balance?.mint &&
          balance.mint !== 'So11111111111111111111111111111111111111112'
        ) {
          return balance.mint;
        }
      }
    }

    const instructions = tx?.instructions || [];
    for (const instruction of instructions) {
      if (instruction.accounts && Array.isArray(instruction.accounts)) {
        const candidate = instruction.accounts.find((account: string) => account.length === 44);
        if (candidate) {
          return candidate;
        }
      }
    }

    const messageInstructions = tx?.transaction?.message?.instructions;
    if (Array.isArray(messageInstructions)) {
      for (const instruction of messageInstructions) {
        if (instruction.accounts && Array.isArray(instruction.accounts)) {
          const candidate = instruction.accounts.find(
            (account: string) => typeof account === 'string' && account.length >= 32
          );
          if (candidate) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  private extractMetadata(tx: any): Record<string, unknown> | null {
    const metadata: Record<string, unknown> = {};
    const transfer = tx?.tokenTransfers?.[0];
    if (transfer) {
      if (transfer.tokenName) metadata.name = transfer.tokenName;
      if (transfer.tokenSymbol) metadata.symbol = transfer.tokenSymbol;
    }
    if (tx?.events?.mint?.name) {
      metadata.name = tx.events.mint.name;
    }
    if (tx?.events?.mint?.symbol) {
      metadata.symbol = tx.events.mint.symbol;
    }
    if (tx?.meta?.postTokenBalances) {
      const balance = tx.meta.postTokenBalances.find(
        (entry: any) =>
          entry?.mint && entry.mint !== 'So11111111111111111111111111111111111111112'
      );
      if (balance?.owner) {
        metadata.creator = balance.owner;
      }
      if (balance?.uiTokenAmount?.symbol && !metadata.symbol) {
        metadata.symbol = balance.uiTokenAmount.symbol;
      }
    }
    if (tx?.feePayer) {
      metadata.creator = tx.feePayer;
    } else if (tx?.transaction?.message?.accountKeys) {
      metadata.creator = tx.transaction.message.accountKeys[0];
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private isLaunchLog(logs: string[]): boolean {
    return logs.some((log) => /Instruction:\s?(Create|Initialize|NewPump)/i.test(log));
  }

  private isGraduationLog(logs: string[]): boolean {
    return logs.some((log) => /Instruction:\s?(Migrate|Complete|SellToDex)/i.test(log));
  }
}

export const pumpfunLifecycleTracker = new PumpfunLifecycleTracker();

