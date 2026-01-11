import { describe, it, expect } from 'vitest';
import { logger } from '../../src/logger';

describe('Simulation Logger', () => {
  it('should export logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
