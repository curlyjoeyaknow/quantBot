import { describe, it, expect } from 'vitest';
import {
  validateContractVersion,
  validateSimInput,
  ContractVersionError,
  ContractValidator,
  areVersionsCompatible,
  getContractVersion,
} from '../src/contract-validator.js';
import { CURRENT_CONTRACT_VERSION } from '../src/types/contracts.js';

describe('validateContractVersion', () => {
  it('should accept supported versions', () => {
    expect(() => validateContractVersion('1.0.0')).not.toThrow();
  });

  it('should reject unsupported versions', () => {
    expect(() => validateContractVersion('2.0.0')).toThrow(ContractVersionError);
    expect(() => validateContractVersion('0.9.0')).toThrow(ContractVersionError);
  });
});

describe('validateSimInput', () => {
  it('should validate correct input', () => {
    const input = {
      run_id: 'test-run',
      strategy_id: 'test-strategy',
      mint: 'test-mint',
      alert_timestamp: '2024-01-01T12:00:00Z',
      candles: [],
      entry_config: {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 3600000,
      },
      exit_config: {
        profit_targets: [],
      },
      contractVersion: CURRENT_CONTRACT_VERSION,
      seed: 12345,
      dataVersion: '1.0.0',
      strategyVersion: '1.0.0',
      executionModel: {
        latency: { type: 'fixed', valueMs: 100 },
        slippage: { type: 'fixed', bps: 10 },
        partialFills: { enabled: false },
        failures: { enabled: false },
        fees: { takerBps: 10, makerBps: 5 },
      },
      riskModel: {
        positionLimits: { maxPositionSizeUsd: 10000, maxLeverage: 1 },
        drawdownLimits: { maxDrawdownPercent: 20, stopOnDrawdown: false },
        exposureLimits: { maxTotalExposureUsd: 50000, maxConcentrationPercent: 50 },
      },
      dataSnapshotHash: 'abc123',
      clockResolution: 'candle',
    };

    const result = validateSimInput(input);
    expect(result.contractVersion).toBe(CURRENT_CONTRACT_VERSION);
  });

  it('should reject input with unsupported version', () => {
    const input = {
      run_id: 'test-run',
      strategy_id: 'test-strategy',
      mint: 'test-mint',
      alert_timestamp: '2024-01-01T12:00:00Z',
      candles: [],
      entry_config: {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 3600000,
      },
      exit_config: {
        profit_targets: [],
      },
      contractVersion: '2.0.0', // Unsupported
      seed: 12345,
      dataVersion: '1.0.0',
      strategyVersion: '1.0.0',
      executionModel: {
        latency: { type: 'fixed', valueMs: 100 },
        slippage: { type: 'fixed', bps: 10 },
        partialFills: { enabled: false },
        failures: { enabled: false },
        fees: { takerBps: 10, makerBps: 5 },
      },
      riskModel: {
        positionLimits: { maxPositionSizeUsd: 10000, maxLeverage: 1 },
        drawdownLimits: { maxDrawdownPercent: 20, stopOnDrawdown: false },
        exposureLimits: { maxTotalExposureUsd: 50000, maxConcentrationPercent: 50 },
      },
      dataSnapshotHash: 'abc123',
      clockResolution: 'candle',
    };

    expect(() => validateSimInput(input)).toThrow(ContractVersionError);
  });

  it('should reject malformed input', () => {
    const input = {
      run_id: 'test-run',
      // Missing required fields
    };

    expect(() => validateSimInput(input)).toThrow();
  });
});

describe('ContractValidator', () => {
  const validator = new ContractValidator();

  it('should check version support', () => {
    expect(validator.isVersionSupported('1.0.0')).toBe(true);
    expect(validator.isVersionSupported('2.0.0')).toBe(false);
  });

  it('should return current version', () => {
    expect(validator.getCurrentVersion()).toBe(CURRENT_CONTRACT_VERSION);
  });

  it('should return supported versions', () => {
    const versions = validator.getSupportedVersions();
    expect(versions).toContain('1.0.0');
  });
});

describe('areVersionsCompatible', () => {
  it('should check version compatibility', () => {
    expect(areVersionsCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(areVersionsCompatible('1.0.0', '2.0.0')).toBe(false);
  });
});

describe('getContractVersion', () => {
  it('should extract contract version', () => {
    const data = { contractVersion: '1.0.0', other: 'data' };
    expect(getContractVersion(data)).toBe('1.0.0');
  });

  it('should return null for invalid data', () => {
    expect(getContractVersion(null)).toBeNull();
    expect(getContractVersion({})).toBeNull();
    expect(getContractVersion({ other: 'data' })).toBeNull();
  });
});
