/**
 * Birdeye Client Tests
 * ====================
 * Tests for Birdeye API client
 */

import axios from 'axios';

// Set up API keys FIRST before any imports
process.env.BIRDEYE_API_KEY_1 = 'test-api-key-1';
process.env.BIRDEYE_API_KEY_2 = 'test-api-key-2';

// Mock axios with create method
jest.mock('axios', () => ({
  default: {
    create: jest.fn((config) => ({
      get: jest.fn(),
      post: jest.fn(),
      ...config,
    })),
    get: jest.fn(),
    post: jest.fn(),
  },
  __esModule: true,
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the birdeye-client module to prevent singleton instantiation
jest.mock('../../src/api/birdeye-client', () => {
  const actual = jest.requireActual('../../src/api/birdeye-client');
  return {
    ...actual,
    birdeyeClient: {} as any, // Mock the singleton
  };
});

// Now import after mocks are set up
import { BirdeyeClient } from '../../src/api/birdeye-client';

describe('BirdeyeClient', () => {
  let client: BirdeyeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up multiple API keys for testing
    process.env.BIRDEYE_API_KEY_1 = 'test-api-key-1';
    process.env.BIRDEYE_API_KEY_2 = 'test-api-key-2';
  });

  afterEach(() => {
    delete process.env.BIRDEYE_API_KEY_1;
    delete process.env.BIRDEYE_API_KEY_2;
  });

  describe('Initialization', () => {
    it('should initialize with API keys', () => {
      client = new BirdeyeClient();
      expect(client).toBeDefined();
    });

    it('should throw error when no API keys found', () => {
      delete process.env.BIRDEYE_API_KEY_1;
      delete process.env.BIRDEYE_API_KEY_2;
      expect(() => new BirdeyeClient()).toThrow('No Birdeye API keys found');
    });
  });

  describe('fetchOHLCVData', () => {
    beforeEach(() => {
      client = new BirdeyeClient();
    });

    it('should fetch OHLCV data successfully', async () => {
      const mockResponse = {
        status: 200,
        data: {
          items: [
            { unixTime: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
          ],
        },
      };

      // Mock axios instance
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue(mockResponse),
      };

      // Access private axiosInstances and inject mock
      (client as any).axiosInstances.set('test-api-key-1', mockAxiosInstance);
      (client as any).getNextAPIKey = jest.fn().mockReturnValue('test-api-key-1');

      const result = await client.fetchOHLCVData(
        '0x123',
        new Date(1000),
        new Date(2000),
        '1m'
      );

      expect(result).toBeDefined();
      expect(result?.items).toHaveLength(1);
    });

    it('should return null on rate limit after retries', async () => {
      const rateLimitError = {
        response: {
          status: 429,
        },
      };

      const mockAxiosInstance = {
        get: jest.fn().mockRejectedValue(rateLimitError),
      };

      (client as any).axiosInstances.set('test-api-key-1', mockAxiosInstance);
      (client as any).getNextAPIKey = jest.fn().mockReturnValue('test-api-key-1');

      const result = await client.fetchOHLCVData(
        '0x123',
        new Date(1000),
        new Date(2000)
      );

      expect(result).toBeNull();
    });
  });

  describe('API Key Usage', () => {
    beforeEach(() => {
      client = new BirdeyeClient();
    });

    it('should get API key usage statistics', () => {
      const usage = client.getAPIKeyUsage();
      expect(Array.isArray(usage)).toBe(true);
      expect(usage.length).toBeGreaterThan(0);
    });

    it('should get total requests', () => {
      const total = client.getTotalRequests();
      expect(typeof total).toBe('number');
      expect(total).toBeGreaterThanOrEqual(0);
    });

    it('should get total credits used', () => {
      const credits = client.getTotalCreditsUsed();
      expect(typeof credits).toBe('number');
      expect(credits).toBeGreaterThanOrEqual(0);
    });

    it('should get remaining credits', () => {
      const remaining = client.getRemainingCredits();
      expect(typeof remaining).toBe('number');
      expect(remaining).toBeGreaterThan(0);
    });

    it('should calculate credit usage percentage', () => {
      const percentage = client.getCreditUsagePercentage();
      expect(typeof percentage).toBe('number');
      expect(percentage).toBeGreaterThanOrEqual(0);
      expect(percentage).toBeLessThanOrEqual(100);
    });

    it('should check if approaching credit limit', () => {
      const isApproaching = client.isApproachingCreditLimit();
      expect(typeof isApproaching).toBe('boolean');
    });

    it('should reset usage statistics', () => {
      client.resetUsageStats();
      const total = client.getTotalRequests();
      expect(total).toBe(0);
    });
  });
});

