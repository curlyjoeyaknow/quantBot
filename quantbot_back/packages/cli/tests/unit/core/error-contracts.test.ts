/**
 * Unit tests for Error Contracts
 */

import { describe, it, expect } from 'vitest';
import {
  errorToContract,
  validateErrorContract,
  ErrorContractSchema,
} from '../../../src/core/error-contracts.js';
import {
  AppError,
  ValidationError,
  TimeoutError,
  NotFoundError,
  ApiError,
  DatabaseError,
} from '@quantbot/utils';

describe('Error Contracts', () => {
  describe('errorToContract', () => {
    it('should convert AppError to contract', () => {
      const error = new AppError('Test error', 'TEST_ERROR', 500, { key: 'value' });
      const contract = errorToContract(error, 'test.operation', 'run_123');

      expect(contract.code).toBe('TEST_ERROR');
      expect(contract.message).toBe('Test error');
      expect(contract.operation).toBe('test.operation');
      expect(contract.runId).toBe('run_123');
      expect(contract.statusCode).toBe(500);
      expect(contract.metadata).toEqual({ key: 'value' });
      expect(contract.errorType).toBe('AppError');
      expect(contract.timestamp).toBeDefined();
    });

    it('should convert ValidationError to contract', () => {
      const error = new ValidationError('Invalid input', { field: 'mint' });
      const contract = errorToContract(error, 'validation.check');

      expect(contract.code).toBe('VALIDATION_ERROR');
      expect(contract.message).toBe('Invalid input');
      expect(contract.metadata).toEqual({ field: 'mint' });
      expect(contract.errorType).toBe('ValidationError');
    });

    it('should convert TimeoutError to contract with timeout', () => {
      const error = new TimeoutError('Operation timed out', 5000, { operation: 'fetch' });
      const contract = errorToContract(error, 'api.fetch');

      expect(contract.code).toBe('TIMEOUT_ERROR');
      expect(contract.metadata?.timeoutMs).toBe(5000);
      expect(contract.metadata?.operation).toBe('fetch');
      expect(contract.errorType).toBe('TimeoutError');
    });

    it('should convert NotFoundError to contract', () => {
      const error = new NotFoundError('Resource', 'id_123', { type: 'token' });
      const contract = errorToContract(error, 'storage.get');

      expect(contract.code).toBe('NOT_FOUND');
      expect(contract.errorType).toBe('NotFoundError');
    });

    it('should convert ApiError to contract', () => {
      const error = new ApiError('API failed', 'birdeye', 429, { rateLimit: true });
      const contract = errorToContract(error, 'api.call');

      expect(contract.code).toBe('API_ERROR');
      expect(contract.metadata?.apiName).toBe('birdeye');
      expect(contract.metadata?.apiStatusCode).toBe(429);
      expect(contract.errorType).toBe('ApiError');
    });

    it('should convert DatabaseError to contract', () => {
      const error = new DatabaseError('Query failed', 'SELECT', { table: 'tokens' });
      const contract = errorToContract(error, 'db.query');

      expect(contract.code).toBe('DATABASE_ERROR');
      expect(contract.metadata?.operation).toBe('SELECT');
      expect(contract.errorType).toBe('DatabaseError');
    });

    it('should convert unknown error to contract', () => {
      const error = new Error('Unknown error');
      const contract = errorToContract(error, 'unknown.operation');

      expect(contract.code).toBe('UNKNOWN_ERROR');
      expect(contract.message).toBe('Unknown error');
      expect(contract.metadata?.errorName).toBe('Error');
      expect(contract.metadata?.stack).toBeDefined();
    });

    it('should convert non-Error to contract', () => {
      const error = 'String error';
      const contract = errorToContract(error, 'unknown.operation');

      expect(contract.code).toBe('UNKNOWN_ERROR');
      expect(contract.message).toBe('String error');
      expect(contract.metadata?.originalError).toBe('String error');
    });

    it('should include timestamp in contract', () => {
      const error = new AppError('Test');
      const contract = errorToContract(error, 'test');

      expect(contract.timestamp).toBeDefined();
      expect(new Date(contract.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('validateErrorContract', () => {
    it('should validate valid contract', () => {
      const contract = {
        code: 'TEST_ERROR',
        message: 'Test error',
        operation: 'test.operation',
        timestamp: new Date().toISOString(),
      };

      const validated = validateErrorContract(contract);
      expect(validated).toEqual(contract);
    });

    it('should validate contract with optional fields', () => {
      const contract = {
        code: 'TEST_ERROR',
        message: 'Test error',
        operation: 'test.operation',
        timestamp: new Date().toISOString(),
        runId: 'run_123',
        metadata: { key: 'value' },
        statusCode: 500,
        errorType: 'AppError',
      };

      const validated = validateErrorContract(contract);
      expect(validated).toEqual(contract);
    });

    it('should throw on invalid contract', () => {
      const invalid = {
        code: 'TEST_ERROR',
        // Missing required fields
      };

      expect(() => validateErrorContract(invalid)).toThrow();
    });

    it('should validate against schema', () => {
      const contract = {
        code: 'TEST_ERROR',
        message: 'Test error',
        operation: 'test.operation',
        timestamp: new Date().toISOString(),
      };

      const result = ErrorContractSchema.safeParse(contract);
      expect(result.success).toBe(true);
    });
  });
});
