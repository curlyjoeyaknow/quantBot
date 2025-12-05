import { describe, it, expect } from 'vitest';
import { getLoader, registerLoader } from '../../src/data/loaders';

describe('data-loader-factory', () => {
  describe('getLoader', () => {
    it('should return CSV loader for csv source', () => {
      const loader = getLoader('csv');
      expect(loader).toBeDefined();
      if (loader) {
        expect(loader.name).toBe('csv-loader');
      }
    });

    it('should return ClickHouse loader for clickhouse source', () => {
      const loader = getLoader('clickhouse');
      expect(loader).toBeDefined();
      if (loader) {
        expect(loader.name).toBe('clickhouse-loader');
      }
    });

    it('should return caller loader for caller source', () => {
      const loader = getLoader('caller');
      expect(loader).toBeDefined();
      if (loader) {
        expect(loader.name).toBe('caller-loader');
      }
    });

    it('should return null for unknown source', () => {
      const loader = getLoader('unknown');
      expect(loader).toBeNull();
    });
  });

  describe('registerLoader', () => {
    it('should register a new loader', () => {
      const customLoader = {
        name: 'custom-loader',
        canLoad: (source: string) => source === 'custom',
        load: async () => [],
      };

      registerLoader(customLoader);

      const loader = getLoader('custom');
      expect(loader).toBeDefined();
      expect(loader?.name).toBe('custom-loader');
    });
  });
});

