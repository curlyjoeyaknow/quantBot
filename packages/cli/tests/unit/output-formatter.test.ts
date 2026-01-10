/**
 * Unit tests for Output Formatter
 */

import { describe, it, expect } from 'vitest';
import { formatJSON, formatTable, formatCSV, formatOutput } from '../../src/core/output-formatter';

describe('OutputFormatter', () => {
  describe('formatJSON', () => {
    it('should format object as JSON', () => {
      const data = { name: 'test', value: 123 };
      const result = formatJSON(data);
      expect(result).toContain('"name"');
      expect(result).toContain('"test"');
    });
  });

  describe('formatTable', () => {
    it('should format array as table', () => {
      const data = [
        { name: 'test1', value: 1 },
        { name: 'test2', value: 2 },
      ];
      const result = formatTable(data);
      expect(result).toContain('name');
      expect(result).toContain('value');
      expect(result).toContain('test1');
    });

    it('should handle empty array', () => {
      const result = formatTable([]);
      expect(result).toBe('No data to display');
    });
  });

  describe('formatCSV', () => {
    it('should format array as CSV', () => {
      const data = [
        { name: 'test1', value: 1 },
        { name: 'test2', value: 2 },
      ];
      const result = formatCSV(data);
      expect(result).toContain('name,value');
      expect(result).toContain('test1,1');
    });

    it('should handle empty array', () => {
      const result = formatCSV([]);
      expect(result).toBe('');
    });
  });

  describe('formatOutput', () => {
    it('should format as JSON when format is json', () => {
      const data = { test: 'value' };
      const result = formatOutput(data, 'json');
      expect(result).toContain('"test"');
    });

    it('should format as table when format is table', () => {
      const data = [{ test: 'value' }];
      const result = formatOutput(data, 'table');
      expect(result).toContain('test');
    });

    it('should format as CSV when format is csv', () => {
      const data = [{ test: 'value' }];
      const result = formatOutput(data, 'csv');
      // CSV format includes header and data rows
      expect(result).toContain('test');
      expect(result).toContain('value');
      expect(result.split('\n').length).toBeGreaterThanOrEqual(2);
    });
  });
});
