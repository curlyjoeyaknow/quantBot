"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.heliusBackfillService = exports.HeliusBackfillService = void 0;
const helius_client_1 = require("../../api/helius-client");
const clickhouse_client_1 = require("../../storage/clickhouse-client");
const ohlcv_aggregator_1 = require("../aggregation/ohlcv-aggregator");
const logger_1 = require("../../utils/logger");
const CREDIT_PER_CALL = 100;
const MONTHLY_CREDIT_LIMIT = Number(process.env.HELIUS_CREDIT_LIMIT ?? '5000000') || 5000000;
const CREDIT_WARNING_THRESHOLD = Number(process.env.HELIUS_CREDIT_MARGIN ?? '0.8');
class HeliusBackfillService {
    constructor() {
        this.queue = [];
        this.running = false;
        this.creditsUsedThisMonth = 0;
    }
    enqueue(job) {
        this.queue.push(job);
        this.queue.sort((a, b) => b.priority - a.priority);
        if (!this.running) {
            this.start();
        }
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        void this.loop();
    }
    stop() {
        this.running = false;
    }
    async loop() {
        while (this.running) {
            const job = this.queue.shift();
            if (!job) {
                await this.delay(2000);
                continue;
            }
            if (!this.canSpendCredits(1)) {
                logger_1.logger.warn('Backfill paused due to credit limit');
                await this.delay(60000);
                this.queue.unshift(job);
                continue;
            }
            try {
                await this.processJob(job);
            }
            catch (error) {
                logger_1.logger.error('Backfill job failed', error, {
                    mint: job.mint.substring(0, 20),
                });
            }
        }
    }
    async processJob(job) {
        let cursor;
        let continueFetching = true;
        while (continueFetching) {
            if (!this.canSpendCredits(1)) {
                logger_1.logger.warn('Backfill throttled due to credit usage');
                this.queue.unshift(job);
                return;
            }
            const transactions = await helius_client_1.heliusRestClient.getTransactionsForAddress(job.mint, {
                before: cursor,
                limit: 100,
            });
            this.consumeCredits(1);
            if (!transactions.length) {
                break;
            }
            const ticks = transactions
                .map((tx) => this.transformTransaction(tx))
                .filter((tick) => !!tick);
            if (ticks.length) {
                await (0, clickhouse_client_1.insertTicks)(job.mint, job.chain, ticks);
                ticks.forEach((tick) => {
                    ohlcv_aggregator_1.ohlcvAggregator.ingestTick(job.mint, job.chain, {
                        timestamp: tick.timestamp,
                        price: tick.price,
                        volume: tick.size ?? 0,
                    });
                });
                await ohlcv_aggregator_1.ohlcvAggregator.flushCompletedBuckets(Date.now());
            }
            cursor = transactions[transactions.length - 1]?.signature;
            const oldestTimestamp = transactions[transactions.length - 1]?.timestamp;
            if (!oldestTimestamp || oldestTimestamp <= job.startTime.toSeconds()) {
                continueFetching = false;
            }
        }
    }
    transformTransaction(tx) {
        const price = this.extractPrice(tx);
        const timestamp = tx.timestamp ? Number(tx.timestamp) : null;
        if (!price || !timestamp) {
            return null;
        }
        const size = this.extractVolume(tx);
        return {
            timestamp,
            price,
            size,
            signature: tx.signature,
            slot: tx.slot,
            source: 'rpc',
        };
    }
    extractPrice(tx) {
        if (typeof tx.price === 'number') {
            return tx.price;
        }
        if (tx.events?.priceUpdate?.price) {
            return Number(tx.events.priceUpdate.price);
        }
        if (tx.accountData?.price) {
            return Number(tx.accountData.price);
        }
        return null;
    }
    extractVolume(tx) {
        if (typeof tx.volume === 'number') {
            return tx.volume;
        }
        if (tx.accountData?.volume) {
            return Number(tx.accountData.volume);
        }
        return undefined;
    }
    canSpendCredits(calls) {
        const projected = this.creditsUsedThisMonth + calls * CREDIT_PER_CALL;
        if (projected > MONTHLY_CREDIT_LIMIT) {
            return false;
        }
        const margin = MONTHLY_CREDIT_LIMIT * CREDIT_WARNING_THRESHOLD;
        if (projected > margin) {
            logger_1.logger.warn('Helius credit usage above warning threshold', {
                used: projected,
                limit: MONTHLY_CREDIT_LIMIT,
            });
        }
        return true;
    }
    consumeCredits(calls) {
        this.creditsUsedThisMonth += calls * CREDIT_PER_CALL;
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.HeliusBackfillService = HeliusBackfillService;
exports.heliusBackfillService = new HeliusBackfillService();
//# sourceMappingURL=helius-backfill-service.js.map