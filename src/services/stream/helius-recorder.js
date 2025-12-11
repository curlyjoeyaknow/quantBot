"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.heliusStreamRecorder = exports.HeliusStreamRecorder = void 0;
const ws_1 = __importDefault(require("ws"));
const ohlcv_aggregator_1 = require("../aggregation/ohlcv-aggregator");
const clickhouse_client_1 = require("../../storage/clickhouse-client");
const database_1 = require("../../utils/database");
const logger_1 = require("../../utils/logger");
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
class HeliusStreamRecorder {
    constructor(options = {}) {
        this.ws = null;
        this.tickBuffer = new Map();
        this.tokenMeta = new Map();
        this.subscribedKeys = new Set();
        this.tickFlushTimer = null;
        this.watchlistTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.tickFlushInterval = options.tickFlushIntervalMs ?? 2000;
        this.watchlistRefreshInterval = options.watchlistRefreshMs ?? 5 * 60000;
    }
    async start() {
        if (!HELIUS_API_KEY) {
            logger_1.logger.warn('HELIUS_API_KEY not set; recorder disabled');
            return;
        }
        await this.refreshTrackedTokens();
        ohlcv_aggregator_1.ohlcvAggregator.start();
        this.startTickFlushLoop();
        this.startWatchlistRefreshLoop();
        await this.connect();
    }
    stop() {
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
        ohlcv_aggregator_1.ohlcvAggregator.stop();
    }
    trackToken(token) {
        const key = this.getTokenKey(token.mint, token.chain);
        this.tokenMeta.set(key, token);
        if (this.ws && this.ws.readyState === ws_1.default.OPEN && !this.subscribedKeys.has(key)) {
            this.subscribeToken(token, key);
        }
    }
    async connect() {
        logger_1.logger.info('HeliusStreamRecorder connecting to WebSocket...');
        return new Promise((resolve, reject) => {
            let settled = false;
            const finishResolve = () => {
                if (settled)
                    return;
                settled = true;
                resolve();
            };
            const finishReject = (error) => {
                if (settled)
                    return;
                settled = true;
                reject(error);
            };
            try {
                this.ws = new ws_1.default(HELIUS_WS_URL);
            }
            catch (error) {
                finishReject(error);
                return;
            }
            this.ws.on('open', () => {
                logger_1.logger.info('HeliusStreamRecorder connected');
                this.reconnectAttempts = 0;
                this.subscribeToTokens();
                finishResolve();
            });
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                }
                catch (error) {
                    logger_1.logger.error('Failed to parse Helius WS message', error);
                }
            });
            this.ws.on('close', () => {
                logger_1.logger.warn('HeliusStreamRecorder WebSocket closed');
                this.handleReconnect();
            });
            this.ws.on('error', (error) => {
                logger_1.logger.error('HeliusStreamRecorder WebSocket error', error);
                if (!settled) {
                    finishReject(error);
                }
                else {
                    this.handleReconnect();
                }
            });
        });
    }
    handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.logger.error('Recorder max reconnect attempts reached');
            return;
        }
        this.reconnectAttempts += 1;
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
        setTimeout(() => {
            void this.connect().catch((error) => logger_1.logger.error('Recorder reconnect attempt failed', error));
        }, delay);
    }
    subscribeToTokens() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            return;
        }
        const tokens = Array.from(this.tokenMeta.entries());
        tokens.forEach(([key, token]) => this.subscribeToken(token, key));
        logger_1.logger.info('Recorder subscribed to tokens', { tokenCount: tokens.length });
    }
    subscribeToken(token, key) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        if (this.subscribedKeys.has(key))
            return;
        const subscription = {
            jsonrpc: '2.0',
            id: this.subscribedKeys.size + 1,
            method: 'subscribe',
            params: [`price-updates-${token.chain.toLowerCase()}`, { accounts: [token.mint] }],
        };
        this.ws.send(JSON.stringify(subscription));
        this.subscribedKeys.add(key);
    }
    handleMessage(message) {
        if (!message)
            return;
        const method = message.method || message.type;
        if (method === 'price-update' || method === 'priceUpdate') {
            const params = message.params ?? message;
            const account = params.account || params.token || params.mint || params.accounts?.[0];
            const price = parseFloat(params.price ?? params.value ?? '0');
            const timestamp = params.timestamp
                ? Math.floor(params.timestamp / 1000)
                : Math.floor(Date.now() / 1000);
            const volume = Number(params.volume ?? params.size ?? 0);
            if (!account || !price)
                return;
            const tokenEntry = this.findTokenMeta(account);
            if (!tokenEntry)
                return;
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
    recordTick(token, tick) {
        const key = this.getTokenKey(token.mint, token.chain);
        if (!this.tickBuffer.has(key)) {
            this.tickBuffer.set(key, []);
        }
        this.tickBuffer.get(key).push(tick);
        ohlcv_aggregator_1.ohlcvAggregator.ingestTick(token.mint, token.chain, {
            timestamp: tick.timestamp,
            price: tick.price,
            volume: tick.size ?? 0,
        });
    }
    startTickFlushLoop() {
        if (this.tickFlushTimer)
            return;
        this.tickFlushTimer = setInterval(() => {
            void this.flushTickBuffers();
        }, this.tickFlushInterval);
    }
    async flushTickBuffers() {
        const flushTasks = [];
        for (const [key, ticks] of this.tickBuffer.entries()) {
            if (!ticks.length)
                continue;
            const [chain, mint] = key.split(':');
            this.tickBuffer.set(key, []);
            flushTasks.push((0, clickhouse_client_1.insertTicks)(mint, chain, ticks).catch((error) => {
                logger_1.logger.error('Failed to insert ticks', error, {
                    token: mint.substring(0, 20),
                    count: ticks.length,
                });
            }));
        }
        await Promise.all(flushTasks);
        // Flush completed buckets shortly after writing ticks
        await ohlcv_aggregator_1.ohlcvAggregator.flushCompletedBuckets(Date.now());
    }
    startWatchlistRefreshLoop() {
        if (this.watchlistTimer)
            return;
        this.watchlistTimer = setInterval(() => {
            void this.refreshTrackedTokens();
        }, this.watchlistRefreshInterval);
    }
    async refreshTrackedTokens() {
        try {
            const tracked = await (0, database_1.getTrackedTokens)();
            tracked.forEach((token) => {
                const key = this.getTokenKey(token.mint, token.chain);
                this.tokenMeta.set(key, token);
            });
            logger_1.logger.info('Recorder refreshed tracked tokens', { count: this.tokenMeta.size });
            if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
                this.subscribeToTokens();
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to refresh tracked tokens', error);
        }
    }
    findTokenMeta(account) {
        const lower = account.toLowerCase();
        for (const token of this.tokenMeta.values()) {
            if (token.mint.toLowerCase() === lower) {
                return token;
            }
        }
        return undefined;
    }
    getTokenKey(mint, chain) {
        return `${chain}:${mint}`;
    }
}
exports.HeliusStreamRecorder = HeliusStreamRecorder;
exports.heliusStreamRecorder = new HeliusStreamRecorder();
//# sourceMappingURL=helius-recorder.js.map