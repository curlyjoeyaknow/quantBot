import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_REST_URL = process.env.HELIUS_REST_URL || 'https://api.helius.xyz';

export interface AddressTransactionsOptions {
  before?: string;
  limit?: number;
}

export class HeliusRestClient {
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = HELIUS_API_KEY;
    this.http = axios.create({
      baseURL: HELIUS_REST_URL,
      timeout: 10_000,
    });
  }

  async getTransactionsForAddress(
    address: string,
    options: AddressTransactionsOptions = {}
  ): Promise<any[]> {
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY missing');
    }

    const params: Record<string, any> = {
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
    } catch (error) {
      logger.error('Helius REST call failed', error as Error, { address: address.substring(0, 20) });
      throw error;
    }
  }

  async getTransactions(signatures: string[]): Promise<any[]> {
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
    } catch (error) {
      logger.error('Helius transaction fetch failed', error as Error, { count: signatures.length });
      throw error;
    }
  }
}

export const heliusRestClient = new HeliusRestClient();


