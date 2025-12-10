"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pumpfunLifecycleTracker = exports.PumpfunLifecycleTracker = void 0;
const ws_1 = __importDefault(require("ws"));
const luxon_1 = require("luxon");
const logger_1 = require("../../utils/logger");
const helius_client_1 = require("../../api/helius-client");
const pumpfun_1 = require("../../utils/pumpfun");
const database_1 = require("../../utils/database");
const helius_recorder_1 = require("../stream/helius-recorder");
const helius_backfill_service_1 = require("../backfill/helius-backfill-service");
const PUMP_PROGRAM = pumpfun_1.PUMP_FUN_PROGRAM_ID.toBase58();
let YellowstoneGrpcClient = null;
let CommitmentLevel = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const yellowstone = require('@triton-one/yellowstone-grpc');
    YellowstoneGrpcClient =
        yellowstone.default || yellowstone.YellowstoneGrpcClient || yellowstone;
    CommitmentLevel = yellowstone.CommitmentLevel;
}
catch (error) {
    logger_1.logger.warn('Yellowstone gRPC package not available. Install with `npm install @triton-one/yellowstone-grpc` to enable deterministic streaming.');
}
class PumpfunLifecycleTracker {
    constructor() {
        this.ws = null;
        this.processedSignatures = new Set();
        this.grpcClient = null;
        this.grpcStream = null;
        this.reconnectTimer = null;
        this.yellowstoneUrl = process.env.YELLOWSTONE_GRPC_URL;
        this.yellowstoneToken =
            process.env.YELLOWSTONE_X_TOKEN ||
                process.env.YELLOWSTONE_API_TOKEN ||
                process.env.YELLOWSTONE_AUTH_TOKEN;
        this.useGrpc = Boolean(YellowstoneGrpcClient && this.yellowstoneUrl);
    }
    async start() {
        if (this.useGrpc) {
            await this.connectGrpc();
            return;
        }
        if (!process.env.HELIUS_API_KEY) {
            logger_1.logger.info('Pumpfun tracker disabled - set HELIUS_API_KEY or YELLOWSTONE_GRPC_URL');
            return;
        }
        await this.connectWebSocket();
    }
    stop() {
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
    async connectGrpc() {
        if (!this.yellowstoneUrl || !YellowstoneGrpcClient) {
            await this.connectWebSocket();
            return;
        }
        try {
            logger_1.logger.info('PumpfunLifecycleTracker connecting to Yellowstone gRPC stream...');
            let ClientCtor = YellowstoneGrpcClient;
            if (YellowstoneGrpcClient.YellowstoneGrpcClient) {
                ClientCtor = YellowstoneGrpcClient.YellowstoneGrpcClient;
            }
            this.grpcClient = new ClientCtor(this.yellowstoneUrl, this.yellowstoneToken);
            this.grpcStream = await this.grpcClient.subscribe();
            this.grpcStream.on('data', (data) => {
                this.handleGrpcMessage(data);
            });
            this.grpcStream.on('error', (error) => {
                logger_1.logger.error('Pumpfun Yellowstone stream error', error);
                this.scheduleReconnect();
            });
            this.grpcStream.on('end', () => {
                logger_1.logger.warn('Pumpfun Yellowstone stream closed');
                this.scheduleReconnect();
            });
            this.grpcStream.write(this.buildGrpcSubscription());
            logger_1.logger.info('PumpfunLifecycleTracker subscribed via Yellowstone gRPC');
        }
        catch (error) {
            logger_1.logger.error('Failed to connect to Yellowstone gRPC. Falling back to Helius WebSocket.', error);
            await this.connectWebSocket();
        }
    }
    buildGrpcSubscription() {
        const commitment = (CommitmentLevel && CommitmentLevel.PROCESSED) !== undefined
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
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
            void this.connectGrpc();
        }, 2000);
    }
    async connectWebSocket() {
        logger_1.logger.info('PumpfunLifecycleTracker connecting to Helius logs stream...');
        this.ws = new ws_1.default(`wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);
        this.ws.on('open', () => {
            logger_1.logger.info('PumpfunLifecycleTracker connected');
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
        this.ws.on('message', (data) => {
            try {
                const payload = JSON.parse(data.toString());
                if (payload.method === 'logsNotification') {
                    this.handleLogsNotification(payload.params?.result?.value);
                }
            }
            catch (error) {
                logger_1.logger.error('Pumpfun tracker failed to parse message', error);
            }
        });
        this.ws.on('close', () => {
            logger_1.logger.warn('Pumpfun tracker WebSocket closed, reconnecting...');
            setTimeout(() => {
                void this.connectWebSocket();
            }, 2000);
        });
        this.ws.on('error', (error) => {
            logger_1.logger.error('Pumpfun tracker WebSocket error', error);
        });
    }
    handleLogsNotification(value) {
        if (!value)
            return;
        const signature = value.signature;
        if (!signature || this.processedSignatures.has(signature)) {
            return;
        }
        const logs = value.logs || [];
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
    handleGrpcMessage(message) {
        if (!message?.transaction)
            return;
        const txWrapper = message.transaction;
        const signature = txWrapper.signature ||
            txWrapper.transaction?.signatures?.[0];
        if (!signature || this.processedSignatures.has(signature)) {
            return;
        }
        const logs = txWrapper.meta?.logMessages || [];
        const timestamp = txWrapper.blockTime || txWrapper.timestamp || Math.floor(Date.now() / 1000);
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
    async processLaunch(signature, timestamp, tx) {
        try {
            const txData = tx ?? (await this.fetchTransaction(signature));
            if (!txData)
                return;
            const mint = this.extractPrimaryMint(txData);
            if (!mint)
                return;
            const bondingCurve = (0, pumpfun_1.derivePumpfunBondingCurve)(mint);
            const metadata = this.extractMetadata(txData);
            const creator = txData.feePayer ||
                txData.accountData?.feePayer ||
                txData.transaction?.message?.accountKeys?.[0] ||
                metadata?.creator;
            const record = {
                mint,
                creator: creator ?? undefined,
                bondingCurve: bondingCurve ?? undefined,
                launchSignature: signature,
                launchTimestamp: timestamp,
                isGraduated: false,
                metadata,
            };
            await (0, database_1.upsertPumpfunToken)(record);
            const trackedToken = {
                mint,
                chain: 'solana',
                tokenName: metadata?.name,
                tokenSymbol: metadata?.symbol,
                firstSeen: timestamp,
                source: 'pumpfun_launch',
            };
            helius_recorder_1.heliusStreamRecorder.trackToken(trackedToken);
            const job = {
                mint,
                chain: 'solana',
                startTime: luxon_1.DateTime.fromSeconds(Math.max(0, timestamp - 600)),
                endTime: luxon_1.DateTime.fromSeconds(timestamp),
                priority: 3,
            };
            helius_backfill_service_1.heliusBackfillService.enqueue(job);
            logger_1.logger.info('Pump.fun launch detected', { mint: mint.substring(0, 8), signature });
        }
        catch (error) {
            logger_1.logger.error('Failed to process pumpfun launch', error, { signature });
        }
    }
    async processGraduation(signature, timestamp, tx) {
        try {
            const txData = tx ?? (await this.fetchTransaction(signature));
            if (!txData)
                return;
            const mint = this.extractPrimaryMint(txData);
            if (!mint)
                return;
            await (0, database_1.markPumpfunGraduated)(mint, {
                graduationSignature: signature,
                graduationTimestamp: timestamp,
            });
            helius_recorder_1.heliusStreamRecorder.trackToken({
                mint,
                chain: 'solana',
                firstSeen: timestamp,
                source: 'pumpfun_graduated',
            });
            logger_1.logger.info('Pump.fun graduation detected', { mint: mint.substring(0, 8), signature });
        }
        catch (error) {
            logger_1.logger.error('Failed to process pumpfun graduation', error, { signature });
        }
    }
    async fetchTransaction(signature) {
        try {
            const txs = await helius_client_1.heliusRestClient.getTransactions([signature]);
            return txs[0] || null;
        }
        catch {
            return null;
        }
    }
    extractPrimaryMint(tx) {
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
                if (balance?.mint &&
                    balance.mint !== 'So11111111111111111111111111111111111111112') {
                    return balance.mint;
                }
            }
        }
        const instructions = tx?.instructions || [];
        for (const instruction of instructions) {
            if (instruction.accounts && Array.isArray(instruction.accounts)) {
                const candidate = instruction.accounts.find((account) => account.length === 44);
                if (candidate) {
                    return candidate;
                }
            }
        }
        const messageInstructions = tx?.transaction?.message?.instructions;
        if (Array.isArray(messageInstructions)) {
            for (const instruction of messageInstructions) {
                if (instruction.accounts && Array.isArray(instruction.accounts)) {
                    const candidate = instruction.accounts.find((account) => typeof account === 'string' && account.length >= 32);
                    if (candidate) {
                        return candidate;
                    }
                }
            }
        }
        return null;
    }
    extractMetadata(tx) {
        const metadata = {};
        const transfer = tx?.tokenTransfers?.[0];
        if (transfer) {
            if (transfer.tokenName)
                metadata.name = transfer.tokenName;
            if (transfer.tokenSymbol)
                metadata.symbol = transfer.tokenSymbol;
        }
        if (tx?.events?.mint?.name) {
            metadata.name = tx.events.mint.name;
        }
        if (tx?.events?.mint?.symbol) {
            metadata.symbol = tx.events.mint.symbol;
        }
        if (tx?.meta?.postTokenBalances) {
            const balance = tx.meta.postTokenBalances.find((entry) => entry?.mint && entry.mint !== 'So11111111111111111111111111111111111111112');
            if (balance?.owner) {
                metadata.creator = balance.owner;
            }
            if (balance?.uiTokenAmount?.symbol && !metadata.symbol) {
                metadata.symbol = balance.uiTokenAmount.symbol;
            }
        }
        if (tx?.feePayer) {
            metadata.creator = tx.feePayer;
        }
        else if (tx?.transaction?.message?.accountKeys) {
            metadata.creator = tx.transaction.message.accountKeys[0];
        }
        return Object.keys(metadata).length > 0 ? metadata : null;
    }
    isLaunchLog(logs) {
        return logs.some((log) => /Instruction:\s?(Create|Initialize|NewPump)/i.test(log));
    }
    isGraduationLog(logs) {
        return logs.some((log) => /Instruction:\s?(Migrate|Complete|SellToDex)/i.test(log));
    }
}
exports.PumpfunLifecycleTracker = PumpfunLifecycleTracker;
exports.pumpfunLifecycleTracker = new PumpfunLifecycleTracker();
//# sourceMappingURL=pumpfun-lifecycle-tracker.js.map