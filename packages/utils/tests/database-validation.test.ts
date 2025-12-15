import { describe, it, expect } from 'vitest';
import {
  saveStrategySchema,
  saveSimulationRunSchema,
  saveCATrackingSchema,
  saveCACallSchema,
  validateOrThrow,
  validate,
  tokenAddressSchema,
  chainParamSchema,
  callerNameSchema,
  limitSchema,
} from '../src/database-validation';
import { createTokenAddress } from '@quantbot/core';

describe('Database Validation Schemas', () => {
  describe('tokenAddressSchema', () => {
    it('should validate valid token addresses', () => {
      const validAddress = 'So11111111111111111111111111111111111111112';
      const result = tokenAddressSchema.safeParse(validAddress);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(createTokenAddress(validAddress));
      }
    });

    it('should reject addresses that are too short', () => {
      const result = tokenAddressSchema.safeParse('short');
      expect(result.success).toBe(false);
    });

    it('should reject addresses that are too long', () => {
      const result = tokenAddressSchema.safeParse('a'.repeat(50));
      expect(result.success).toBe(false);
    });
  });

  describe('chainParamSchema', () => {
    it('should validate valid chains', () => {
      expect(chainParamSchema.safeParse('solana').success).toBe(true);
      expect(chainParamSchema.safeParse('ethereum').success).toBe(true);
      expect(chainParamSchema.safeParse('bsc').success).toBe(true);
      expect(chainParamSchema.safeParse('base').success).toBe(true);
    });

    it('should reject invalid chains', () => {
      expect(chainParamSchema.safeParse('invalid').success).toBe(false);
      expect(chainParamSchema.safeParse('SOLANA').success).toBe(false);
    });
  });

  describe('callerNameSchema', () => {
    it('should validate valid caller names', () => {
      expect(callerNameSchema.safeParse('test_caller').success).toBe(true);
      expect(callerNameSchema.safeParse('a').success).toBe(true);
      expect(callerNameSchema.safeParse('a'.repeat(100)).success).toBe(true);
    });

    it('should reject empty caller names', () => {
      expect(callerNameSchema.safeParse('').success).toBe(false);
    });

    it('should reject caller names that are too long', () => {
      expect(callerNameSchema.safeParse('a'.repeat(101)).success).toBe(false);
    });
  });

  describe('limitSchema', () => {
    it('should validate valid limits', () => {
      expect(limitSchema.safeParse(1).success).toBe(true);
      expect(limitSchema.safeParse(50).success).toBe(true);
      expect(limitSchema.safeParse(1000).success).toBe(true);
    });

    it('should reject limits that are too large', () => {
      expect(limitSchema.safeParse(1001).success).toBe(false);
    });

    it('should reject non-positive limits', () => {
      expect(limitSchema.safeParse(0).success).toBe(false);
      expect(limitSchema.safeParse(-1).success).toBe(false);
    });

    it('should default to 50', () => {
      const result = limitSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(50);
      }
    });
  });

  describe('saveStrategySchema', () => {
    it('should validate valid strategy data', () => {
      const valid = {
        userId: 1,
        name: 'Test Strategy',
        strategy: [{ type: 'entry', price: 100 }],
        stopLossConfig: { type: 'fixed', value: 0.1 },
      };
      expect(saveStrategySchema.safeParse(valid).success).toBe(true);
    });

    it('should reject invalid userId', () => {
      const invalid = {
        userId: 0,
        name: 'Test',
        strategy: [],
      };
      expect(saveStrategySchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject empty strategy name', () => {
      const invalid = {
        userId: 1,
        name: '',
        strategy: [],
      };
      expect(saveStrategySchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('saveSimulationRunSchema', () => {
    it('should validate valid simulation run data', () => {
      const valid = {
        userId: 1,
        mint: createTokenAddress('So11111111111111111111111111111111111111112'),
        chain: 'solana',
        startTime: new Date(),
        endTime: new Date(),
        strategy: [],
      };
      expect(saveSimulationRunSchema.safeParse(valid).success).toBe(true);
    });

    it('should accept string dates and convert them', () => {
      const valid = {
        userId: 1,
        mint: createTokenAddress('So11111111111111111111111111111111111111112'),
        chain: 'solana',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-02T00:00:00Z',
        strategy: [],
      };
      const result = saveSimulationRunSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startTime).toBeInstanceOf(Date);
        expect(result.data.endTime).toBeInstanceOf(Date);
      }
    });
  });

  describe('saveCATrackingSchema', () => {
    it('should validate valid CA tracking data', () => {
      const valid = {
        userId: 1,
        mint: createTokenAddress('So11111111111111111111111111111111111111112'),
        chain: 'solana',
        callPrice: 1.0,
        callTimestamp: 1234567890,
        strategy: [],
      };
      expect(saveCATrackingSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject negative call price', () => {
      const invalid = {
        userId: 1,
        mint: createTokenAddress('So11111111111111111111111111111111111111112'),
        chain: 'solana',
        callPrice: -1,
        callTimestamp: 1234567890,
        strategy: [],
      };
      expect(saveCATrackingSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('saveCACallSchema', () => {
    it('should validate valid CA call data', () => {
      const valid = {
        mint: createTokenAddress('So11111111111111111111111111111111111111112'),
        chain: 'solana',
        call_timestamp: 1234567890,
      };
      expect(saveCACallSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject negative call timestamp', () => {
      const invalid = {
        mint: createTokenAddress('So11111111111111111111111111111111111111112'),
        chain: 'solana',
        call_timestamp: -1,
      };
      expect(saveCACallSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('validateOrThrow', () => {
    it('should return validated data when valid', () => {
      const schema = tokenAddressSchema;
      const data = 'So11111111111111111111111111111111111111112';
      const result = validateOrThrow(schema, data);
      expect(result).toBe(createTokenAddress(data));
    });

    it('should throw error when invalid', () => {
      const schema = tokenAddressSchema;
      const data = 'invalid';
      expect(() => validateOrThrow(schema, data)).toThrow('Validation failed');
    });
  });

  describe('validate', () => {
    it('should return success result when valid', () => {
      const schema = tokenAddressSchema;
      const data = 'So11111111111111111111111111111111111111112';
      const result = validate(schema, data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(createTokenAddress(data));
      }
    });

    it('should return error result when invalid', () => {
      const schema = tokenAddressSchema;
      const data = 'invalid';
      const result = validate(schema, data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});
