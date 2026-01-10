import { describe, it, expect } from 'vitest';
import { parseStrategyConfig } from '../../../src/engine/StrategyConfig';
import type { StrategyConfig } from '../../../src/engine/StrategyConfig';

describe('StrategyConfig', () => {
  describe('parseStrategyConfig', () => {
    it('should parse strategy config from JSON', () => {
      const configJson = {
        name: 'Test Strategy',
        profitTargets: [
          { target: 2.0, percent: 0.5 },
          { target: 3.0, percent: 0.5 },
        ],
        stopLoss: {
          initial: -0.3,
          trailing: 0.5,
        },
      };
      const config = parseStrategyConfig(configJson);
      expect(config.name).toBe('Test Strategy');
      expect(config.profitTargets).toBeDefined();
      expect(config.stopLoss).toBeDefined();
    });

    it('should handle minimal config', () => {
      const configJson = {
        name: 'Minimal',
      };
      const config = parseStrategyConfig(configJson);
      expect(config.name).toBe('Minimal');
    });
  });
});
