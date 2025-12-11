"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.heliusRestClient = exports.HeliusRestClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_REST_URL = process.env.HELIUS_REST_URL || 'https://api.helius.xyz';
class HeliusRestClient {
    constructor() {
        this.apiKey = HELIUS_API_KEY;
        this.http = axios_1.default.create({
            baseURL: HELIUS_REST_URL,
            timeout: 10000,
        });
    }
    async getTransactionsForAddress(address, options = {}) {
        if (!this.apiKey) {
            throw new Error('HELIUS_API_KEY missing');
        }
        const params = {
            'api-key': this.apiKey,
            limit: options.limit ?? 100,
        };
        if (options.before) {
            params.before = options.before;
        }
        try {
            const url = `/v0/addresses/${address}/transactions`;
            const response = await this.http.get(url, { params });
            if (!Array.isArray(response.data)) {
                return [];
            }
            return response.data;
        }
        catch (error) {
            logger_1.logger.error('Helius REST call failed', error, { address: address.substring(0, 20) });
            throw error;
        }
    }
    async getTransactions(signatures) {
        if (!this.apiKey) {
            throw new Error('HELIUS_API_KEY missing');
        }
        if (!Array.isArray(signatures) || signatures.length === 0) {
            return [];
        }
        try {
            const url = `/v0/transactions/?api-key=${this.apiKey}`;
            const response = await this.http.post(url, signatures);
            if (!Array.isArray(response.data)) {
                return [];
            }
            return response.data;
        }
        catch (error) {
            logger_1.logger.error('Helius transaction fetch failed', error, { count: signatures.length });
            throw error;
        }
    }
}
exports.HeliusRestClient = HeliusRestClient;
exports.heliusRestClient = new HeliusRestClient();
//# sourceMappingURL=helius-client.js.map